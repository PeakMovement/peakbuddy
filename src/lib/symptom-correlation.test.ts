import { describe, it, expect } from "vitest";
import { pearson, buildCorrelation } from "./symptom-correlation";
import type { WearableDay, CheckInDay } from "./load-metrics";

const iso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

describe("pearson", () => {
  it("perfect positive / negative / no-variance", () => {
    expect(pearson([1,2,3,4],[2,4,6,8])).toBe(1);
    expect(pearson([1,2,3,4],[8,6,4,2])).toBe(-1);
    expect(pearson([5,5,5,5],[1,2,3,4])).toBe(null);
  });
});

describe("buildCorrelation", () => {
  it("returns unavailable without a wearable", () => {
    expect(buildCorrelation([], [], false).available).toBe(false);
  });
  it("finds load predicting pain with a 2-day lag", () => {
    const vals = [2,5,3,8,4,7,1,9,6,2,5,8,3,7];
    const sessions: WearableDay[] = vals.map((v, a) => ({ date: iso(a), training_load: v }));
    const checkIns: CheckInDay[] = [];
    for (let a = 2; a < vals.length; a++) checkIns.push({ created_at: iso(a - 2), pain_level: Math.min(10, vals[a]) });
    const r = buildCorrelation(sessions, checkIns, true);
    expect(r.available).toBe(true);
    const load = r.predictors.find((p) => p.key === "load");
    expect(load).toBeTruthy();
    expect(load!.bestLag).toBe(2);
    expect(load!.r).toBeGreaterThanOrEqual(0.9);
    expect(load!.direction).toBe("worse");
  });
  it("does not fabricate a predictor from a constant metric", () => {
    const sessions: WearableDay[] = Array.from({ length: 14 }, (_, a) => ({ date: iso(a), training_load: 100, hrv_avg: 50 }));
    const checkIns: CheckInDay[] = Array.from({ length: 10 }, (_, a) => ({ created_at: iso(a), pain_level: (a % 5) + 2 }));
    const r = buildCorrelation(sessions, checkIns, true);
    expect(r.predictors.find((p) => p.key === "load")).toBeUndefined();
  });
});
