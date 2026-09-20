import { createFileRoute } from "@tanstack/react-router";
import { log } from "@/lib/log";
import {
  garminWebhookSignatureFrom,
  mapGarminActivity,
  mapGarminDaily,
  mapGarminHrv,
  mapGarminSleep,
  mapGarminUserMetrics,
  verifyGarminWebhookSignature,
  type GarminDailyRow,
} from "@/lib/wearables/garmin";

type AdminClient = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type Item = Record<string, unknown> & { userId?: string; userAccessToken?: string };

function ok200() {
  return new Response("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
}

function unauthorized(msg: string) {
  return new Response(JSON.stringify({ error: msg }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Resolve the client from Garmin userId, then from the push access token.
 * Never guess from "the only unbound Garmin user" — that mis-binds PHI.
 * Self-heal provider_user_id only after a token match.
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
      // Garmin validates the endpoint with a GET (no signature).
      GET: async () => ok200(),
      POST: async ({ request }) => {
        const secret = process.env.GARMIN_CONSUMER_SECRET;
        if (!secret) return unauthorized("Webhook not configured");

        const rawBody = await request.text();
        const signature = garminWebhookSignatureFrom(request.headers);
        if (!signature) return unauthorized("Signature required");
        const signed = await verifyGarminWebhookSignature({ secret, rawBody, signature });
        if (!signed) return unauthorized("Invalid signature");

        try {
          const payload = JSON.parse(rawBody) as Record<string, Item[] | undefined>;
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

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
              const { data: existing } = await supabaseAdmin
                .from("wearable_sessions")
                .select("total_distance_km")
                .eq("client_id", meta.clientId)
                .eq("source", "garmin")
                .eq("date", meta.date)
                .maybeSingle();
              const prior =
                typeof existing?.total_distance_km === "number" ? existing.total_distance_km : 0;
              const best = Math.max(prior, Math.round(km * 100) / 100);
              await upsertRows(supabaseAdmin, meta.clientId, [
                { source: "garmin", date: meta.date, total_distance_km: best },
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

          return ok200();
        } catch (e) {
          // Signed request, processing failed — 200 so Garmin does not deregister.
          log.warn("Garmin webhook error", e);
          return ok200();
        }
      },
    },
  },
});
