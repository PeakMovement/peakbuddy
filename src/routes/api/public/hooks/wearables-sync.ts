import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { syncOuraForClient, syncPolarForClient } from "@/lib/wearables/sync.functions";

/**
 * Daily Polar/Oura pull. Garmin is push-only (webhook) so it is not pulled here.
 * Guarded by CRON_SECRET. Schedule: once daily after midnight SAST.
 */
const BATCH = 80;

export const Route = createFileRoute("/api/public/hooks/wearables-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = authorizeCronRequest(request);
        if (denied) return denied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: tokens, error } = await supabaseAdmin
          .from("wearable_tokens")
          .select("client_id, provider")
          .eq("status", "active")
          .in("provider", ["oura", "polar"])
          .order("updated_at", { ascending: true })
          .limit(BATCH);

        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        const stats = { oura: 0, polar: 0, errors: 0, skipped: 0 };
        for (const t of tokens ?? []) {
          try {
            if (t.provider === "oura") {
              await syncOuraForClient(supabaseAdmin, t.client_id as string, 2);
              stats.oura += 1;
            } else if (t.provider === "polar") {
              await syncPolarForClient(supabaseAdmin, t.client_id as string);
              stats.polar += 1;
            } else {
              stats.skipped += 1;
            }
          } catch (e) {
            stats.errors += 1;
            log.warn("wearables-sync failed", { provider: t.provider, error: e });
          }
        }

        return Response.json({ ok: true, ...stats, scanned: tokens?.length ?? 0 });
      },
    },
  },
});
