import { describe, expect, it } from "vitest";
import { checkInStreak, renderPatientContext, type PatientContext } from "./patient-context.server";
import { validMemory } from "./converse";

const now = new Date("2026-10-09T10:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

const base: PatientContext = {
  firstName: "Sam",
  practitionerName: "Tristan Titus",
  practitionerProfession: "physiotherapist",
  seenFor: "knee pain",
  inCareSince: ago(43),
  programmeName: "Knee strength",
  programmeStatus: "in_progress",
  reminderTime: "18:00:00",
  checkIns: [
    { at: ago(0.1), pain: 3, sleep: 4, energy: 3, note: "stairs were easier", source: "whatsapp" },
    { at: ago(1), pain: 3, sleep: 4, energy: 4, note: null, source: "whatsapp" },
    { at: ago(2), pain: 4, sleep: 3, energy: 3, note: null, source: "whatsapp" },
    { at: ago(9), pain: 6, sleep: 2, energy: 2, note: null, source: "whatsapp" },
    { at: ago(10), pain: 6, sleep: 2, energy: 2, note: null, source: "whatsapp" },
  ],
  wearableDevice: "Forerunner 265",
  wearable: [
    { date: ago(1).slice(0, 10), steps: 9000, sleepSeconds: 7 * 3600, restingHr: 52, sessionType: "running", distanceKm: 5.2, durationMinutes: 31 },
    { date: ago(2).slice(0, 10), steps: 7000, sleepSeconds: 7.4 * 3600, restingHr: 54, sessionType: "daily", distanceKm: null, durationMinutes: null },
  ],
  memories: ["Training for the Two Oceans half marathon"],
};

describe("patient context card", () => {
  const text = renderPatientContext(base, now);
  it("names the practitioner, time on Buddy and the trend", () => {
    expect(text).toContain("Treated by: Tristan Titus (physiotherapist)");
    expect(text).toContain("On Buddy for 6 weeks");
    expect(text).toContain("3 days in a row");
    expect(text).toContain("Average pain 3.3/10 this week, 6/10 the week before (lower)");
  });
  it("includes their words, programme, reminder, watch and memories", () => {
    expect(text).toContain('"stairs were easier"');
    expect(text).toContain("Knee strength (in progress)");
    expect(text).toContain("18:00");
    expect(text).toContain("Forerunner 265");
    expect(text).toContain("running 5.2 km 31 min");
    expect(text).toContain("Two Oceans");
  });
  it("copes with a brand new patient", () => {
    const t = renderPatientContext(
      { ...base, checkIns: [], wearable: [], wearableDevice: null, memories: [], inCareSince: ago(1) },
      now,
    );
    expect(t).toContain("No check-ins yet");
    expect(t).toContain("Joined Buddy this week");
  });
  it("counts a streak from yesterday when today is not done", () => {
    expect(checkInStreak(base.checkIns.slice(1), now)).toBe(2);
  });
});

describe("what Buddy may remember", () => {
  it("keeps everyday life facts", () => {
    expect(validMemory("Training for the Two Oceans half marathon in April")).toBe(
      "Training for the Two Oceans half marathon in April",
    );
    expect(validMemory("Works night shifts on weekends.")).toBe("Works night shifts on weekends");
  });
  it.each([
    "Has diabetes",
    "Takes 50mg of something daily",
    "Knee pain gets worse on stairs",
    "Phone is 082 123 4567",
    "Email sam@example.com",
    "Goes to church on Sundays",
    "Is pregnant",
    "",
    null,
  ])("refuses %s", (f) => {
    expect(validMemory(f)).toBeNull();
  });
});
