import { describe, expect, it } from "vitest";
import {
  formatWeekSummary,
  isWeekAsk,
  shortWeekSummary,
  summariseWeek,
  weeklySummaryDue,
  type WeekPatient,
} from "./weekly-summary.server";

const now = new Date("2026-11-02T06:00:00Z"); // Monday 08:00 SAST
const at = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const pt = (
  name: string,
  series: Array<[number, number]>,
  extra: Partial<WeekPatient> = {},
): WeekPatient => ({
  id: name,
  name: `${name} Fakename`,
  joinedAt: at(40),
  checkins: series.map(([d, pain]) => ({ at: at(d), pain, sleep: 3, energy: 3 })),
  scheduledDays: null,
  ...extra,
});

describe("Monday summary", () => {
  const s = summariseWeek(
    "Zoe",
    [
      pt("Sam", [
        [14, 6],
        [10, 5],
        [6, 4],
        [2, 3],
        [1, 2],
      ]),
      pt("Lerato", [
        [15, 5],
        [10, 5],
        [5, 5],
        [1, 5],
      ]),
      pt("Pieter", [
        [8, 3],
        [6, 4],
        [3, 5],
        [1, 6],
      ]),
      pt("Nomsa", [
        [20, 4],
        [10, 3],
      ]),
      pt("Alex", [], { joinedAt: at(2) }),
    ],
    now,
  );

  it("sorts patients the way a physio thinks about them", () => {
    expect(s.improving).toEqual([{ name: "Sam", from: 6, to: 2 }]);
    expect(s.stalled).toEqual([{ name: "Lerato", around: 5, weeks: 2 }]);
    expect(s.signals.map((x) => x.name)).toEqual(["Pieter"]);
    expect(s.quiet).toEqual([{ name: "Nomsa", days: 10 }]);
    expect(s.fresh).toEqual(["Alex"]);
  });

  it("reads as one message with a booking prompt", () => {
    const text = formatWeekSummary(s);
    expect(text).toContain("Your Buddy week, Zoe (5 patients)");
    expect(text).toContain("Worth booking in (1):\n• Lerato: pain stuck around 5 for 2 weeks");
    expect(text).toContain('Reply "book Lerato in" and I\'ll ask reception.');
    expect(shortWeekSummary(s)).toBe(
      "1 worth a look, 1 worth booking in, 1 improving, 1 gone quiet",
    );
  });

  it("weekly patients aren't quiet after 5 days", () => {
    const w = summariseWeek("Zoe", [pt("Lerato", [[6, 5]], { scheduledDays: [1] })], now);
    expect(w.quiet).toEqual([]);
  });

  it("goes out Monday morning only", () => {
    expect(weeklySummaryDue(now)).toBe(true);
    expect(weeklySummaryDue(new Date("2026-11-03T06:00:00Z"))).toBe(false);
    expect(weeklySummaryDue(new Date("2026-11-02T05:30:00Z"))).toBe(false);
  });

  it("can be asked for", () => {
    expect(isWeekAsk("send me my week")).toBe(true);
    expect(isWeekAsk("weekly summary please")).toBe(true);
    expect(isWeekAsk("how is sam this week")).toBe(false);
  });
});
