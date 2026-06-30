import { createFileRoute } from "@tanstack/react-router";
import { log } from "@/lib/log";
import { verifyOuraWebhookSignature } from "@/lib/wearables/oura";
import { syncOuraForClient } from "@/lib/wearables/sync.functions";

// Oura webhook endpoint.
//  GET  — subscription verification challenge.
//  POST — event receipt. Verify HMAC, return 200 fast, refresh affected client async.
export const Route = createFileRoute("/api/public/wearables/oura/webhook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const verificationToken = url.searchParams.get("verification_token");
        const challenge = url.searchParams.get("challenge");
        const expected = process.env.OURA_WEBHOOK_VERIFICATION_TOKEN;
        if (expected && verificationToken === expected && challenge) {
          return Response.json({ challenge });
        }
        return new Response(JSON.stringify({ error: "Invalid verification token" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      },
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const signature = request.headers.get("x-oura-signature");
        const timestamp = request.headers.get("x-oura-timestamp");
        const secret = process.env.OURA_CLIENT_SECRET;

        // Verify HMAC when all parts are present.
        if (signature && timestamp && secret) {
          const ok = await verifyOuraWebhookSignature({ secret, timestamp, rawBody, signature });
          if (!ok) {
            return new Response(JSON.stringify({ error: "Invalid signature" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        let event: { user_id?: string } = {};
        try {
          event = JSON.parse(rawBody) as { user_id?: string };
        } catch {
          /* ignore malformed */
        }

        // Resolve the client from the Oura user id and re-sync (best effort, async).
        if (event.user_id) {
          void (async () => {
            try {
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
              const { data } = await supabaseAdmin
                .from("wearable_tokens")
                .select("client_id")
                .eq("provider", "oura")
                .eq("provider_user_id", event.user_id!)
                .maybeSingle();
              const clientId = data?.client_id as string | undefined;
              if (clientId) await syncOuraForClient(supabaseAdmin, clientId, 2);
            } catch (e) {
              log.warn("Oura webhook processing failed", e);
            }
          })();
        }

        // Always 200 quickly (Oura has a ~10s limit).
        return Response.json({ success: true });
      },
    },
  },
});
