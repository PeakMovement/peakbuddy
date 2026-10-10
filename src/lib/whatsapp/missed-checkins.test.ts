import { describe, expect, it } from "vitest";
import { consecutiveMissedCheckins, sastDayKey } from "./missed-checkins";

const now = new Date("2026-10-05T07:30:00Z");

describe("consecutive missed check-ins", () => {
  it("counts scheduled days back from yesterday in South African time", () => {
    expect(sastDayKey(now)).toBe("2026-10-05");
    expect(consecutiveMissedCheckins([0, 1, 2, 3, 4, 5, 6], [], now)).toBeGreaterThanOrEqual(3);
  });

  it("stops the streak on a check-in", () => {
    expect(consecutiveMissedCheckins([0, 1, 2, 3, 4, 5, 6], ["2026-10-04"], now)).toBe(0);
    expect(consecutiveMissedCheckins([0, 1, 2, 3, 4, 5, 6], ["2026-10-02"], now)).toBe(2);
  });

  it("skips days that are not on the schedule", () => {
    // 5 Oct 2026 is a Monday. Yesterday Sunday is not a weekday.
    expect(consecutiveMissedCheckins([1, 2, 3, 4, 5], [], now, 3)).toBe(1);
  });

  it("returns zero when nothing is scheduled", () => {
    expect(consecutiveMissedCheckins([], [], now)).toBe(0);
  });
});
