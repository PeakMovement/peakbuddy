import { describe, expect, it } from "vitest";
import { progressLine, weekKey } from "./progress-note.server";

const now = new Date("2026-10-28T16:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe("weekly progress note", () => {
  it("celebrates a real drop", () => {
    const line = progressLine(
      [
        { pain: 6, at: ago(14) },
        { pain: 6, at: ago(12) },
        { pain: 4, at: ago(6) },
        { pain: 3, at: ago(2) },
      ],
      2,
      now,
    );
    expect(line).toBe(
      "Quick look back: your pain has gone from about 6 to 2 over the last two weeks. That's real progress. Keep going.",
    );
  });
  it("notes low and steady", () => {
    expect(
      progressLine(
        [
          { pain: 2, at: ago(9) },
          { pain: 2, at: ago(5) },
          { pain: 3, at: ago(1) },
        ],
        2,
        now,
      ),
    ).toContain("stayed low, around 2, for the last week");
  });
  it("says nothing when pain is rising or stuck high", () => {
    const rising = [
      { pain: 3, at: ago(10) },
      { pain: 4, at: ago(5) },
      { pain: 5, at: ago(1) },
    ];
    expect(progressLine(rising, 6, now)).toBeNull();
    const stuck = [
      { pain: 5, at: ago(10) },
      { pain: 5, at: ago(5) },
      { pain: 5, at: ago(1) },
    ];
    expect(progressLine(stuck, 5, now)).toBeNull();
  });
  it("needs a week of history", () => {
    expect(
      progressLine(
        [
          { pain: 7, at: ago(4) },
          { pain: 5, at: ago(2) },
          { pain: 4, at: ago(1) },
        ],
        2,
        now,
      ),
    ).toBeNull();
  });
  it("weeks start on Monday in South Africa", () => {
    expect(weekKey(new Date("2026-10-28T16:00:00Z"))).toBe("2026-10-26");
    expect(weekKey(new Date("2026-11-01T21:30:00Z"))).toBe("2026-10-26");
    expect(weekKey(new Date("2026-11-01T22:30:00Z"))).toBe("2026-11-02");
  });
});
