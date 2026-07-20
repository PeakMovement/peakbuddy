import { describe, it, expect } from "vitest";
import { buildRhythms } from "./rhythm-patterns";
import type { WearableDay } from "./load-metrics";

const iso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

describe("buildRhythms", () => {
  it("computes weekday/weekend sleep and a declining HRV trend", () => {
    // 21 days; sleep 80 weekday, 65 weekend; hrv declining recent vs older
    const sessions: WearableDay[] = Array.from({ length: 21 }, (_, a) => {
      const date = iso(a);
      const dow = new Date(date).getUTCDay();
      return { date, sleep_score: (dow === 0 || dow === 6) ? 65 : 80, hrv_avg: a < 7 ? 40 : 60 };
    });
    const r = buildRhythms(sessions);
    expect(r.sleepWeekday).toBeGreaterThan(r.sleepWeekend as number);
    expect(r.hrvTrend.direction).toBe("down");
    expect(r.notes.length).toBeGreaterThan(0);
  });
  it("returns nulls when data is too sparse", () => {
    const r = buildRhythms([{ date: iso(0), sleep_score: 80 }]);
    expect(r.sleepWeekday).toBe(null);
    expect(r.hrvTrend.direction).toBe("unknown");
  });
});
