import { createFileRoute } from "@tanstack/react-router";
import { trackedJob } from "@/lib/job-runs.server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { log } from "@/lib/log";

/**
 * Cron endpoint, every minute. The backstop for the WhatsApp worker: the
 * webhook already processes each message as it arrives, and this drains
 * anything that call did not finish (a timeout, a deploy mid-request).
 * Safe to overlap with the webhook because every message is claimed before
 * it is handled.
 */
export const Route = createFileRoute("/api/public/hooks/whatsapp-worker")({
  server: {
    handlers: {
      POST: trackedJob("whatsapp-worker-tick", async ({ request }: { request: Request }) => {
        const denied = await authorizeCronRequest(request);
        if (denied) return denied;

        const { processPendingInbound, whatsappConfigFromEnv } =
          await import("@/lib/whatsapp/worker.server");
        const cfg = whatsappConfigFromEnv();
        if (!cfg) {
          return new Response(JSON.stringify({ ok: true, skipped: "not_configured" }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const result = await processPendingInbound({ admin: supabaseAdmin as never, ...cfg }, 25);
        if (result.failed > 0) log.warn("whatsapp worker hook", result);

        // Practitioner client updates and requested check-in answers.
        try {
          const { runPractitionerJobs } = await import("@/lib/whatsapp/practitioner-status.server");
          await runPractitionerJobs(supabaseAdmin as never, cfg);
        } catch (e) {
          log.warn("practitioner jobs failed", {
            error: e instanceof Error ? e.message : "unknown",
          });
        }

        return new Response(JSON.stringify({ ok: true, ...result }), {
          headers: { "Content-Type": "application/json" },
        });
      }),
    },
  },
});
