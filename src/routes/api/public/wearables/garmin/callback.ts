import { createFileRoute } from "@tanstack/react-router";
import { log } from "@/lib/log";
import { exchangeGarminCode, fetchGarminUserId, GarminError } from "@/lib/wearables/garmin";
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
        // Where to send the browser. Known once the state row is read: a patient
        // without an app login goes to the public connect page, not a sign-in.
        let returnClientId: string | null = null;
        const back = async (status: string) => {
          let location = `${base}/client/app/profile?wearable=garmin&status=${status}`;
          if (returnClientId) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { wearableReturnUrl } = await import("@/lib/wearables/watch-link.server");
            location = await wearableReturnUrl(
              supabaseAdmin,
              base,
              returnClientId,
              "garmin",
              status,
            );
          }
          return new Response(null, { status: 302, headers: { Location: location } });
        };

        if (oauthError || !code || !state) {
          // Cancelled on the provider's page: still send them back to the right place.
          if (state) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data: row } = await supabaseAdmin
              .from("garmin_oauth_state")
              .select("client_id")
              .eq("state", state)
              .maybeSingle();
            returnClientId = (row?.client_id as string | undefined) ?? null;
          }
          return back("error");
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Look up + consume the one-time PKCE state.
          const { data: stateRow } = await supabaseAdmin
            .from("garmin_oauth_state")
            .select("client_id, code_verifier, expires_at")
            .eq("state", state)
            .maybeSingle();
          if (!stateRow) return back("error");
          returnClientId = stateRow.client_id as string;
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

          // Redirect back immediately. The 30-day backfill makes ~200 sequential
          // Garmin calls (~25s) — running it here made the browser hang on Garmin's
          // "Agree" page. Instead the client fires a background "sync" once it lands
          // on the profile (see WearablesPanel), and Garmin also pushes new data to
          // our webhook automatically. Consent/permission issues surface on that sync.
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
