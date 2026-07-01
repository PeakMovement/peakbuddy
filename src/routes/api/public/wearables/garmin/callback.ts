import { createFileRoute } from "@tanstack/react-router";
import { log } from "@/lib/log";
import {
  exchangeGarminCode,
  fetchGarminUserId,
  GarminError,
  requestGarminBackfill,
} from "@/lib/wearables/garmin";
import { garminCreds, garminRedirectUri, upsertToken } from "@/lib/wearables/tokens";

// Garmin redirects here with ?code&state. We look up the PKCE verifier stashed at
// connect time (keyed by state), exchange the code, store tokens, fetch the stable
// user id for webhook routing, and request a backfill (data arrives via webhook).
export const Route = createFileRoute("/api/public/wearables/garmin/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const oauthError = url.searchParams.get("error");
        const base = process.env.BUDDY_APP_BASE_URL ?? url.origin;
        const back = (status: string) =>
          new Response(null, {
            status: 302,
            headers: { Location: `${base}/client/app/profile?wearable=garmin&status=${status}` },
          });

        if (oauthError || !code || !state) return back("error");

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Look up + consume the one-time PKCE state.
          const { data: stateRow } = await supabaseAdmin
            .from("garmin_oauth_state")
            .select("client_id, code_verifier, expires_at")
            .eq("state", state)
            .maybeSingle();
          if (!stateRow) return back("error");
          await supabaseAdmin.from("garmin_oauth_state").delete().eq("state", state);
          if (new Date(stateRow.expires_at).getTime() < Date.now()) return back("error");

          const clientId = stateRow.client_id as string;
          const { clientId: garminClientId, clientSecret } = garminCreds();
          const tokens = await exchangeGarminCode({
            code,
            codeVerifier: stateRow.code_verifier as string,
            clientId: garminClientId,
            clientSecret,
            redirectUri: garminRedirectUri(),
          });

          const providerUserId = await fetchGarminUserId(tokens.access_token);

          await upsertToken(supabaseAdmin, {
            client_id: clientId,
            provider: "garmin",
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            // 10-min safety margin, matching Predictiv.
            expires_at: new Date(Date.now() + (tokens.expires_in - 600) * 1000).toISOString(),
            provider_user_id: providerUserId,
          });

          // Request history; Garmin pushes it to our webhook asynchronously.
          try {
            const result = await requestGarminBackfill({
              accessToken: tokens.access_token,
              days: 30,
            });
            log.info(
              `Garmin backfill for client ${clientId}: attempted=${result.attempted} accepted=${result.accepted} forbidden=${result.forbidden}`,
            );
          } catch (e) {
            if (e instanceof GarminError && e.code === "consent_required") {
              return back("consent");
            }
            log.warn(`Garmin backfill request failed for client ${clientId}`, e);
          }

          return back("connected");
        } catch (e) {
          if (e instanceof GarminError && e.code === "consent_required") return back("consent");
          log.warn("Garmin callback failed", e);
          return back("error");
        }
      },
    },
  },
});
