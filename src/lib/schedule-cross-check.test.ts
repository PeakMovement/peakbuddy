import { describe, it, expect } from "vitest";
import {
  buildScheduleCrossCheck,
  intensityFor,
  SESSION_TYPE_INTENSITY,
  type CheckInInput,
  type TrainingSessionInput,
} from "./schedule-cross-check";

const NOW = new Date("2026-09-20T10:00:00");
const day = (n: number) => {
  const d = new Date(2026, 8, 20 - n); // local Sep
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

describe("intensityFor", () => {
  it("uses explicit intensity over the type default", () => {
    expect(intensityFor({ session_date: day(0), session_type: "hard", intensity: 3 })).toBe(3);
  });
  it("falls back to type defaults", () => {
    expect(intensityFor({ session_date: day(0), session_type: "rest" })).toBe(
      SESSION_TYPE_INTENSITY.rest,
    );
    expect(intensityFor({ session_date: day(0), session_type: "hard" })).toBe(
      SESSION_TYPE_INTENSITY.hard,
    );
  });
});

describe("buildScheduleCrossCheck", () => {
  it("aligns a 21-day window ending today", () => {
    const r = buildScheduleCrossCheck([], [], [], 21, NOW);
    expect(r.days).toHaveLength(21);
    expect(r.days[r.days.length - 1].date).toBe(day(0));
    expect(r.days[0].date).toBe(day(20));
  });

  it("observes a hard session followed by a pain rise", () => {
    const sessions: TrainingSessionInput[] = [
      { session_date: day(3), session_type: "hard", title: "Intervals" },
    ];
    const checkIns: CheckInInput[] = [
      { created_at: `${day(3)}T08:00:00`, pain_level: 3, flagged: false },
      { created_at: `${day(2)}T08:00:00`, pain_level: 7, flagged: false },
    ];
    const r = buildScheduleCrossCheck(sessions, checkIns, [], 21, NOW);
    expect(r.summary.hardThenSpikeCount).toBe(1);
    expect(r.observations.some((o) => o.includes("hard session") && o.includes("rise"))).toBe(true);
  });

  it("compares average pain on hard vs recovery days", () => {
    const sessions: TrainingSessionInput[] = [
      { session_date: day(6), session_type: "hard" },
      { session_date: day(4), session_type: "hard" },
      { session_date: day(5), session_type: "recovery" },
      { session_date: day(3), session_type: "recovery" },
    ];
    const checkIns: CheckInInput[] = [
      { created_at: `${day(6)}T08:00:00`, pain_level: 7 },
      { created_at: `${day(4)}T08:00:00`, pain_level: 8 },
      { created_at: `${day(5)}T08:00:00`, pain_level: 3 },
      { created_at: `${day(3)}T08:00:00`, pain_level: 2 },
    ];
    const r = buildScheduleCrossCheck(sessions, checkIns, [], 21, NOW);
    expect(r.summary.avgPainOnHard).toBe(7.5);
    expect(r.summary.avgPainOnRecovery).toBe(2.5);
    expect(r.observations.some((o) => o.includes("higher than on recovery"))).toBe(true);
  });

  it("does not invent a spike without overlapping check-ins", () => {
    const sessions: TrainingSessionInput[] = [{ session_date: day(1), session_type: "hard" }];
    const r = buildScheduleCrossCheck(sessions, [], [], 21, NOW);
    expect(r.summary.hardThenSpikeCount).toBe(0);
    expect(r.summary.overlapDays).toBe(0);
  });

  it("notes a wearable-load spike followed by a flagged check-in", () => {
    const wearable = [
      { date: day(3), load: 400 },
      { date: day(4), load: 100 },
      { date: day(5), load: 100 },
    ];
    const checkIns: CheckInInput[] = [
      { created_at: `${day(2)}T08:00:00`, pain_level: 8, flagged: true },
    ];
    const r = buildScheduleCrossCheck([], checkIns, wearable, 21, NOW);
    expect(r.observations.some((o) => o.includes("wearable-load spike"))).toBe(true);
  });
});
