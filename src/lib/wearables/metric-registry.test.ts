import { describe, it, expect } from "vitest";
import {
  metricsForProvider,
  readMetric,
  METRICS,
  PROVIDER_METRICS,
  type WearableMetricRow,
} from "./metric-registry";

describe("wearable metric registry", () => {
  it("returns only metrics a provider actually populates", () => {
    const oura = metricsForProvider("oura").map((m) => m.key);
    expect(oura).toContain("active_calories");
    expect(oura).toContain("avg_heart_rate");
    expect(oura).not.toContain("training_load"); // Oura doesn't populate this
    const polar = metricsForProvider("polar").map((m) => m.key);
    expect(polar).toContain("training_load");
    expect(polar).toContain("avg_heart_rate");
    expect(polar).not.toContain("hrv"); // polar.ts doesn't map hrv
    const garmin = metricsForProvider("garmin").map((m) => m.key);
    expect(garmin).toContain("resting_hr");
    // garmin.ts now also persists avg/max HR, stress, Body Battery and VO2 max
    // straight off the daily summary + userMetrics payloads.
    expect(garmin).toContain("avg_heart_rate");
    expect(garmin).toContain("stress");
    expect(garmin).toContain("body_battery");
    expect(garmin).toContain("vo2_max");
    expect(garmin).not.toContain("readiness"); // Garmin has no readiness score
  });

  it("returns [] for unknown/absent provider", () => {
    expect(metricsForProvider(null)).toEqual([]);
    expect(metricsForProvider("fitbit")).toEqual([]);
  });

  it("every provider metric key exists in the catalog", () => {
    for (const keys of Object.values(PROVIDER_METRICS)) {
      for (const k of keys) expect(METRICS[k]).toBeTruthy();
    }
  });

  it("reads + formats a present value, null for missing", () => {
    const row = { active_calories: 512, avg_heart_rate: null } as unknown as WearableMetricRow;
    expect(readMetric(METRICS.active_calories, row)).toBe("512");
    expect(readMetric(METRICS.avg_heart_rate, row)).toBeNull(); // empty-state
    expect(readMetric(METRICS.active_calories, null)).toBeNull();
  });
});
