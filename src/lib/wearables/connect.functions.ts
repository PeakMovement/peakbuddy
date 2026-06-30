import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildOuraAuthorizeUrl } from "./oura";
import { buildPolarAuthorizeUrl } from "./polar";
import {
  buildGarminAuthorizeUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from "./garmin";
import {
  deleteConnection,
  garminCreds,
  garminRedirectUri,
  ouraCreds,
  ouraRedirectUri,
  polarCreds,
  polarRedirectUri,
  resolveClientId,
} from "./tokens";

export type WearableProvider = "oura" | "polar" | "garmin";
const PROVIDERS: WearableProvider[] = ["oura", "polar", "garmin"];

export type ConnectionStatus = {
  provider: WearableProvider;
  connected: boolean;
  status: "active" | "token_expired" | "disconnected";
};

/** Connection status per provider for the logged-in client (drives the UI). */
export const getWearableConnections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConnectionStatus[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const clientId = await resolveClientId(supabaseAdmin, context.userId);
    if (!clientId)
      return PROVIDERS.map((p) => ({ provider: p, connected: false, status: "disconnected" }));

    const { data } = await supabaseAdmin
      .from("wearable_tokens")
      .select("provider, status")
      .eq("client_id", clientId);
    const byProvider = new Map((data ?? []).map((r) => [r.provider, r.status]));

    return PROVIDERS.map((p) => {
      const status = byProvider.get(p);
      return {
        provider: p,
        connected: status === "active",
        status: (status as ConnectionStatus["status"]) ?? "disconnected",
      };
    });
  });

/** Begin an OAuth connect: returns the provider authorize URL to redirect to. */
export const connectWearable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { provider: WearableProvider }) => {
    if (!data?.provider || !PROVIDERS.includes(data.provider)) {
      throw new Error("Invalid provider");
    }
    return data;
  })
  .handler(async ({ data, context }): Promise<{ authUrl: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const clientId = await resolveClientId(supabaseAdmin, context.userId);
    if (!clientId) throw new Error("No client record for this account");

    if (data.provider === "oura") {
      const { clientId: ouraClientId } = ouraCreds();
      const authUrl = buildOuraAuthorizeUrl({
        clientId: ouraClientId,
        redirectUri: ouraRedirectUri(),
        state: clientId, // round-trips our client_id back to the callback
      });
      return { authUrl };
    }

    if (data.provider === "polar") {
      const { clientId: polarClientId } = polarCreds();
      const authUrl = buildPolarAuthorizeUrl({
        clientId: polarClientId,
        redirectUri: polarRedirectUri(),
        state: clientId,
      });
      return { authUrl };
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
      const authUrl = buildGarminAuthorizeUrl({
        clientId: garminClientId,
        redirectUri: garminRedirectUri(),
        state,
        codeChallenge,
      });
      return { authUrl };
    }

    throw new Error(`${data.provider} connect is not available yet`);
  });

/** Disconnect a provider for the logged-in client. */
export const disconnectWearable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { provider: WearableProvider }) => {
    if (!data?.provider || !PROVIDERS.includes(data.provider)) {
      throw new Error("Invalid provider");
    }
    return data;
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const clientId = await resolveClientId(supabaseAdmin, context.userId);
    if (!clientId) throw new Error("No client record for this account");
    await deleteConnection(supabaseAdmin, clientId, data.provider);
    return { ok: true };
  });
