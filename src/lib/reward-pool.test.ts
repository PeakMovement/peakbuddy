import { describe, it, expect } from "vitest";
import {
  eligibleForCheckInCount,
  eligibleForManualApprove,
  eligibleForMilestone,
  pickRandom,
  type PoolReward,
} from "./reward-pool";

const r = (partial: Partial<PoolReward> & { id: string }): PoolReward => ({
  partner_id: null,
  practice_id: null,
  min_streak: null,
  min_check_ins: null,
  earn_on: "milestone",
  active: true,
  ...partial,
});

describe("eligibleForManualApprove", () => {
  it("prefers restaurant partners in the same (or platform) practice", () => {
    const pool = [
      r({ id: "generic" }),
      r({ id: "rest", partner_id: "p1" }),
      r({ id: "other-practice", partner_id: "p2", practice_id: "prac-b" }),
    ];
    const got = eligibleForManualApprove(pool, "prac-a");
    expect(got.map((x) => x.id)).toEqual(["rest"]);
  });

  it("falls back to generic when no restaurant is in scope", () => {
    const pool = [r({ id: "generic" }), r({ id: "off", active: false, partner_id: "p1" })];
    expect(eligibleForManualApprove(pool, null).map((x) => x.id)).toEqual(["generic"]);
  });
});

describe("eligibleForMilestone", () => {
  it("matches min_streak or unrestricted restaurant rewards", () => {
    const pool = [
      r({ id: "any-rest", partner_id: "p1" }),
      r({ id: "at-7", partner_id: "p1", min_streak: 7 }),
      r({ id: "at-3", partner_id: "p1", min_streak: 3 }),
      r({ id: "manual-only", partner_id: "p1", earn_on: "manual" }),
    ];
    expect(
      eligibleForMilestone(pool, null, 7)
        .map((x) => x.id)
        .sort(),
    ).toEqual(["any-rest", "at-7"].sort());
  });

  it("excludes check_in_count rows from streak issuance", () => {
    const pool = [
      r({ id: "count", earn_on: "check_in_count", min_check_ins: 5, partner_id: "p1" }),
    ];
    expect(eligibleForMilestone(pool, null, 7)).toEqual([]);
  });
});

describe("eligibleForCheckInCount", () => {
  it("issues once the total is met and skips already-issued ids", () => {
    const pool = [
      r({ id: "ten", earn_on: "check_in_count", min_check_ins: 10, partner_id: "p1" }),
      r({ id: "five", earn_on: "check_in_count", min_check_ins: 5, partner_id: "p1" }),
    ];
    const got = eligibleForCheckInCount(pool, null, 8, ["five"]);
    expect(got.map((x) => x.id)).toEqual([]);
    expect(eligibleForCheckInCount(pool, null, 10, ["five"]).map((x) => x.id)).toEqual(["ten"]);
  });
});

describe("pickRandom", () => {
  it("returns null on an empty list", () => {
    expect(pickRandom([])).toBeNull();
  });
  it("uses the rng to pick an index", () => {
    expect(pickRandom(["a", "b", "c"], () => 0.99)).toBe("c");
  });
});
