import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { INSIGHT_SYSTEM_PROMPT, buildInsightPayload } from "@/lib/data-hub-insight.prompt";
import { buildYvesSystemPrompt, type YvesScope } from "@/lib/yves-identity";

const MODEL = "google/gemini-3.1-pro-preview";

export const YVES_TEACH_FOCUSES = [
  "General overview",
  "Pain & symptoms",
  "Sleep & recovery",
  "Training load",
  "Risk factors",
] as const;
export type YvesTeachFocus = (typeof YVES_TEACH_FOCUSES)[number];

const FOCUS_SCOPE: Record<string, YvesScope | undefined> = {
  "General overview": undefined,
  "Pain & symptoms": "pain_symptoms",
  "Sleep & recovery": "sleep",
  "Training load": "wearable",
  "Risk factors": "risk",
};

const Input = z.object({
  mode: z.enum(["client", "scenario"]),
  clientId: z.string().uuid().nullable().optional(),
  scenarioText: z.string().max(4000).nullable().optional(),
  focus: z.string().max(80),
  question: z.string().min(1).max(2000),
  sessionId: z.string().min(1).max(120),
});

async function assertSuperAdmin(sb: SupabaseClient, userId: string) {
  const { data } = await sb.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (!data || (data as { role?: string }).role !== "super_admin") throw new Error("Forbidden");
}

export const askYves = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<{
    answer: string;
    feedbackId: string | null;
    memoryVersion: number;
    model: string;
    generatedAt: string;
  }> => {
    await assertSuperAdmin(context.supabase, context.userId);

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI is not configured (missing LOVABLE_API_KEY).");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;

    const extraScope = FOCUS_SCOPE[data.focus];
    const scopesToLoad = Array.from(new Set(["global", "insight", ...(extraScope ? [extraScope] : [])]));

    // Load memory + latest version.
    const [memRes, verRes] = await Promise.all([
      db.from("yves_memory")
        .select("scope, rule_type, title, rule_text")
        .eq("is_active", true)
        .in("scope", scopesToLoad)
        .order("rule_type", { ascending: true })
        .order("created_at", { ascending: true }),
      db.from("yves_memory_versions")
        .select("version_number")
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const memoryRules = (memRes.data ?? []) as Array<{ scope: string; rule_type: string; title: string; rule_text: string }>;
    const memoryVersion = ((verRes.data as { version_number?: number } | null)?.version_number) ?? 0;

    // Build the user turn.
    let userMsg = "";
    if (data.mode === "client") {
      if (!data.clientId) throw new Error("clientId is required in client mode");
      const [clientRes, wearablesRes, sessionsRes, checkInsRes, symptomsRes, alertsRes, baselineRes, patternsRes] = await Promise.all([
        db.from("clients").select("*").eq("id", data.clientId).maybeSingle(),
        db.from("wearable_tokens").select("provider, status, connected, device_model, garmin_device_model").eq("client_id", data.clientId),
        db.from("wearable_sessions").select("*").eq("client_id", data.clientId).order("date", { ascending: false }).limit(90),
        db.from("check_ins").select("*").eq("client_id", data.clientId).order("created_at", { ascending: false }).limit(90),
        db.from("symptom_queries").select("*").eq("client_id", data.clientId).order("created_at", { ascending: false }).limit(30),
        db.from("alerts").select("*").eq("client_id", data.clientId).order("created_at", { ascending: false }).limit(30),
        db.from("client_baselines").select("*").eq("client_id", data.clientId).maybeSingle(),
        db.from("client_patterns").select("*").eq("client_id", data.clientId).order("created_at", { ascending: false }).limit(20),
      ]);
      if (!clientRes.data) throw new Error("Client not found");

      const payload = buildInsightPayload({
        client: clientRes.data as Record<string, unknown> as never,
        wearables: (wearablesRes.data ?? []) as never,
        wearableSessions: (sessionsRes.data ?? []) as never,
        checkIns: (checkInsRes.data ?? []) as never,
        symptomQueries: (symptomsRes.data ?? []) as never,
        alerts: (alertsRes.data ?? []) as never,
        riskScores: [],
        baseline: (baselineRes.data ?? null) as never,
        patterns: (patternsRes.data ?? []) as never,
      });

      userMsg = [
        `Teaching console (client mode). Focus: ${data.focus}.`,
        "Answer the practitioner's question below using the client's real live data.",
        "Cite specific metrics/windows. If the metric is unavailable, say so.",
        "",
        `QUESTION: ${data.question}`,
        "",
        "CLIENT_DATA_JSON:",
        JSON.stringify(payload),
      ].join("\n");
    } else {
      if (!data.scenarioText || !data.scenarioText.trim()) {
        throw new Error("scenarioText is required in scenario mode");
      }
      userMsg = [
        `Teaching console (scenario mode). Focus: ${data.focus}.`,
        "No live client data is attached. Reason only from the scenario description.",
        "Name any information you would need but do not have.",
        "",
        `SCENARIO:\n${data.scenarioText.trim()}`,
        "",
        `QUESTION: ${data.question}`,
      ].join("\n");
    }

    const systemPrompt = buildYvesSystemPrompt({
      base: INSIGHT_SYSTEM_PROMPT,
      scope: "insight",
      memoryRules,
      extraScopes: extraScope ? [extraScope] : [],
    });

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMsg },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error("AI is rate-limited. Please try again in a moment.");
      if (res.status === 402) throw new Error("AI credits exhausted. Add credits in workspace billing.");
      throw new Error(`AI request failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const answer = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!answer) throw new Error("AI returned an empty response.");

    // Sanitised context — never store raw patient values.
    const testContext: Record<string, unknown> = {
      mode: data.mode,
      focus: data.focus,
      memory_version: memoryVersion,
      model: MODEL,
    };
    if (data.mode === "client" && data.clientId) testContext.clientId = data.clientId;

    let feedbackId: string | null = null;
    try {
      const ins = await db.from("yves_feedback_log").insert({
        admin_id: context.userId,
        session_id: data.sessionId,
        scope: extraScope ?? "insight",
        question: data.question,
        yves_answer: answer,
        test_context: testContext,
      }).select("id").maybeSingle();
      feedbackId = (ins.data as { id?: string } | null)?.id ?? null;
    } catch { /* logging is best-effort */ }

    return {
      answer,
      feedbackId,
      memoryVersion,
      model: MODEL,
      generatedAt: new Date().toISOString(),
    };
  });

// Thumbs-up: mark a feedback row as a positive example. Corrections-to-memory
// live in a later prompt; this only tags the row for future harvesting.
export const markYvesFeedbackPositive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ feedbackId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const { error } = await db
      .from("yves_feedback_log")
      .update({ admin_correction: "__positive_example__" })
      .eq("id", data.feedbackId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Memory panel reads (super-admin only). Read-only shapes for the right column.
export const getYvesMemoryPanel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{
    published: Array<{ id: string; scope: string; rule_type: string; title: string; rule_text: string; updated_at: string }>;
    staging: Array<{ id: string; scope: string; rule_type: string; title: string; rule_text: string; status: string; conflict_flags: unknown; created_at: string }>;
    versions: Array<{ id: string; version_number: number; note: string | null; created_at: string }>;
  }> => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;

    const [pubRes, stgRes, verRes] = await Promise.all([
      db.from("yves_memory")
        .select("id, scope, rule_type, title, rule_text, updated_at")
        .eq("is_active", true)
        .order("scope", { ascending: true })
        .order("rule_type", { ascending: true }),
      db.from("yves_memory_staging")
        .select("id, scope, rule_type, title, rule_text, status, conflict_flags, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      db.from("yves_memory_versions")
        .select("id, version_number, note, created_at")
        .order("version_number", { ascending: false })
        .limit(50),
    ]);

    return {
      published: (pubRes.data ?? []) as never,
      staging: (stgRes.data ?? []) as never,
      versions: (verRes.data ?? []) as never,
    };
  });
