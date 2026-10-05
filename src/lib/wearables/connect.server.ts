import { buildOuraAuthorizeUrl } from "./oura";
import { buildPolarAuthorizeUrl } from "./polar";
import {
  buildGarminAuthorizeUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from "./garmin";
import {
  garminCreds,
  garminRedirectUri,
  ouraCreds,
  ouraRedirectUri,
  polarCreds,
  polarRedirectUri,
} from "./tokens";
import type { WearableProvider } from "./connect.functions";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

/**
 * Start an OAuth connect for one profile and return the provider's authorize
 * URL. Shared by the in-app Wearables panel (signed-in patient) and the
 * WhatsApp "connect your watch" page (personal signed link, no login).
 */
export async function beginWearableConnect(
  supabaseAdmin: Admin,
  clientId: string,
  provider: WearableProvider,
): Promise<string> {
  const data = { provider };
  // Oura + Polar: stash a random, single-use state server-side (10-min TTL)
  // instead of round-tripping the raw client_id, so the callback can't be
  // driven with an attacker-chosen client_id (OAuth CSRF / account linking).
  if (data.provider === "oura" || data.provider === "polar") {
    const state = generateState();
    await supabaseAdmin
      .from("wearable_oauth_state")
      .delete()
      .eq("client_id", clientId)
      .eq("provider", data.provider);
    const { error } = await supabaseAdmin.from("wearable_oauth_state").insert({
      state,
      client_id: clientId,
      provider: data.provider,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (error) throw new Error(`Failed to start ${data.provider} connect: ${error.message}`);

    if (data.provider === "oura") {
      const { clientId: ouraClientId } = ouraCreds();
      return buildOuraAuthorizeUrl({
        clientId: ouraClientId,
        redirectUri: ouraRedirectUri(),
        state,
      });
    }
    const { clientId: polarClientId } = polarCreds();
    return buildPolarAuthorizeUrl({
      clientId: polarClientId,
      redirectUri: polarRedirectUri(),
      state,
    });
  }

  if (data.provider === "garmin") {
    const { clientId: garminClientId } = garminCreds();
    // PKCE: stash the verifier server-side keyed by a random state (10-min TTL).
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();
    await supabaseAdmin.from("garmin_oauth_state").delete().eq("client_id", clientId);
    const { error } = await supabaseAdmin.from("garmin_oauth_state").insert({
      state,
      client_id: clientId,
      code_verifier: codeVerifier,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (error) throw new Error(`Failed to start Garmin connect: ${error.message}`);
    return buildGarminAuthorizeUrl({
      clientId: garminClientId,
      redirectUri: garminRedirectUri(),
      state,
      codeChallenge,
    });
  }

  throw new Error(`${data.provider} connect is not available yet`);
}
