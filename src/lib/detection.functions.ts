import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { DEFAULT_THRESHOLDS, resolveThresholds, type Thresholds, type PartialThresholds } from "@/lib/load-metrics";
import { computeCalibration, type CalibrationReport } from "@/lib/calibration";

const URGENCY_RANK: Record<string, number> = { routine: 0, monitor: 1, soon: 2, urgent: 3, emergency: 4 };

async function assertSuperAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (!data || data.role !== "super_admin") throw new Error("Forbidden");
}
async function settingsRow(db: SupabaseClient): Promise<Record<string, unknown> | null> {
  const { data } = await db.from("platform_settings").select("*").limit(1).maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}
async function writeSettings(db: SupabaseClient, patch: Record<string, unknown>) {
  const row = await settingsRow(db);
  if (row?.id) await db.from("platform_settings").update(patch).eq("id", row.id as string);
  else await db.from("platform_settings").insert(patch);
}

export interface DetectionSettings {
  thresholds: Thresholds;
  autoCalibrate: boolean;
  escalation: { enabled: boolean; afterMinutes: number; minUrgency: string };
  suggestions: CalibrationReport | null;
  calibratedAt: string | null;
}

export const getDetectionSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DetectionSettings> => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const row = await settingsRow(db);
    return {
      thresholds: resolveThresholds((row?.detection_thresholds as PartialThresholds | null) ?? null),
      autoCalibrate: (row?.auto_calibrate_enabled as boolean | undefined) ?? false,
      escalation: {
        enabled: (row?.escalation_enabled as boolean | undefined) ?? false,
        afterMinutes: (row?.escalation_after_minutes as number | undefined) ?? 120,
        minUrgency: (row?.escalation_min_urgency as string | undefined) ?? "urgent",
      },
      suggestions: (row?.threshold_suggestions as CalibrationReport | null) ?? null,
      calibratedAt: (row?.threshold_calibrated_at as string | null) ?? null,
    };
  });

export const updateDetectionThresholds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => i as PartialThresholds)
  .handler(async ({ context, data }): Promise<Thresholds> => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const merged = resolveThresholds(data);
    await writeSettings(db, { detection_thresholds: merged });
    return merged;
  });

export const updateAlertingSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => i as { autoCalibrate?: boolean; escalationEnabled?: boolean; escalationAfterMinutes?: number; escalationMinUrgency?: string })
  .handler(async ({ context, data }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const patch: Record<string, unknown> = {};
    if (data.autoCalibrate !== undefined) patch.auto_calibrate_enabled = data.autoCalibrate;
    if (data.escalationEnabled !== undefined) patch.escalation_enabled = data.escalationEnabled;
    if (data.escalationAfterMinutes !== undefined) patch.escalation_after_minutes = Math.max(15, Math.min(1440, data.escalationAfterMinutes));
    if (data.escalationMinUrgency !== undefined && URGENCY_RANK[data.escalationMinUrgency] !== undefined) patch.escalation_min_urgency = data.escalationMinUrgency;
    if (Object.keys(patch).length) await writeSettings(db, patch);
    return { ok: true as const };
  });

// Continuous-learning: compute per-category alert precision from practitioner
// outcomes and store it as review-ready suggestions. Applying a suggestion stays
// a human decision (clinical safety + small early samples) via the thresholds UI.
export const runThresholdCalibration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CalibrationReport> => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const { data: rows } = await db.from("alerts").select("red_flag_category, outcome").not("outcome", "is", null).gte("created_at", since).limit(2000);
    const report = computeCalibration(((rows ?? []) as { red_flag_category: string | null; outcome: string | null }[]).map((r) => ({ category: r.red_flag_category, outcome: r.outcome })));
    await writeSettings(db, { threshold_suggestions: report, threshold_calibrated_at: report.generatedAt });
    return report;
  });

// Escalation: re-notify unacknowledged high-urgency alerts. OFF by default —
// returns skipped unless escalation_enabled is true, so no client/practitioner
// impact until a super-admin turns it on.
export const runEscalationSweep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true; skipped?: string; escalated: number }> => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const row = await settingsRow(db);
    if (!row || (row.escalation_enabled as boolean) !== true) return { ok: true, skipped: "disabled", escalated: 0 };
    const afterMinutes = (row.escalation_after_minutes as number | undefined) ?? 120;
    const minRank = URGENCY_RANK[(row.escalation_min_urgency as string | undefined) ?? "urgent"] ?? 3;
    const cutoff = new Date(Date.now() - afterMinutes * 60_000).toISOString();
    const { data: alerts } = await db.from("alerts").select("id, practitioner_id, client_id, urgency, message")
      .eq("escalation_fired", false).is("reviewed_at", null).is("outcome", null).lte("created_at", cutoff).limit(100);
    const list = ((alerts ?? []) as { id: string; practitioner_id: string; client_id: string; urgency: string; message: string | null }[])
      .filter((a) => (URGENCY_RANK[a.urgency] ?? 0) >= minRank);
    if (list.length === 0) return { ok: true, escalated: 0 };
    const { sendPushCore } = await import("@/lib/push.functions");
    let escalated = 0;
    for (const a of list) {
      try {
        await sendPushCore(supabaseAdmin, {
          userId: a.practitioner_id,
          title: "⏱ Unacknowledged alert",
          body: a.message ? `Still open: ${a.message}` : "A client alert is still unacknowledged — please review.",
          data: { type: "escalation", alertId: a.id, clientId: a.client_id },
        });
        await db.from("alerts").update({ escalation_fired: true }).eq("id", a.id);
        escalated++;
      } catch { /* best-effort */ }
    }
    return { ok: true, escalated };
  });
