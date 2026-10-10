import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { trackedJob } from "@/lib/job-runs.server";
import { log } from "@/lib/log";

/**
 * Cron endpoint, daily 05:45 UTC (07:45 SAST). Checks every scheduled job ran
 * as expected and emails Peak Movement if not. See src/lib/job-runs.server.ts.
 * The same daily run deletes WhatsApp rows that are no longer on a patient
 * record (the retention rule in src/lib/retention.server.ts).
 */
export const Route = createFileRoute("/api/public/hooks/job-health-check")({
  server: {
    handlers: {
      POST: trackedJob("job-health-check", async ({ request }: { request: Request }) => {
        const denied = await authorizeCronRequest(request);
        if (denied) return denied;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runJobHealthCheck } = await import("@/lib/job-runs.server");
        const { runWhatsAppRetention } = await import("@/lib/retention.server");
        const result = await runJobHealthCheck(supabaseAdmin);
        let retention: { inbound: number; outbound: number; conversations: number } | null = null;
        try {
          retention = await runWhatsAppRetention(supabaseAdmin);
        } catch (e) {
          log.warn("whatsapp retention failed", {
            error: e instanceof Error ? e.message : "unknown",
          });
        }
        return Response.json({ ...result, retention });
      }),
    },
  },
});
