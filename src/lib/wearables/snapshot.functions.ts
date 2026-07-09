import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { WearableMetricRow, WearableProvider } from "./metric-registry";

export type WearableSnapshot = {
  connected: boolean;
  provider: WearableProvider | null;
  date: string | null;
  session: WearableMetricRow | null;
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
    if (!client) return { connected: false, provider: null, date: null, session: null };

    const [{ data: latest }, { data: tokens }] = await Promise.all([
      db
        .from("wearable_sessions")
        .select(METRIC_FIELDS)
        .eq("client_id", client.id)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db.from("wearable_tokens").select("provider").eq("client_id", client.id),
    ]);

    const tokenProviders = ((tokens ?? []) as { provider: string }[]).map((t) => t.provider);
    const provider =
      ((latest?.source as WearableProvider | undefined) ??
        (tokenProviders[0] as WearableProvider | undefined)) ??
      null;
    const connected = provider != null || tokenProviders.length > 0;

    return {
      connected,
      provider,
      date: (latest?.date as string | undefined) ?? null,
      session: latest ? (latest as unknown as WearableMetricRow) : null,
    };
  });
