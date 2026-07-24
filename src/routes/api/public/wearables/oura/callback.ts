import { createFileRoute } from "@tanstack/react-router";
import { log } from "@/lib/log";
import { exchangeOuraCode, OURA } from "@/lib/wearables/oura";
import { ouraCreds, ouraRedirectUri, upsertToken } from "@/lib/wearables/tokens";
import { syncOuraForClient } from "@/lib/wearables/sync.functions";

// Oura redirects the user's browser here after they authorize. We exchange the
// code, store the token for the client carried in `state`, kick off an initial
// sync, then bounce the browser back to the profile page.
export const Route = createFileRoute("/api/public/wearables/oura/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state"); // = our client_id
        const base = process.env.BUDDY_APP_BASE_URL ?? url.origin;
        const back = (status: string) =>
          new Response(null, {
            status: 302,
            headers: { Location: `${base}/client/app/profile?wearable=oura&status=${status}` },
          });

        if (!code || !state) return back("error");

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Consume the one-time server-side state (guards against OAuth CSRF /
          // an attacker-chosen client_id).
          const { data: stateRow } = await supabaseAdmin
            .from("wearable_oauth_state")
            .select("client_id, provider, expires_at")
            .eq("state", state)
            .eq("provider", "oura")
            .maybeSingle();
          if (!stateRow) return back("error");
          await supabaseAdmin.from("wearable_oauth_state").delete().eq("state", state);
          if (new Date(stateRow.expires_at).getTime() < Date.now()) return back("error");
          const resolvedClientId = stateRow.client_id as string;

          const { clientId, clientSecret } = ouraCreds();
          const tokens = await exchangeOuraCode({
            code,
            clientId,
            clientSecret,
            redirectUri: ouraRedirectUri(),
          });

          // Best-effort: fetch the stable Oura user id for webhook routing later.
          let providerUserId: string | null = null;
          try {
            const piRes = await fetch(`${OURA.API_BASE}/personal_info`, {
              headers: { Authorization: `Bearer ${tokens.access_token}` },
            });
            if (piRes.ok) {
              const pi = (await piRes.json()) as { id?: string };
              providerUserId = pi.id ?? null;
            }
          } catch {
            /* non-fatal */
          }

          await upsertToken(supabaseAdmin, {
            client_id: resolvedClientId,
            provider: "oura",
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
            provider_user_id: providerUserId,
          });

          // Initial backfill (last 30 days) so data shows immediately.
          try {
            await syncOuraForClient(supabaseAdmin, resolvedClientId, 30);
          } catch (e) {
            log.warn(`Initial Oura sync failed for client ${resolvedClientId}`, e);
          }

          return back("connected");
        } catch (e) {
          log.warn("Oura callback failed", e);
          return back("error");
        }
      },
    },
  },
});
