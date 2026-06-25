import { describe, it, expect } from "vitest";
import { computeStreak } from "./streak";

const NOW = new Date("2026-06-23T08:00:00");
const day = (n: number) => new Date(2026, 5, 23 - n).toISOString();

describe("computeStreak", () => {
  it("counts a daily streak ending today", () => {
    const r = computeStreak([day(0), day(1), day(2), day(3), day(4)], "daily", NOW);
    expect(r.current).toBe(5);
    expect(r.longest).toBe(5);
  });

  it("breaks the current streak on a gap larger than one interval of grace", () => {
    const r = computeStreak([day(0), day(4), day(5), day(6)], "daily", NOW);
    expect(r.current).toBe(1);
    expect(r.longest).toBe(3);
  });

  it("treats a stale latest check-in as a dead current streak", () => {
    const r = computeStreak([day(5), day(6), day(7)], "daily", NOW);
    expect(r.current).toBe(0);
    expect(r.longest).toBe(3);
  });

  it("is frequency-aware for weekly clients", () => {
    const r = computeStreak([day(0), day(7), day(14)], "weekly", NOW);
    expect(r.current).toBe(3);
  });

  it("gives as_needed clients a total but no streak", () => {
    const r = computeStreak([day(0), day(2), day(9)], "as_needed", NOW);
    expect(r.current).toBe(0);
    expect(r.total).toBe(3);
    expect(r.isAsNeeded).toBe(true);
  });

  it("unlocks milestones from the longest streak", () => {
    const r = computeStreak(
      Array.from({ length: 7 }, (_, i) => day(i)),
      "daily",
      NOW,
    );
    expect(r.unlockedMilestones).toEqual([3, 7]);
  });

  it("returns zeros for no check-ins", () => {
    const r = computeStreak([], "daily", NOW);
    expect(r.current).toBe(0);
    expect(r.longest).toBe(0);
  });
});
