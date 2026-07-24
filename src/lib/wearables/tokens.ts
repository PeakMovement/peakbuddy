// Wearable token storage + valid-token resolution (with refresh).
// Service-role only: callers pass the admin client (RLS-bypassing).
import type { Database } from "@/integrations/supabase/types";
import { log } from "@/lib/log";
import { OuraError, refreshOuraToken } from "./oura";
import { GarminError, refreshGarminToken } from "./garmin";

type AdminClient = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type Provider = "oura" | "polar" | "garmin";

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh if expiring within 5 min

export function ouraCreds() {
  const clientId = process.env.OURA_CLIENT_ID;
  const clientSecret = process.env.OURA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing OURA_CLIENT_ID / OURA_CLIENT_SECRET");
  }
  return { clientId, clientSecret };
}

/** Default redirect URI; OURA_REDIRECT_URI overrides (must match the Oura app config). */
export function ouraRedirectUri() {
  const base = process.env.BUDDY_APP_BASE_URL ?? "https://peakbuddy.lovable.app";
  return process.env.OURA_REDIRECT_URI ?? `${base}/api/public/wearables/oura/callback`;
}

export function polarCreds() {
  const clientId = process.env.POLAR_CLIENT_ID;
  const clientSecret = process.env.POLAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing POLAR_CLIENT_ID / POLAR_CLIENT_SECRET");
  }
  return { clientId, clientSecret };
}

/** Default redirect URI; POLAR_REDIRECT_URI overrides (must match the Polar app config). */
export function polarRedirectUri() {
  const base = process.env.BUDDY_APP_BASE_URL ?? "https://peakbuddy.lovable.app";
  return process.env.POLAR_REDIRECT_URI ?? `${base}/api/public/wearables/polar/callback`;
}

export function garminCreds() {
  const clientId = process.env.GARMIN_CONSUMER_KEY;
  const clientSecret = process.env.GARMIN_CONSUMER_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing GARMIN_CONSUMER_KEY / GARMIN_CONSUMER_SECRET");
  }
  return { clientId, clientSecret };
}

/** Default redirect URI; GARMIN_REDIRECT_URI overrides (must match the Garmin app config). */
export function garminRedirectUri() {
  const base = process.env.BUDDY_APP_BASE_URL ?? "https://peakbuddy.lovable.app";
  return process.env.GARMIN_REDIRECT_URI ?? `${base}/api/public/wearables/garmin/callback`;
}

/** Resolve the caller's client_id from their auth user id (clients.auth_user_id). */
export async function resolveClientId(
  admin: AdminClient,
  authUserId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("clients")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function upsertToken(
  admin: AdminClient,
  row: Database["public"]["Tables"]["wearable_tokens"]["Insert"],
) {
  const { error } = await admin.from("wearable_tokens").upsert(
    { ...row, status: "active", updated_at: new Date().toISOString() },
    {
      onConflict: "client_id,provider",
    },
  );
  if (error) throw new Error(`Failed to store ${row.provider} token: ${error.message}`);
}

export async function getConnection(admin: AdminClient, clientId: string, provider: Provider) {
  const { data } = await admin
    .from("wearable_tokens")
    .select("access_token, refresh_token, expires_at, status, provider_user_id")
    .eq("client_id", clientId)
    .eq("provider", provider)
    .maybeSingle();
  return data;
}

export async function deleteConnection(admin: AdminClient, clientId: string, provider: Provider) {
  const { error } = await admin
    .from("wearable_tokens")
    .delete()
    .eq("client_id", clientId)
    .eq("provider", provider);
  if (error) throw new Error(`Failed to disconnect ${provider}: ${error.message}`);
}

/**
 * Return a valid Oura access token for a client, refreshing if it expires within
 * 5 minutes. On invalid_grant the connection is marked token_expired and we throw
 * so the UI can prompt a reconnect.
 */
export async function getValidOuraAccessToken(
  admin: AdminClient,
  clientId: string,
): Promise<string> {
  const token = await getConnection(admin, clientId, "oura");
  if (!token?.access_token || !token.refresh_token) {
    throw new OuraError("NO_TOKEN", "No Oura connection for this client");
  }

  const expiresAt = token.expires_at ? new Date(token.expires_at).getTime() : 0;
  if (expiresAt - Date.now() > REFRESH_BUFFER_MS) {
    return token.access_token;
  }

  const { clientId: cid, clientSecret } = ouraCreds();
  try {
    const refreshed = await refreshOuraToken({
      refreshToken: token.refresh_token,
      clientId: cid,
      clientSecret,
    });
    await admin
      .from("wearable_tokens")
      .update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("client_id", clientId)
      .eq("provider", "oura");
    return refreshed.access_token;
  } catch (e) {
    if (e instanceof OuraError && e.code === "invalid_grant") {
      await admin
        .from("wearable_tokens")
        .update({ status: "token_expired", updated_at: new Date().toISOString() })
        .eq("client_id", clientId)
        .eq("provider", "oura");
    }
    log.warn(`Oura token refresh failed for client ${clientId}`, e);
    throw e;
  }
}


/**
 * Return a valid Garmin access token for a client, refreshing if it expires
 * within 5 minutes. Garmin access tokens live ~24h, so without this the
 * "Sync now" backfill silently fails a day after connecting. On refresh
 * failure the connection is marked token_expired so the UI prompts a reconnect.
 */
export async function getValidGarminAccessToken(
  admin: AdminClient,
  clientId: string,
): Promise<string> {
  const token = await getConnection(admin, clientId, "garmin");
  if (!token?.access_token) {
    throw new GarminError("NO_TOKEN", "No Garmin connection for this client");
  }

  const expiresAt = token.expires_at ? new Date(token.expires_at).getTime() : 0;
  if (!token.refresh_token || expiresAt - Date.now() > REFRESH_BUFFER_MS) {
    // No refresh token (legacy connection) — return what we have and let the
    // call fail loudly if it's actually expired, prompting a reconnect.
    return token.access_token;
  }

  const { clientId: cid, clientSecret } = garminCreds();
  try {
    const refreshed = await refreshGarminToken({
      refreshToken: token.refresh_token,
      clientId: cid,
      clientSecret,
    });
    await admin
      .from("wearable_tokens")
      .update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at: new Date(Date.now() + (refreshed.expires_in - 600) * 1000).toISOString(),
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("client_id", clientId)
      .eq("provider", "garmin");
    return refreshed.access_token;
  } catch (e) {
    await admin
      .from("wearable_tokens")
      .update({ status: "token_expired", updated_at: new Date().toISOString() })
      .eq("client_id", clientId)
      .eq("provider", "garmin");
    log.warn(`Garmin token refresh failed for client ${clientId}`, e);
    throw e;
  }
}
