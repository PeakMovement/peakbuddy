import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { log } from "@/lib/log";
import { FORECAST_COACH_SYSTEM_PROMPT, buildForecastUserPayload } from "@/lib/body-forecast.prompt";
import { callInsightModel } from "@/lib/data-hub-insight.functions";
import { hasAiConsent } from "@/lib/ai-consent";

const Factor = z.object({
  label: z.string().max(40),
  value: z.string().max(20),
  read: z.string().max(60),
});

const Input = z.object({
  level: z.enum(["strong", "moderate", "low"]),
  confidence: z.string().max(40).default(""),
  painHigh: z.boolean().default(false),
  painSettled: z.boolean().default(false),
  hrvFalling: z.boolean().default(false),
  rhrRising: z.boolean().default(false),
  sleepScore: z.number().nullable().default(null),
  sleepVsUsual: z.enum(["above", "below", "about"]).nullable().default(null),
  factors: z.array(Factor).max(6).default([]),
  personalNote: z.string().max(300).nullable().default(null),
  deterministicMessage: z.string().max(800),
  deterministicAction: z.string().max(300).default(""),
});

type ForecastEnhanceResult =
  | { ai: false }
  | { ai: true; message: string; action: string; prompt: string | null };

const AI_TIMEOUT_MS = 9000;

function parseModelJson(text: string): { message: string; action: string; prompt: string | null } | null {
  // Strip accidental code fences, then find the first {...} block.
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const message = typeof obj.message === "string" ? obj.message.trim() : "";
    const action = typeof obj.action === "string" ? obj.action.trim() : "";
    const prompt =
      typeof obj.prompt === "string" && obj.prompt.trim() ? obj.prompt.trim() : null;
    if (message.length < 8 || message.length > 600) return null;
    return { message, action: action.slice(0, 200), prompt: prompt ? prompt.slice(0, 200) : null };
  } catch {
    return null;
  }
}

/**
 * Optional AI "coach" layer for the client-facing Body Forecast. Takes the
 * deterministic signals the client already computed and re-voices them into a
 * warm, personal daily message — grounded ONLY in those signals. Gated on the
 * client's own AI consent (POPIA). Returns { ai: false } whenever consent is
 * missing, data is thin, the model errors, or it times out — the caller then
 * keeps showing the instant deterministic forecast. Never throws to the UI.
 */
export const enhanceBodyForecast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<ForecastEnhanceResult> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // Resolve the caller's OWN client record — a client can only ever enhance
      // their own forecast (we never trust a client_id from the input).
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("full_name, primary_complaint, yves_ai_consent")
        .eq("auth_user_id", context.userId)
        .maybeSingle();

      if (!client) return { ai: false };

      // POPIA / AI-consent gate — disabled pre-rollout via AI_CONSENT_REQUIRED.
      if (!hasAiConsent(client as { yves_ai_consent?: boolean })) {
        return { ai: false };
      }

      const firstName = ((client.full_name as string | null) || "").trim().split(/\s+/)[0] || null;

      const user = buildForecastUserPayload({
        level: data.level,
        confidence: data.confidence,
        painHigh: data.painHigh,
        painSettled: data.painSettled,
        hrvFalling: data.hrvFalling,
        rhrRising: data.rhrRising,
        sleepScore: data.sleepScore,
        sleepVsUsual: data.sleepVsUsual,
        factors: data.factors,
        personalNote: data.personalNote,
        firstName,
        primaryComplaint: (client.primary_complaint as string | null) ?? null,
        deterministicMessage: data.deterministicMessage,
        deterministicAction: data.deterministicAction,
      });

      const modelCall = callInsightModel(FORECAST_COACH_SYSTEM_PROMPT, user);
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("forecast_ai_timeout")), AI_TIMEOUT_MS),
      );
      const { text } = await Promise.race([modelCall, timeout]);

      const parsed = parseModelJson(text);
      if (!parsed) return { ai: false };

      return { ai: true, message: parsed.message, action: parsed.action, prompt: parsed.prompt };
    } catch (e) {
      log.warn("[body-forecast] AI enhance failed, using deterministic:", e);
      return { ai: false };
    }
  });
