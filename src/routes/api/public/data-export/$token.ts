import { createFileRoute } from "@tanstack/react-router";

/**
 * One-time download of a patient's own Buddy record. The token is the secret.
 * A second request, or an expired link, is refused. The body is their record
 * and nothing Buddy interpreted.
 */
export const Route = createFileRoute("/api/public/data-export/$token")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = decodeURIComponent(url.pathname.split("/").pop() ?? "");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { claimExportDownload } = await import("@/lib/whatsapp/data-copy.server");
        const bundle = await claimExportDownload(
          supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient,
          token,
        ).catch(() => null);
        if (!bundle) return new Response("This link has expired.", { status: 410 });
        return new Response(JSON.stringify(bundle, null, 2), {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": "attachment; filename=\"buddy-record.json\"",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
