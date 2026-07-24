import { createFileRoute } from "@tanstack/react-router";
import { log } from "@/lib/log";
import { exchangePolarCode, PolarError, registerPolarUser } from "@/lib/wearables/polar";
import { polarCreds, polarRedirectUri, upsertToken } from "@/lib/wearables/tokens";
import { syncPolarForClient } from "@/lib/wearables/sync.functions";

// Polar redirects here after authorization. Exchange the code, register the user
// with AccessLink, store the (long-lived) token, kick off an initial sync.
export const Route = createFileRoute("/api/public/wearables/polar/callback")({
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
            headers: { Location: `${base}/client/app/profile?wearable=polar&status=${status}` },
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
            .eq("provider", "polar")
            .maybeSingle();
          if (!stateRow) return back("error");
          await supabaseAdmin.from("wearable_oauth_state").delete().eq("state", state);
          if (new Date(stateRow.expires_at).getTime() < Date.now()) return back("error");
          const resolvedClientId = stateRow.client_id as string;

          const { clientId, clientSecret } = polarCreds();
          const tokens = await exchangePolarCode({
            code,
            clientId,
            clientSecret,
            redirectUri: polarRedirectUri(),
          });

          // Register with AccessLink (idempotent; 403 => consent needed).
          await registerPolarUser({ accessToken: tokens.access_token, memberId: resolvedClientId });
          await upsertToken(supabaseAdmin, {
            client_id: resolvedClientId,
            provider: "polar",
            access_token: tokens.access_token,
            refresh_token: null, // Polar tokens are long-lived
            expires_at: null,
            provider_user_id: tokens.x_user_id,
          });

          try {
            await syncPolarForClient(supabaseAdmin, resolvedClientId);
          } catch (e) {
            log.warn(`Initial Polar sync failed for client ${resolvedClientId}`, e);
          }

          return back("connected");
        } catch (e) {
          if (e instanceof PolarError && e.code === "consent_required") return back("consent");
          log.warn("Polar callback failed", e);
          return back("error");
        }
      },
    },
  },
});
