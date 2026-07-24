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

// Calls the insight model. Prefers a direct Google Gemini key (your billing) when
// GEMINI_API_KEY is set; otherwise falls back to the Lovable AI gateway so nothing
// breaks. Prompt + data are identical either way — only the route/billing differs.
async function callInsightModel(system: string, user: string): Promise<{ text: string; model: string }> {
  const gk = process.env.GEMINI_API_KEY;
  if (gk) {
    const model = process.env.GEMINI_MODEL || "gemini-2.5-pro";
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gk}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
        }),
      },
    );
    if (res.status === 429) throw new Error("Gemini is rate-limited. Please try again in a moment.");
    if (!res.ok) {
      const b = await res.text();
      throw new Error(`Gemini request failed (${res.status}): ${b.slice(0, 200)}`);
    }
    const j = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((x) => x.text ?? "").join("").trim();
    if (!text) throw new Error("Gemini returned an empty response.");
    return { text, model: `google/${model}` };
  }
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI is not configured (set GEMINI_API_KEY or LOVABLE_API_KEY).");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (res.status === 429) throw new Error("AI is rate-limited. Please try again in a moment.");
  if (res.status === 402) throw new Error("AI credits exhausted. Add credits in workspace billing.");
  if (!res.ok) {
    const b = await res.text();
    throw new Error(`AI request failed (${res.status}): ${b.slice(0, 200)}`);
  }
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = j.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("AI returned an empty response.");
  return { text, model: MODEL };
}

export const generateClientInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<{ text: string; model: string; generatedAt: string; memoryVersion: number }> => {
    const { data: prof } = await context.supabase
      .from("profiles").select("role").eq("id", context.userId).maybeSingle();
    const role = prof?.role;
    const isSuperAdmin = role === "super_admin";

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;

    // Authorize: super-admin (any client) or the practitioner who owns this client.
    const { data: cAuth } = await db
      .from("clients")
      .select("practitioner_id, yves_ai_consent")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!cAuth) throw new Error("Client not found");
    if (!isSuperAdmin && !(role === "practitioner" && cAuth.practitioner_id === context.userId)) {
      throw new Error("Forbidden");
    }
    // POPIA / AI-consent gate — never send a client's data to the AI provider
    // unless they consented (same rule triage uses).
    if ((cAuth as { yves_ai_consent?: boolean }).yves_ai_consent !== true) {
      throw new Error(
        "This client hasn't consented to AI processing, so Yves Insight is unavailable for them until they enable AI consent in their Buddy profile.",
      );
    }
    // Daily cap for non-super-admins (practitioners): 3 Yves insights per day.
    if (!isSuperAdmin) {
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const { count } = await db
        .from("client_insight_logs")
        .select("id", { count: "exact", head: true })
        .eq("generated_by", context.userId)
        .gte("created_at", dayStart.toISOString());
      if ((count ?? 0) >= 3) {
        throw new Error("You've reached today's limit of 3 Yves insights. Please try again tomorrow.");
      }
    }

    // Fetch everything we need, in parallel.
    const [
      clientRes, wearablesRes, sessionsRes, checkInsRes,
      symptomsRes, alertsRes, baselineRes, patternsRes,
    ] = await Promise.all([
      db.from("clients").select("*").eq("id", data.clientId).maybeSingle(),
      db.from("wearable_tokens").select("provider, status, garmin_device_model").eq("client_id", data.clientId),
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

    // Load active Yves memory rules + latest global memory version via cache.
    const { getActiveYvesMemoryForScopesCached, getLatestYvesMemoryVersionCached } = await import(
      "@/lib/yves-memory-cache.server"
    );
    const [memoryRules, memoryVersion] = await Promise.all([
      getActiveYvesMemoryForScopesCached(db, scopesToLoad),
      getLatestYvesMemoryVersionCached(db),
    ]);

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

    const { text, model: usedModel } = await callInsightModel(systemPrompt, userMsg);

    // Best-effort log; never fail the request if logging fails.
    try {
      await db.from("client_insight_logs").insert({
        client_id: data.clientId,
        generated_by: context.userId,
        focus: data.focus ?? null,
        model: usedModel,
        response: text,
        memory_version: memoryVersion,
      });
    } catch { /* ignore */ }

    return { text, model: usedModel, generatedAt: new Date().toISOString(), memoryVersion };
  });
