import { describe, expect, it } from "vitest";
import { consecutiveMissedCheckins, missedLatestScheduledDay, sastDayKey } from "./missed-checkins";

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

describe("missed latest scheduled day", () => {
  // Friday 9 Oct 2026, 12:00 SAST.
  const friday = new Date("2026-10-09T10:00:00Z");
  it("is not quiet on Friday when Monday's check-in happened", () => {
    expect(missedLatestScheduledDay([1], ["2026-10-05"], friday, "2026-09-01")).toBe(false);
  });

  it("is quiet on Tuesday when this Monday was missed", () => {
    const tuesday = new Date("2026-10-06T10:00:00Z");
    expect(missedLatestScheduledDay([1], ["2026-09-28"], tuesday, "2026-09-01")).toBe(true);
  });

  it("ignores a scheduled day from before they joined", () => {
    expect(missedLatestScheduledDay([1], [], friday, "2026-10-07")).toBe(false);
  });

  it("leaves a full week to the caller's own rule", () => {
    expect(missedLatestScheduledDay([0, 1, 2, 3, 4, 5, 6], [], friday)).toBe(false);
  });
});
