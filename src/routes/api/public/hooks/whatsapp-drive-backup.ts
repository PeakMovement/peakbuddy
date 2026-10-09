import { createFileRoute } from "@tanstack/react-router";
import { trackedJob } from "@/lib/job-runs.server";
import { authorizeCronRequest } from "@/lib/cron-auth";

/**
 * Cron endpoint, weekly (Monday early morning SAST). Backs up last week's
 * WhatsApp conversations to Peak Movement's private Google Drive. See
 * src/lib/whatsapp/drive-backup.server.ts.
 */
export const Route = createFileRoute("/api/public/hooks/whatsapp-drive-backup")({
  server: {
    handlers: {
      POST: trackedJob("whatsapp-drive-backup-weekly", async ({ request }: { request: Request }) => {
        const denied = await authorizeCronRequest(request);
        if (denied) return denied;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runWeeklyDriveBackup } = await import("@/lib/whatsapp/drive-backup.server");
        const result = await runWeeklyDriveBackup(supabaseAdmin);
        return new Response(JSON.stringify(result), {
          status: result.ok ? 200 : 503,
          headers: { "Content-Type": "application/json" },
        });
      }),
    },
  },
});
