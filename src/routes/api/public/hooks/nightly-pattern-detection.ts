import { createFileRoute } from "@tanstack/react-router";
import { log } from "@/lib/log";
import { detectWeekdayPatterns, type CheckInInput } from "@/lib/client-patterns";

// #5 Predictive nudges — Phase 2 detection job.
// Nightly, consent-gated: for each client with passive_monitoring_enabled,
// pull ~90 days of check-ins, detect day-of-week patterns, and upsert them into
// client_patterns. This job has NO user-facing effect — it only maintains the
// pattern store the practitioner view (and, later, opt-in nudges) read from.
// Nudge SENDING is deliberately NOT part of this job; that is gated separately.

const BATCH_SIZE = 50;
const LOOKBACK_DAYS = 90;

type ClientRow = { id: string; practitioner_id: string };

type AdminClient = typeof import("@/integrations/supabase/client.server")["supabaseAdmin"];

async function detectForClient(supabaseAdmin: AdminClient, clientId: string): Promise<number> {
  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows } = await supabaseAdmin
    .from("check_ins")
    .select("created_at, pain_level, energy_level, stress_level, sleep_quality")
    .eq("client_id", clientId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(400);

  const checkins = (rows ?? []) as CheckInInput[];
  const patterns = detectWeekdayPatterns(checkins);

  // Deactivate stale patterns first (best-effort), then upsert current ones.
  await supabaseAdmin
    .from("client_patterns")
    .update({ active: false })
    .eq("client_id", clientId);

  if (patterns.length === 0) return 0;

  const nowIso = new Date().toISOString();
  const payload = patterns.map((p) => ({
    client_id: clientId,
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
    log.error(`[patternDetect] upsert failed for ${clientId}`, error);
    return 0;
  }
  return patterns.length;
}

export const Route = createFileRoute("/api/public/hooks/nightly-pattern-detection")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronSecret = process.env.CRON_SECRET;
        if (cronSecret) {
          const provided =
            request.headers.get("x-cron-secret") ??
            request.headers.get("X-Cron-Secret") ??
            (request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null);
          if (provided !== cronSecret) return new Response("Unauthorized", { status: 401 });
        } else {
          const apiKey = request.headers.get("apikey") ?? request.headers.get("Apikey");
          if (!apiKey || apiKey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
            return new Response("Unauthorized", { status: 401 });
          }
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Platform kill-switch (shared with passive monitoring).
        const { data: settings } = await supabaseAdmin
          .from("platform_settings")
          .select("passive_monitoring_enabled")
          .limit(1)
          .maybeSingle();
        if ((settings as { passive_monitoring_enabled?: boolean } | null)?.passive_monitoring_enabled === false) {
          return Response.json({ ok: true, skipped: "feature_disabled" });
        }

        const stats = { processed: 0, patterns: 0, errors: 0 };
        let from = 0;
        for (;;) {
          const { data: clients, error } = await supabaseAdmin
            .from("clients")
            .select("id, practitioner_id")
            .eq("passive_monitoring_enabled", true)
            .range(from, from + BATCH_SIZE - 1);
          if (error) {
            log.error("[patternDetect] client batch fetch failed", error);
            break;
          }
          const rows = (clients ?? []) as ClientRow[];
          if (rows.length === 0) break;
          for (const c of rows) {
            try {
              stats.patterns += await detectForClient(supabaseAdmin, c.id);
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
      },
    },
  },
});
