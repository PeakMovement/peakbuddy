import { createFileRoute } from "@tanstack/react-router";
import { log } from "@/lib/log";
import {
  mapGarminActivity,
  mapGarminDaily,
  mapGarminHrv,
  mapGarminSleep,
  mapGarminUserMetrics,
  type GarminDailyRow,
} from "@/lib/wearables/garmin";

type AdminClient = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type Item = Record<string, unknown> & { userId?: string; userAccessToken?: string };

function ok200() {
  return new Response("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
}

/**
 * 3-tier client resolution: provider_user_id → access_token → single-active-user,
 * self-healing provider_user_id so future pushes resolve on tier 1.
 * (Self-heal is disabled for deregistration / permission-change payloads.)
 */
async function resolveClientId(
  admin: AdminClient,
  garminUserId: string | undefined,
  accessToken: string | undefined,
  allowSelfHeal: boolean,
): Promise<string | null> {
  if (garminUserId) {
    const { data } = await admin
      .from("wearable_tokens")
      .select("client_id")
      .eq("provider", "garmin")
      .eq("provider_user_id", garminUserId)
      .maybeSingle();
    if (data?.client_id) return data.client_id as string;
  }
  if (accessToken) {
    const { data } = await admin
      .from("wearable_tokens")
      .select("client_id, provider_user_id")
      .eq("provider", "garmin")
      .eq("access_token", accessToken)
      .maybeSingle();
    if (data?.client_id) {
      if (allowSelfHeal && garminUserId && data.provider_user_id !== garminUserId) {
        await admin
          .from("wearable_tokens")
          .update({ provider_user_id: garminUserId })
          .eq("client_id", data.client_id)
          .eq("provider", "garmin");
      }
      return data.client_id as string;
    }
  }
  // Fallback: single active garmin user (prefer one without provider_user_id).
  const { data: rows } = await admin
    .from("wearable_tokens")
    .select("client_id, provider_user_id")
    .eq("provider", "garmin")
    .eq("status", "active")
    .order("updated_at", { ascending: false });
  if (rows && rows.length > 0) {
    const pick = rows.find((r) => !r.provider_user_id) ?? rows[0];
    if (allowSelfHeal && garminUserId) {
      await admin
        .from("wearable_tokens")
        .update({ provider_user_id: garminUserId })
        .eq("client_id", pick.client_id)
        .eq("provider", "garmin");
    }
    return pick.client_id as string;
  }
  return null;
}

async function upsertRows(admin: AdminClient, clientId: string, rows: GarminDailyRow[]) {
  if (rows.length === 0) return;
  const fetchedAt = new Date().toISOString();
  await admin.from("wearable_sessions").upsert(
    rows.map((r) => ({ ...r, client_id: clientId, fetched_at: fetchedAt })),
    { onConflict: "client_id,source,date" },
  );
}

export const Route = createFileRoute("/api/public/wearables/garmin/webhook")({
  server: {
    handlers: {
      // Garmin validates the endpoint with a GET.
      GET: async () => ok200(),
      POST: async ({ request }) => {
        try {
          const payload = (await request.json()) as Record<string, Item[] | undefined>;
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Resolve + map simple per-item summaries (dailies / sleeps / hrv).
          const simple: Array<{
            items?: Item[];
            map: (i: Item) => { date: string; row: GarminDailyRow } | null;
          }> = [
            { items: payload.dailies, map: mapGarminDaily },
            { items: payload.sleeps, map: mapGarminSleep },
            { items: payload.hrvSummaries, map: mapGarminHrv },
            { items: payload.userMetrics, map: mapGarminUserMetrics },
          ];
          for (const { items, map } of simple) {
            for (const item of items ?? []) {
              const clientId = await resolveClientId(
                supabaseAdmin,
                item.userId,
                item.userAccessToken,
                true,
              );
              if (!clientId) continue;
              const mapped = map(item);
              if (mapped) await upsertRows(supabaseAdmin, clientId, [mapped.row]);
            }
          }

          // Activities: accumulate distance per (client, date). Also opportunistically
          // capture the Garmin device name (for brand attribution UI).
          const acts = [...(payload.activities ?? []), ...(payload.activityDetails ?? [])];
          const byClientDate = new Map<string, number>();
          const dateMeta = new Map<string, { clientId: string; date: string }>();
          const deviceByClient = new Map<string, string>();
          for (const item of acts) {
            const clientId = await resolveClientId(
              supabaseAdmin,
              item.userId,
              item.userAccessToken,
              true,
            );
            if (!clientId) continue;
            const deviceName = (item.deviceName as string | undefined)?.trim();
            if (deviceName && !deviceByClient.has(clientId))
              deviceByClient.set(clientId, deviceName);
            const a = mapGarminActivity(item);
            if (!a) continue;
            const key = `${clientId}|${a.date}`;
            byClientDate.set(key, (byClientDate.get(key) ?? 0) + a.distanceKm);
            dateMeta.set(key, { clientId, date: a.date });
          }
          for (const [key, km] of byClientDate) {
            const meta = dateMeta.get(key)!;
            if (km > 0) {
              await upsertRows(supabaseAdmin, meta.clientId, [
                {
                  source: "garmin",
                  date: meta.date,
                  total_distance_km: Math.round(km * 100) / 100,
                },
              ]);
            }
          }
          for (const [clientId, deviceName] of deviceByClient) {
            await supabaseAdmin
              .from("wearable_tokens")
              .update({ garmin_device_model: deviceName })
              .eq("client_id", clientId)
              .eq("provider", "garmin");
          }

          // Deregistration: remove the token (no self-heal).
          for (const item of payload.deregistrations ?? []) {
            const clientId = await resolveClientId(
              supabaseAdmin,
              item.userId,
              item.userAccessToken,
              false,
            );
            if (clientId) {
              await supabaseAdmin
                .from("wearable_tokens")
                .delete()
                .eq("client_id", clientId)
                .eq("provider", "garmin");
            }
          }
          // userPermissionsChange: acknowledged, no mutation.

          return ok200();
        } catch (e) {
          // Must always return 200 (a non-200 can deregister us).
          log.warn("Garmin webhook error", e);
          return ok200();
        }
      },
    },
  },
});
