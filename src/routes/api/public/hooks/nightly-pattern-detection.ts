import { createFileRoute } from "@tanstack/react-router";
import { trackedJob } from "@/lib/job-runs.server";
import { log } from "@/lib/log";
import {
  detectWeekdayPatterns,
  sastDayStartIso,
  type CheckInInput,
  type DetectedPattern,
} from "@/lib/client-patterns";
import { patternInsightDraft } from "@/lib/capabilities";
import { authorizeCronRequest } from "@/lib/cron-auth";

// #5 Predictive nudges — Phase 2 detection job.
// Nightly, for each client with passive_monitoring_enabled: pull ~90 days of
// check-ins, detect day-of-week patterns, and upsert them into client_patterns.
// This does not call a model and does not check AI consent. It has no
// user-facing effect — it only maintains the pattern store the practitioner
// view reads. Nudge sending is a separate gate. Dates are South African.

const BATCH_SIZE = 50;
const LOOKBACK_DAYS = 90;

type ClientRow = { id: string; practitioner_id: string; full_name: string | null };

type AdminClient = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

async function writePatternDraft(
  supabaseAdmin: AdminClient,
  client: ClientRow,
  patterns: DetectedPattern[],
): Promise<void> {
  const top = patterns[0];
  if (!top || !client.practitioner_id) return;
  const { count } = await supabaseAdmin
    .from("practitioner_drafts")
    .select("id", { count: "exact", head: true })
    .eq("client_id", client.id)
    .eq("kind", "pattern_insight")
    .gte("created_at", sastDayStartIso());
  if ((count ?? 0) > 0) return;
  const direction = top.pattern_type === "weekday_low" ? "low" : "high";
  const draft = patternInsightDraft({
    clientName: (client.full_name || "A client").trim(),
    dayOfWeek: top.day_of_week,
    metric: top.metric,
    direction,
  });
  await supabaseAdmin.from("practitioner_drafts").insert({
    practitioner_id: client.practitioner_id,
    client_id: client.id,
    kind: "pattern_insight",
    draft_title: draft.title,
    draft_body: draft.body,
    suggested_action: {},
    status: "new",
  });
}

async function detectForClient(supabaseAdmin: AdminClient, client: ClientRow): Promise<number> {
  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows } = await supabaseAdmin
    .from("check_ins")
    .select("created_at, pain_level, energy_level, stress_level, sleep_quality")
    .eq("client_id", client.id)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(400);

  const checkins = (rows ?? []) as CheckInInput[];
  const patterns = detectWeekdayPatterns(checkins);

  // Deactivate stale patterns first (best-effort), then upsert current ones.
  await supabaseAdmin.from("client_patterns").update({ active: false }).eq("client_id", client.id);

  if (patterns.length === 0) return 0;

  const nowIso = new Date().toISOString();
  const payload = patterns.map((p) => ({
    client_id: client.id,
    pattern_type: p.pattern_type,
    day_of_week: p.day_of_week,
    metric: p.metric,
    avg_value: p.avg_value,
    confidence: p.confidence,
    sample_size: p.sample_size,
    last_detected_at: nowIso,
    active: true,
  }));

  const { error } = await supabaseAdmin
    .from("client_patterns")
    .upsert(payload as never, { onConflict: "client_id,pattern_type,day_of_week,metric" });
  if (error) {
    log.error(`[patternDetect] upsert failed for ${client.id}`, error);
    return 0;
  }
  await writePatternDraft(supabaseAdmin, client, patterns).catch((e) => {
    log.warn("[patternDetect] draft not written", {
      error: e instanceof Error ? e.message : "unknown",
    });
  });
  return patterns.length;
}

export const Route = createFileRoute("/api/public/hooks/nightly-pattern-detection")({
  server: {
    handlers: {
      POST: trackedJob("nightly-pattern-detection", async ({ request }: { request: Request }) => {
        const denied = await authorizeCronRequest(request);
        if (denied) return denied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Platform kill-switch (shared with passive monitoring).
        const { data: settings } = await supabaseAdmin
          .from("platform_settings")
          .select("passive_monitoring_enabled")
          .limit(1)
          .maybeSingle();
        if (
          (settings as { passive_monitoring_enabled?: boolean } | null)
            ?.passive_monitoring_enabled === false
        ) {
          return Response.json({ ok: true, skipped: "feature_disabled" });
        }

        const stats = { processed: 0, patterns: 0, errors: 0 };
        let from = 0;
        for (;;) {
          const { data: clients, error } = await supabaseAdmin
            .from("clients")
            .select("id, practitioner_id, full_name")
            .eq("passive_monitoring_enabled", true)
            .order("id", { ascending: true })
            .range(from, from + BATCH_SIZE - 1);
          if (error) {
            log.error("[patternDetect] client batch fetch failed", error);
            break;
          }
          const rows = (clients ?? []) as ClientRow[];
          if (rows.length === 0) break;
          for (const c of rows) {
            try {
              stats.patterns += await detectForClient(supabaseAdmin, c);
              stats.processed += 1;
            } catch (e) {
              stats.errors += 1;
              log.error(`[patternDetect] client ${c.id} failed`, e);
            }
          }
          if (rows.length < BATCH_SIZE) break;
          from += BATCH_SIZE;
        }

        return Response.json({ ok: true, ...stats });
      }),
    },
  },
});
