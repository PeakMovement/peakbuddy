import { describe, expect, it } from "vitest";
import {
  OUTCOME_IDS,
  outcomeStep,
  outcomeSummary,
  psfsMean,
  readActivities,
  readScore,
  type OutcomeDraft,
} from "./outcomes";

const at = "2026-10-28T16:00:00Z";
const offer: OutcomeDraft = { step: "offer", timepoint: "intake", at };

describe("outcome scores", () => {
  it("reads scores from taps and typing", () => {
    expect(readScore("", "oc_n_7")).toBe(7);
    expect(readScore("10")).toBe(10);
    expect(readScore("about 6/10")).toBe(6);
    expect(readScore("my knee hurts")).toBeNull();
  });

  it("reads up to three activities", () => {
    expect(readActivities("stairs, running and lifting my son")).toEqual([
      "stairs",
      "running and lifting my son",
    ]);
    expect(readActivities("climbing stairs and running")).toEqual(["climbing stairs", "running"]);
    expect(readActivities("1. stairs\n2. squats\n3. driving\n4. golf")).toEqual([
      "stairs",
      "squats",
      "driving",
    ]);
  });

  it("intake: yes, average pain, names, then one rating each", () => {
    let s = outcomeStep(offer, "", OUTCOME_IDS.yes, [])!;
    expect(s.next?.step).toBe("nprs");
    s = outcomeStep(s.next!, "6", null, [])!;
    expect(s.next?.step).toBe("psfs_names");
    s = outcomeStep(s.next!, "stairs, running", null, [])!;
    expect(s.next).toMatchObject({ step: "psfs_rate", activities: ["stairs", "running"] });
    expect(JSON.stringify(s.replies)).toContain("stairs");
    s = outcomeStep(s.next!, "", OUTCOME_IDS.score(4), [])!;
    s = outcomeStep(s.next!, "7", null, [])!;
    expect(s.next).toBeNull();
    expect(s.result).toEqual({
      nprs: 6,
      timepoint: "intake",
      psfs: [
        { activity: "stairs", score: 4 },
        { activity: "running", score: 7 },
      ],
    });
  });

  it("follow-up reuses last time's activities", () => {
    const s = outcomeStep({ ...offer, timepoint: "followup", step: "nprs" }, "3", null, [
      "stairs",
    ])!;
    expect(s.next).toMatchObject({ step: "psfs_rate", activities: ["stairs"], nprs: 3 });
  });

  it("later at any point saves nothing", () => {
    const s = outcomeStep(
      { ...offer, step: "psfs_rate", activities: ["x"], scores: [] },
      "later",
      null,
      [],
    )!;
    expect(s.next).toBeNull();
    expect(s.result).toBeUndefined();
  });

  it("anything else after the offer goes back to the normal chat", () => {
    expect(outcomeStep(offer, "can I book for Friday?", null, [])).toBeNull();
  });

  it("summarises for the practitioner", () => {
    expect(psfsMean([{ score: 4 }, { score: 7 }])).toBe(5.5);
    expect(
      outcomeSummary([
        { measure: "nprs", score: 6, created_at: "2026-10-14T10:00:00Z" },
        { measure: "psfs", score: 3, created_at: "2026-10-14T10:00:00Z" },
        { measure: "nprs", score: 3, created_at: "2026-10-28T10:00:00Z" },
        { measure: "psfs", score: 6.7, created_at: "2026-10-28T10:00:00Z" },
      ]),
    ).toBe("NPRS 6 → 3, PSFS 3.0 → 6.7 (since 14 Oct)");
  });
});
