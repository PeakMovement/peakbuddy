import { describe, it, expect } from "vitest";
import { scoreSafetyNet, EVAL_CASES } from "./yves-eval";

describe("Yves safety-net eval", () => {
  const r = scoreSafetyNet();
  it("catches every emergency case via hard override or the floor", () => {
    expect(r.emergenciesCaught).toBe(r.emergenciesTotal);
    expect(r.emergenciesTotal).toBeGreaterThanOrEqual(7);
  });
  it("does not flag any clearly-benign case", () => {
    expect(r.benignFalsePositives).toEqual([]);
  });
  it("never hard-overrides on a negated or attributed emergency", () => {
    expect(r.overrideMisfires).toEqual([]);
  });
});
