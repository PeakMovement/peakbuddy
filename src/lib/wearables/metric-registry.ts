// Wearable metric capability registry — the SINGLE SOURCE OF TRUTH for which
// metrics each provider supplies and how each maps to a stored wearable_sessions
// field. Adding a new wearable = add a PROVIDER_METRICS entry (and any new metric
// defs), NOT rewriting the Progress page. Pure + dependency-free (unit-testable).

export type WearableProvider = "oura" | "garmin" | "polar";

/** The subset of wearable_sessions numeric fields the tiles can read. */
export type WearableMetricRow = {
  active_calories: number | null;
  total_calories: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  resting_hr: number | null;
  hrv_avg: number | null;
  spo2_avg: number | null;
  sleep_score: number | null;
  readiness_score: number | null;
  activity_score: number | null;
  total_steps: number | null;
  training_load: number | null;
  total_distance_km: number | null;
  stress_avg: number | null;
  body_battery_max: number | null;
  body_battery_charged: number | null;
  body_battery_drained: number | null;
  vo2_max: number | null;
};

export type MetricKey =
  | "active_calories"
  | "total_calories"
  | "avg_heart_rate"
  | "max_heart_rate"
  | "resting_hr"
  | "hrv"
  | "spo2"
  | "sleep_score"
  | "readiness"
  | "activity"
  | "steps"
  | "training_load"
  | "distance"
  | "stress"
  | "body_battery"
  | "body_battery_drained"
  | "vo2_max";

export type MetricDef = {
  key: MetricKey;
  /** Field on wearable_sessions this metric reads. */
  field: keyof WearableMetricRow;
  label: string;
  unit: string; // "" when the value is a unit-less score
  /** Icon hint for the UI layer (kept as a string so this module stays pure). */
  icon: string;
  format: (v: number) => string;
};

const intFmt = (v: number) => Math.round(v).toLocaleString();
const oneDp = (v: number) => (Math.round(v * 10) / 10).toString();
const scoreFmt = (v: number) => `${Math.round(v)}`;

// Catalog of every metric a tile can render. Unit-safe scalars only (sleep is
// represented by its 0-100 score to avoid cross-provider duration-unit drift).
export const METRICS: Record<MetricKey, MetricDef> = {
  active_calories: {
    key: "active_calories",
    field: "active_calories",
    label: "Active Calories",
    unit: "kcal",
    icon: "flame",
    format: intFmt,
  },
  total_calories: {
    key: "total_calories",
    field: "total_calories",
    label: "Total Calories",
    unit: "kcal",
    icon: "flame",
    format: intFmt,
  },
  avg_heart_rate: {
    key: "avg_heart_rate",
    field: "avg_heart_rate",
    label: "Avg Heart Rate",
    unit: "bpm",
    icon: "heart",
    format: intFmt,
  },
  max_heart_rate: {
    key: "max_heart_rate",
    field: "max_heart_rate",
    label: "Max Heart Rate",
    unit: "bpm",
    icon: "heart-pulse",
    format: intFmt,
  },
  resting_hr: {
    key: "resting_hr",
    field: "resting_hr",
    label: "Resting HR",
    unit: "bpm",
    icon: "heart",
    format: intFmt,
  },
  hrv: { key: "hrv", field: "hrv_avg", label: "HRV", unit: "ms", icon: "activity", format: intFmt },
  spo2: {
    key: "spo2",
    field: "spo2_avg",
    label: "SpO₂",
    unit: "%",
    icon: "droplet",
    format: oneDp,
  },
  sleep_score: {
    key: "sleep_score",
    field: "sleep_score",
    label: "Sleep Score",
    unit: "",
    icon: "moon",
    format: scoreFmt,
  },
  readiness: {
    key: "readiness",
    field: "readiness_score",
    label: "Readiness",
    unit: "",
    icon: "battery-charging",
    format: scoreFmt,
  },
  activity: {
    key: "activity",
    field: "activity_score",
    label: "Activity",
    unit: "",
    icon: "footprints",
    format: scoreFmt,
  },
  steps: {
    key: "steps",
    field: "total_steps",
    label: "Steps",
    unit: "",
    icon: "footprints",
    format: intFmt,
  },
  training_load: {
    key: "training_load",
    field: "training_load",
    label: "Training Load",
    unit: "",
    icon: "dumbbell",
    format: intFmt,
  },
  distance: {
    key: "distance",
    field: "total_distance_km",
    label: "Distance",
    unit: "km",
    icon: "map",
    format: oneDp,
  },
  stress: {
    key: "stress",
    field: "stress_avg",
    label: "Stress",
    unit: "",
    icon: "gauge",
    format: scoreFmt,
  },
  // Garmin's daily summary reports Body Battery as amount charged / drained over
  // the day (not a level), so label these for what they actually are.
  body_battery: {
    key: "body_battery",
    field: "body_battery_charged",
    label: "Body Battery Charged",
    unit: "",
    icon: "battery-charging",
    format: scoreFmt,
  },
  body_battery_drained: {
    key: "body_battery_drained",
    field: "body_battery_drained",
    label: "Body Battery Used",
    unit: "",
    icon: "battery-charging",
    format: scoreFmt,
  },
  vo2_max: {
    key: "vo2_max",
    field: "vo2_max",
    label: "VO₂ Max",
    unit: "",
    icon: "activity",
    format: oneDp,
  },
};

// Which metrics each provider actually POPULATES via the fields Buddy pulls
// today (grounded in the real mapping code in oura.ts / garmin.ts / polar.ts).
// Order = display order.
export const PROVIDER_METRICS: Record<WearableProvider, MetricKey[]> = {
  // oura.ts populates: readiness, sleep, activity, steps, active+total cals,
  // resting_hr, avg_heart_rate (now persisted), hrv, spo2.
  oura: [
    "active_calories",
    "avg_heart_rate",
    "resting_hr",
    "hrv",
    "sleep_score",
    "readiness",
    "steps",
    "spo2",
  ],
  // garmin.ts populates: steps, distance, total+active cals, resting/avg/max HR,
  // sleep, hrv, stress + Body Battery (daily summary) and VO2 max (userMetrics).
  garmin: [
    "steps",
    "distance",
    "active_calories",
    "total_calories",
    "resting_hr",
    "avg_heart_rate",
    "max_heart_rate",
    "hrv",
    "sleep_score",
    "stress",
    "body_battery",
    "body_battery_drained",
    "vo2_max",
  ],
  // polar.ts populates: sleep, duration, active cals, distance, avg+max HR,
  // training load.
  polar: [
    "active_calories",
    "avg_heart_rate",
    "max_heart_rate",
    "training_load",
    "sleep_score",
    "distance",
  ],
};

/** Ordered metric defs a given provider can show. Unknown provider → []. */
export function metricsForProvider(provider: string | null | undefined): MetricDef[] {
  if (!provider || !(provider in PROVIDER_METRICS)) return [];
  return PROVIDER_METRICS[provider as WearableProvider].map((k) => METRICS[k]);
}

/** Human label for the provider. */
export const PROVIDER_LABEL: Record<WearableProvider, string> = {
  oura: "Oura Ring",
  garmin: "Garmin",
  polar: "Polar",
};

/** Read + format a metric off a session row; null when there's no value yet. */
export function readMetric(
  def: MetricDef,
  row: WearableMetricRow | null | undefined,
): string | null {
  const raw = row ? row[def.field] : null;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return def.format(raw);
}
