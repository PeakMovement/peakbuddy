import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { WearableMetricRow, WearableProvider } from "./metric-registry";

export type WearableSnapshot = {
  connected: boolean;
  provider: WearableProvider | null;
  date: string | null;
  session: WearableMetricRow | null;
  /** Garmin device model captured from activity webhooks (nullable). */
  deviceModel: string | null;
};

const METRIC_FIELDS =
  "date, source, active_calories, total_calories, avg_heart_rate, max_heart_rate, resting_hr, hrv_avg, spo2_avg, sleep_score, readiness_score, activity_score, total_steps, training_load, total_distance_km, stress_avg, body_battery_max, vo2_max";

/**
 * The calling client's wearable snapshot: whether a wearable is connected, which
 * provider, and their latest normalized session metrics. Reads the service-role
 * wearable_tokens (clients can't) so "connected but not yet synced" is detected.
 */
export const getMyWearableSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WearableSnapshot> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as { from: (t: string) => any };

    const { data: client } = await db
      .from("clients")
      .select("id")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!client)
      return { connected: false, provider: null, date: null, session: null, deviceModel: null };

    const [{ data: recent }, { data: tokens }] = await Promise.all([
      db
        .from("wearable_sessions")
        .select(METRIC_FIELDS)
        .eq("client_id", client.id)
        .order("date", { ascending: false })
        .limit(14),
      db
        .from("wearable_tokens")
        .select("provider, garmin_device_model")
        .eq("client_id", client.id),
    ]);

    const rows = (recent ?? []) as any[];
    const tokenRows = (tokens ?? []) as {
      provider: string;
      garmin_device_model: string | null;
    }[];
    const tokenProviders = tokenRows.map((t) => t.provider);
    const provider =
      ((rows[0]?.source as WearableProvider | undefined) ??
        (tokenProviders[0] as WearableProvider | undefined)) ??
      null;
    const connected = provider != null || tokenProviders.length > 0;
    const deviceModel =
      provider === "garmin"
        ? (tokenRows.find((t) => t.provider === "garmin")?.garmin_device_model ?? null)
        : null;

    // Oura/Garmin compute sleep, readiness & HRV only AFTER the night, so the
    // newest date row ("today") is often near-empty. Show the most recent row
    // that actually carries data, so tiles reflect the last complete day.
    const CORE = [
      "sleep_score", "readiness_score", "resting_hr", "hrv_avg", "avg_heart_rate", "spo2_avg", "training_load",
    ];
    const forProvider = provider ? rows.filter((r) => r.source === provider) : rows;
    const hasData = (r: any) =>
      CORE.some((k) => typeof r[k] === "number" && Number.isFinite(r[k])) ||
      (typeof r.total_steps === "number" && r.total_steps > 0) ||
      (typeof r.active_calories === "number" && r.active_calories > 0);
    const chosen = forProvider.find(hasData) ?? forProvider[0] ?? rows[0] ?? null;

    return {
      connected,
      provider,
      date: (chosen?.date as string | undefined) ?? null,
      session: chosen ? (chosen as unknown as WearableMetricRow) : null,
      deviceModel,
    };
  });
