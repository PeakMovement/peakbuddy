import { describe, it, expect } from "vitest";
import { computeCalibration, nudgeThreshold } from "./calibration";

describe("computeCalibration", () => {
  it("suggests RAISE when a category has too many false alarms", () => {
    const rows = [
      ...Array.from({ length: 7 }, () => ({ category: "cardiac", outcome: "false_alarm" })),
      ...Array.from({ length: 2 }, () => ({ category: "cardiac", outcome: "confirmed" })),
    ];
    const r = computeCalibration(rows);
    const cardiac = r.categories.find((c) => c.category === "cardiac")!;
    expect(cardiac.n).toBe(9);
    expect(cardiac.suggestion).toBe("raise");
  });
  it("suggests LOWER when precision is high", () => {
    const rows = Array.from({ length: 10 }, () => ({ category: "neuro", outcome: "confirmed" }));
    expect(computeCalibration(rows).categories[0].suggestion).toBe("lower");
  });
  it("holds when the sample is too small and ignores already_aware/null", () => {
    const rows = [
      { category: "systemic", outcome: "confirmed" },
      { category: "systemic", outcome: "already_aware" },
      { category: "systemic", outcome: null },
    ];
    const c = computeCalibration(rows).categories[0];
    expect(c.n).toBe(1);
    expect(c.suggestion).toBe("hold");
  });
});

describe("nudgeThreshold", () => {
  it("bounds nudges to +/-10%", () => {
    expect(nudgeThreshold(2.0, "raise")).toBe(2.2);
    expect(nudgeThreshold(2.0, "lower")).toBe(1.8);
    expect(nudgeThreshold(2.0, "hold")).toBe(2.0);
  });
});
