import { describe, expect, it } from "vitest";
import { afterPain, greeting, opener, painQuestion, PAIN_FULL, PAIN_SHORT, saved } from "./voice";

// 18:00 SAST on 9 Oct 2026.
const evening = new Date("2026-10-09T16:00:00Z");
const base = { firstName: "Sam", now: evening };

describe("Buddy's voice", () => {
  it("greets by time of day, South African time", () => {
    expect(greeting({ ...base, now: new Date("2026-10-09T05:30:00Z") })).toBe("Morning Sam");
    expect(greeting(base)).toBe("Evening Sam");
  });
  it("first check-in is explained, later ones vary by day", () => {
    expect(opener({ ...base, checkinsDone: 0 })).toContain("first check-in");
    const a = opener({ ...base, checkinsDone: 5 });
    const b = opener({ ...base, checkinsDone: 5, now: new Date(evening.getTime() + 86_400_000) });
    expect(a).toMatch(/^Evening Sam/);
    expect(a).not.toBe(b);
  });
  it("drops the pain explanation once they know it", () => {
    expect(painQuestion({ ...base, checkinsDone: 1 })).toBe(PAIN_FULL);
    expect(painQuestion({ ...base, checkinsDone: 3 })).toBe(PAIN_SHORT);
  });
  it("acknowledges pain with facts only", () => {
    expect(afterPain({ ...base, lastPain: 6 }, 4)).toMatch(
      /^Thanks, 4 today, down from 6 last time\./,
    );
    expect(afterPain({ ...base, lastPain: 4 }, 4)).toMatch(/^Thanks, 4 again today\./);
    expect(afterPain({ ...base, lastPain: 2 }, 5)).toMatch(
      /^Thanks for letting me know, 5 today\./,
    );
    expect(afterPain(base, 5)).toMatch(/^Thanks\.\n\nHow did you sleep/);
    expect(afterPain({ ...base, lastPain: 6 }, 4)).not.toMatch(/heal|better|good sign|improv/i);
  });
  it("names the practitioner and celebrates streaks", () => {
    expect(saved({ ...base, practitionerFirstName: "Zoe", streak: 1 })).toBe(
      "Thanks Sam, that's saved and Zoe can see it.",
    );
    expect(saved({ ...base, streak: 4 })).toContain("4 days in a row");
    expect(saved({ ...base, streak: 7 })).toContain("full week");
  });
});
