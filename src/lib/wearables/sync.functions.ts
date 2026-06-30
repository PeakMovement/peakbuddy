import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { log } from "@/lib/log";
import { fetchOuraSessions } from "./oura";
import { fetchPolarExercises, fetchPolarSleep, PolarError } from "./polar";
import { requestGarminBackfill } from "./garmin";
import { getConnection, getValidOuraAccessToken, resolveClientId } from "./tokens";
import type { WearableProvider } from "./connect.functions";

type AdminClient = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

async function upsertSessions(
  admin: AdminClient,
  clientId: string,
  rows: Array<Record<string, unknown> & { source: string; date: string }>,
) {
  if (rows.length === 0) return 0;
  const fetchedAt = new Date().toISOString();
  const { error } = await admin.from("wearable_sessions").upsert(
    rows.map((r) => ({ ...r, client_id: clientId, fetched_at: fetchedAt })),
    { onConflict: "client_id,source,date" },
  );
  if (error) throw new Error(`Failed to store sessions: ${error.message}`);
  return rows.length;
}

function dateNDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Pull recent Oura data for one client and upsert it into wearable_sessions.
 * Reusable from the "Sync now" button, the OAuth callback, the webhook, and cron.
 */
export async function syncOuraForClient(
  admin: AdminClient,
  clientId: string,
  days = 7,
): Promise<{ synced: number }> {
  const accessToken = await getValidOuraAccessToken(admin, clientId);
  const rows = await fetchOuraSessions({
    accessToken,
    startDate: dateNDaysAgo(days),
    endDate: new Date().toISOString().slice(0, 10),
  });
  const synced = await upsertSessions(admin, clientId, rows);
  return { synced };
}

/**
 * Pull Polar sleep + exercises for one client and upsert into wearable_sessions.
 * Sleep and activity rows are upserted separately so they merge into the same day.
 */
export async function syncPolarForClient(
  admin: AdminClient,
  clientId: string,
): Promise<{ synced: number }> {
  const token = await getConnection(admin, clientId, "polar");
  if (!token?.access_token) throw new PolarError("NO_TOKEN", "No Polar connection for this client");
  const [sleep, exercises] = await Promise.all([
    fetchPolarSleep(token.access_token),
    fetchPolarExercises(token.access_token),
  ]);
  const synced =
    (await upsertSessions(admin, clientId, sleep)) +
    (await upsertSessions(admin, clientId, exercises));
  return { synced };
}

/**
 * Garmin is push-only — "sync" re-requests a backfill; data arrives via webhook.
 */
export async function syncGarminForClient(
  admin: AdminClient,
  clientId: string,
  days = 7,
): Promise<{ synced: number }> {
  const token = await getConnection(admin, clientId, "garmin");
  if (!token?.access_token) throw new Error("No Garmin connection for this client");
  await requestGarminBackfill({ accessToken: token.access_token, days });
  return { synced: 0 }; // data arrives asynchronously via the webhook
}

/** On-demand "Sync now" for the logged-in client. */
export const syncWearable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { provider: WearableProvider }) => {
    const ok: WearableProvider[] = ["oura", "polar", "garmin"];
    if (!data?.provider || !ok.includes(data.provider)) throw new Error("Invalid provider");
    return data;
  })
  .handler(async ({ data, context }): Promise<{ ok: boolean; synced: number; error?: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const clientId = await resolveClientId(supabaseAdmin, context.userId);
    if (!clientId) throw new Error("No client record for this account");
    try {
      const { synced } =
        data.provider === "oura"
          ? await syncOuraForClient(supabaseAdmin, clientId)
          : data.provider === "polar"
            ? await syncPolarForClient(supabaseAdmin, clientId)
            : await syncGarminForClient(supabaseAdmin, clientId);
      return { ok: true, synced };
    } catch (e) {
      log.warn(`${data.provider} sync failed for client ${clientId}`, e);
      const msg = e instanceof Error ? e.message : "Sync failed";
      // Surface a reconnect / consent hint when relevant.
      if (/consent_required/.test(msg)) return { ok: false, synced: 0, error: "consent" };
      return {
        ok: false,
        synced: 0,
        error: /invalid_grant|NO_TOKEN/.test(msg) ? "reconnect" : msg,
      };
    }
  });
