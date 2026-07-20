import { describe, it, expect } from "vitest";
import {
  buildLoadInsight, pickLoadMethod, loadForDay, fatigueIndex,
  type WearableDay, type CheckInDay,
} from "./load-metrics";

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
function series(n: number, loadFor: (i: number) => number | null, extra: (i: number) => Partial<WearableDay> = () => ({})): WearableDay[] {
  return Array.from({ length: n }, (_, i) => ({ date: iso(i), training_load: loadFor(i), ...extra(i) }));
}

describe("load method + proxy", () => {
  it("prefers training_load, then HR-minutes, then calories", () => {
    expect(pickLoadMethod([{ date: iso(0), training_load: 100 }])).toBe("training_load");
    expect(pickLoadMethod([{ date: iso(0), duration_minutes: 40, avg_heart_rate: 130 }])).toBe("hr_minutes");
    expect(pickLoadMethod([{ date: iso(0), active_calories: 400 }])).toBe("active_calories");
    expect(pickLoadMethod([{ date: iso(0), sleep_score: 80 }])).toBe(null);
  });
  it("HR-minutes proxy = duration*hr/10", () => {
    expect(loadForDay({ date: iso(0), duration_minutes: 40, avg_heart_rate: 130 }, "hr_minutes")).toBe(520);
  });
});

describe("availability gating", () => {
  it("unavailable with no wearable", () => {
    const r = buildLoadInsight([], [], false);
    expect(r.available).toBe(false);
    expect(r.reason).toContain("No wearable");
  });
  it("unavailable when wearable gives no load data", () => {
    const r = buildLoadInsight(series(20, () => null, () => ({ sleep_score: 80 })), [], true);
    expect(r.available).toBe(false);
    expect(r.reason).toContain("does not provide");
  });
});

describe("sparse-data safeguards", () => {
  it("gates ACWR + monotony under 14 days of data", () => {
    const r = buildLoadInsight(series(10, (i) => 100 + (i % 3) * 30), [], true);
    expect(r.available).toBe(true);
    expect(r.maturity.dataDays).toBe(10);
    expect(r.metrics.acwr).toBe(null);
    expect(r.metrics.monotony).toBe(null);
  });
  it("does NOT fabricate monotony on constant load (stddev 0)", () => {
    const r = buildLoadInsight(series(20, () => 100), [], true);
    expect(r.metrics.monotony).toBe(null); // no fake 'high monotony'
    expect(r.drivers.all.find((d) => d.id === "monotony")).toBeUndefined();
  });
});

describe("ACWR danger detection", () => {
  it("flags an acute load spike as high risk (acwr >= 1.5)", () => {
    // last 7 days load 300, prior 21 days load 100 -> acute 300 / chronic 150 = 2.0
    const r = buildLoadInsight(series(28, (i) => (i < 7 ? 300 : 100)), [], true);
    expect(r.metrics.acwr).toBeGreaterThanOrEqual(1.5);
    expect(r.drivers.primary?.id).toBe("acwr");
    expect(r.drivers.riskLevel).toBe("high");
  });
});

describe("HRV deviation + fatigue formula", () => {
  it("detects HRV dropping below personal baseline", () => {
    // recent hrv ~40, older baseline ~60 -> ~33% drop
    const r = buildLoadInsight(series(28, () => 100, (i) => ({ hrv_avg: i < 7 ? 40 : 60 })), [], true);
    expect(r.metrics.hrvDeviationPct).toBeGreaterThanOrEqual(30);
    expect(r.drivers.all.find((d) => d.id === "hrv")).toBeTruthy();
  });
  it("fatigue index matches the ported formula", () => {
    // strain 2000 (capped) -> 50, monotony 2.5 -> 50 => 100
    expect(fatigueIndex(2000, 2.5)).toBe(100);
    expect(fatigueIndex(1000, 1.25)).toBe(50);
    expect(fatigueIndex(null, null)).toBe(null);
  });
});

describe("symptom-vs-training cross-check", () => {
  it("observes a load spike followed by a flagged check-in", () => {
    const sessions = series(28, (i) => (i === 3 ? 400 : 100)); // spike 3 days ago
    const checkIns: CheckInDay[] = [{ created_at: iso(2), pain_level: 8, flagged: true }];
    const r = buildLoadInsight(sessions, checkIns, true);
    expect(r.crossCheck.observation).toContain("load spike");
    expect(r.crossCheck.days.length).toBeGreaterThan(0);
  });
});
