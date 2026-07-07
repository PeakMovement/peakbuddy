import { describe, it, expect } from "vitest";
import { detectWeekdayPatterns, describePattern, type CheckInInput } from "./client-patterns";

// Build a check-in on a specific weekday. 2024-01-01 is a Monday (UTC).
// Offsets: Sun=-1? we pick concrete known dates instead.
const DATES: Record<number, string[]> = {
  // A batch of ISO dates grouped by UTC weekday.
  1: ["2024-01-01", "2024-01-08", "2024-01-15", "2024-01-22", "2024-01-29"], // Mondays
  2: ["2024-01-02", "2024-01-09", "2024-01-16"], // Tuesdays
  3: ["2024-01-03", "2024-01-10", "2024-01-17"], // Wednesdays
  4: ["2024-01-04", "2024-01-11", "2024-01-18"], // Thursdays
  5: ["2024-01-05", "2024-01-12", "2024-01-19"], // Fridays
};

function ci(date: string, pain: number): CheckInInput {
  return {
    created_at: `${date}T09:00:00.000Z`,
    pain_level: pain,
    energy_level: null,
    stress_level: null,
    sleep_quality: null,
  };
}

describe("detectWeekdayPatterns", () => {
  it("flags a weekday where pain runs clearly higher", () => {
    const rows: CheckInInput[] = [];
    // Mondays: high pain (8). Other weekdays: low pain (2).
    for (const d of DATES[1]) rows.push(ci(d, 8));
    for (const dow of [2, 3, 4, 5]) for (const d of DATES[dow]) rows.push(ci(d, 2));

    const patterns = detectWeekdayPatterns(rows);
    const monday = patterns.find((p) => p.metric === "pain" && p.day_of_week === 1);
    expect(monday).toBeTruthy();
    expect(monday!.pattern_type).toBe("weekday_elevated");
    expect(monday!.avg_value).toBeCloseTo(8, 1);
    expect(monday!.confidence).toBeGreaterThan(0.4);
  });

  it("returns nothing when there is no meaningful variation", () => {
    const rows: CheckInInput[] = [];
    for (const dow of [1, 2, 3, 4, 5]) for (const d of DATES[dow]) rows.push(ci(d, 4));
    expect(detectWeekdayPatterns(rows)).toEqual([]);
  });

  it("stays quiet below the minimum sample size", () => {
    const rows: CheckInInput[] = [ci(DATES[1][0], 9), ci(DATES[2][0], 1)];
    expect(detectWeekdayPatterns(rows)).toEqual([]);
  });

  it("is deterministic", () => {
    const rows: CheckInInput[] = [];
    for (const d of DATES[1]) rows.push(ci(d, 8));
    for (const dow of [2, 3, 4, 5]) for (const d of DATES[dow]) rows.push(ci(d, 2));
    expect(detectWeekdayPatterns(rows)).toEqual(detectWeekdayPatterns(rows));
  });

  it("describePattern produces non-empty, non-alarming copy", () => {
    const rows: CheckInInput[] = [];
    for (const d of DATES[1]) rows.push(ci(d, 8));
    for (const dow of [2, 3, 4, 5]) for (const d of DATES[dow]) rows.push(ci(d, 2));
    const [p] = detectWeekdayPatterns(rows);
    const text = describePattern(p);
    expect(text.length).toBeGreaterThan(10);
    expect(text.toLowerCase()).toContain("monday");
  });
});
