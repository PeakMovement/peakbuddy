import { createFileRoute } from "@tanstack/react-router";
import { trackedJob } from "@/lib/job-runs.server";
import { authorizeCronRequest } from "@/lib/cron-auth";

/**
 * Cron endpoint — runs every 5 minutes.
 * Sends a "time to check in" to any client whose reminder falls in the current
 * 5-minute window in their local timezone and hasn't been sent today: on
 * WhatsApp for WhatsApp patients (daily by default), as an app push otherwise.
 */
export const Route = createFileRoute("/api/public/hooks/checkin-reminders")({
  server: {
    handlers: {
      POST: trackedJob("checkin-reminders-tick", async ({ request }: { request: Request }) => {
        const denied = await authorizeCronRequest(request);
        if (denied) return denied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runCheckinReminderTick } =
          await import("@/lib/whatsapp/checkin-reminder-tick.server");
        const { ok, error, sent, skipped, undelivered } = await runCheckinReminderTick(
          supabaseAdmin,
          new Date(),
        );
        if (!ok) {
          return new Response(JSON.stringify({ ok: false, error }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ ok: true, sent, skipped, undelivered }), {
          headers: { "Content-Type": "application/json" },
        });
      }),
    },
  },
});
