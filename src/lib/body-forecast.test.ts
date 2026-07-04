import { describe, it, expect } from "vitest";
import { computeForecast, type WearableDay, type CheckinDay } from "./body-forecast";

const NOW = new Date("2026-07-04T09:00:00");
// n days before NOW, as YYYY-MM-DD
const d = (n: number) => {
  const dt = new Date(2026, 6, 4 - n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};
const w = (n: number, o: Partial<WearableDay>): WearableDay => ({
  date: d(n),
  sleep_score: 80,
  readiness_score: 78,
  resting_hr: 55,
  hrv_avg: 60,
  ...o,
});

describe("computeForecast", () => {
  it("returns the connect state with no wearable data", () => {
    const r = computeForecast([], [], NOW);
    expect(r.hasWearable).toBe(false);
    expect(r.message).toMatch(/Connect your Oura/i);
  });

  it("flags stale data instead of presenting it as last night", () => {
    const r = computeForecast([w(5, {})], [], NOW); // latest is 5 days old
    expect(r.level).toBe("unknown");
    expect(r.message).toMatch(/hasn't synced/i);
    expect(r.factors).toHaveLength(0);
  });

  it("reads a strong recovery day from fresh data", () => {
    const days = [w(0, { sleep_score: 95 }), ...Array.from({ length: 12 }, (_, i) => w(i + 1, {}))];
    const r = computeForecast(days, [], NOW);
    expect(r.level).toBe("strong");
    expect(r.message).toMatch(/95/); // specific number woven in
  });

  it("reads a low day when HRV falls and resting HR rises", () => {
    const days = [
      ...Array.from({ length: 3 }, (_, i) => w(i, { sleep_score: 58, readiness_score: 52, resting_hr: 66, hrv_avg: 40 })),
      ...Array.from({ length: 11 }, (_, i) => w(i + 3, { resting_hr: 55, hrv_avg: 62 })),
    ];
    const r = computeForecast(days, [], NOW);
    expect(r.level).toBe("low");
    expect(r.message).toMatch(/flare/i);
  });

  it("weaves elevated recent pain into the message", () => {
    const days = [w(0, { sleep_score: 95 }), ...Array.from({ length: 12 }, (_, i) => w(i + 1, {}))];
    const checkins: CheckinDay[] = Array.from({ length: 5 }, (_, i) => ({ date: d(i), pain_level: 7 }));
    const r = computeForecast(days, checkins, NOW);
    expect(r.level).toBe("strong");
    expect(r.message).toMatch(/pain/i); // recovery good but symptoms acknowledged
  });

  it("detects a personal sleep->pain pattern with enough paired days", () => {
    const days = Array.from({ length: 12 }, (_, i) => w(i, { sleep_score: i % 2 === 0 ? 60 : 85 }));
    const checkins: CheckinDay[] = days.map((day) => ({ date: day.date, pain_level: (day.sleep_score ?? 0) < 70 ? 7 : 3 }));
    const r = computeForecast(days, checkins, NOW);
    expect(r.personalNote).toBeTruthy();
    expect(r.confidence).toBe("Your pattern");
  });
});
