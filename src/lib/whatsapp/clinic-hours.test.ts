import { describe, it, expect } from "vitest";
import { isOpen, isAfterHours, toSast, nextOpening, openingTimeLabel } from "./clinic-hours";

/** A South African local time, expressed as the UTC instant it really is. */
function sast(y: number, m: number, d: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(y, m - 1, d, hh - 2, mm, 0));
}

// 2026-10-05 is a Monday, 2026-10-10 a Saturday, 2026-10-11 a Sunday.
describe("clinic hours are 08:30 to 18:00, weekdays", () => {
  it("is shut just before opening", () => {
    expect(isOpen(sast(2026, 10, 5, 8, 29))).toBe(false);
  });
  it("is open on the dot at 08:30", () => {
    expect(isOpen(sast(2026, 10, 5, 8, 30))).toBe(true);
  });
  it("is open mid afternoon", () => {
    expect(isOpen(sast(2026, 10, 5, 14, 0))).toBe(true);
  });
  it("is open at one minute to six", () => {
    expect(isOpen(sast(2026, 10, 5, 17, 59))).toBe(true);
  });
  it("is shut at six exactly", () => {
    expect(isOpen(sast(2026, 10, 5, 18, 0))).toBe(false);
  });
  it("is shut late at night", () => {
    expect(isOpen(sast(2026, 10, 5, 23, 30))).toBe(false);
  });
  it("is shut on Saturday until Justin says otherwise", () => {
    expect(isOpen(sast(2026, 10, 10, 10, 0))).toBe(false);
  });
  it("is shut on Sunday", () => {
    expect(isOpen(sast(2026, 10, 11, 10, 0))).toBe(false);
  });
  it("after hours is the exact opposite of open", () => {
    for (const t of [sast(2026, 10, 5, 9, 0), sast(2026, 10, 10, 9, 0), sast(2026, 10, 5, 22, 0)]) {
      expect(isAfterHours(t)).toBe(!isOpen(t));
    }
  });
});

describe("the SAST conversion holds at the edges", () => {
  it("reads midnight UTC as 02:00 the same day in South Africa", () => {
    const m = toSast(new Date(Date.UTC(2026, 9, 5, 0, 0)));
    expect(m.minuteOfDay).toBe(120);
    expect(m.date).toBe("2026-10-05");
  });
  it("rolls the local date forward after 22:00 UTC", () => {
    const m = toSast(new Date(Date.UTC(2026, 9, 5, 22, 30)));
    expect(m.date).toBe("2026-10-06");
    expect(m.weekday).toBe(2);
  });
  it("counts Sunday as 7, not 0", () => {
    expect(toSast(sast(2026, 10, 11, 12, 0)).weekday).toBe(7);
  });
});

describe("next opening", () => {
  it("is later today when asked before opening", () => {
    const next = nextOpening(sast(2026, 10, 5, 6, 0))!;
    expect(toSast(next).date).toBe("2026-10-05");
    expect(toSast(next).minuteOfDay).toBe(510);
  });
  it("is tomorrow when asked after closing on a weekday", () => {
    const next = nextOpening(sast(2026, 10, 5, 20, 0))!;
    expect(toSast(next).date).toBe("2026-10-06");
  });
  it("skips the weekend", () => {
    const next = nextOpening(sast(2026, 10, 10, 9, 0))!;
    expect(toSast(next).date).toBe("2026-10-12");
    expect(toSast(next).weekday).toBe(1);
  });
  it("always lands on an open moment", () => {
    for (const t of [
      sast(2026, 10, 5, 6, 0),
      sast(2026, 10, 5, 20, 0),
      sast(2026, 10, 10, 9, 0),
      sast(2026, 10, 11, 23, 0),
    ]) {
      expect(isOpen(nextOpening(t)!)).toBe(true);
    }
  });
});

describe("the label the patient sees", () => {
  it("reads 08:30", () => {
    expect(openingTimeLabel()).toBe("08:30");
  });
});
