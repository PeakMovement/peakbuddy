import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest } from "@/lib/cron-auth";

/**
 * Cron endpoint, daily 05:45 UTC (07:45 SAST). Checks every scheduled job ran
 * as expected and emails Peak Movement if not. See src/lib/job-runs.server.ts.
 */
export const Route = createFileRoute("/api/public/hooks/job-health-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authorizeCronRequest(request);
        if (denied) return denied;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runJobHealthCheck } = await import("@/lib/job-runs.server");
        const result = await runJobHealthCheck(supabaseAdmin);
        return Response.json(result);
      },
    },
  },
});
