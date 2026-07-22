import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { INSIGHT_SYSTEM_PROMPT, buildInsightPayload } from "@/lib/data-hub-insight.prompt";
import { buildYvesSystemPrompt, type YvesScope } from "@/lib/yves-identity";

const Input = z.object({
  clientId: z.string().uuid(),
  focus: z.string().max(80).optional(),
});

const MODEL = "google/gemini-3.1-pro-preview";

export const generateClientInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<{ text: string; model: string; generatedAt: string; memoryVersion: number }> => {
    // Super-admin only (matches admin data hub gate)
    const { data: prof } = await context.supabase
      .from("profiles").select("role").eq("id", context.userId).maybeSingle();
    if (!prof || prof.role !== "super_admin") throw new Error("Forbidden");

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI is not configured (missing LOVABLE_API_KEY).");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;

    // Fetch everything we need, in parallel.
    const [
      clientRes, wearablesRes, sessionsRes, checkInsRes,
      symptomsRes, alertsRes, baselineRes, patternsRes,
    ] = await Promise.all([
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

    // Map focus label → memory scope
    const FOCUS_SCOPE: Record<string, YvesScope> = {
      "Pain & symptoms": "pain_symptoms",
      "Sleep & recovery": "sleep",
      "Training load": "wearable",
      "Risk factors": "risk",
    };
    const extraScope = data.focus ? FOCUS_SCOPE[data.focus] : undefined;
    const scopesToLoad = Array.from(new Set(["global", "insight", ...(extraScope ? [extraScope] : [])]));

    // Load active Yves memory rules + latest global memory version, in parallel.
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
    const memoryVersion = (verRes.data?.version_number as number | undefined) ?? 0;

    const systemPrompt = buildYvesSystemPrompt({
      base: INSIGHT_SYSTEM_PROMPT,
      scope: "insight",
      memoryRules,
      extraScopes: extraScope ? [extraScope] : [],
    });

    const userMsg = [
      data.focus ? `Practitioner focus: ${data.focus}.` : "General overview.",
      "Analyse this client and produce insight per the required structure.",
      "CLIENT_DATA_JSON:",
      JSON.stringify(payload),
    ].join("\n\n");

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
    const text = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("AI returned an empty response.");

    // Best-effort log; never fail the request if logging fails.
    try {
      await db.from("client_insight_logs").insert({
        client_id: data.clientId,
        generated_by: context.userId,
        focus: data.focus ?? null,
        model: MODEL,
        response: text,
        memory_version: memoryVersion,
      });
    } catch { /* ignore */ }

    return { text, model: MODEL, generatedAt: new Date().toISOString(), memoryVersion };
  });
