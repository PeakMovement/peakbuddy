import { describe, expect, it } from "vitest";
import { trendSignal } from "./trends";

const now = new Date("2026-10-28T16:00:00Z");
const p = (
  daysAgo: number,
  pain: number | null,
  sleep: number | null = 3,
  energy: number | null = 3,
) => ({
  at: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
  pain,
  sleep,
  energy,
});

describe("quiet trend signals", () => {
  it("pain up at each of the last 3 check-ins by 2+", () => {
    expect(trendSignal([p(8, 3), p(6, 3), p(4, 4), p(2, 5), p(1, 6)], now)).toEqual({
      rule: "pain_rising",
      text: "pain has gone up at each of the last 3 check-ins (3 → 4 → 5 → 6).",
    });
  });
  it("a dip in between is not a run", () => {
    expect(trendSignal([p(6, 3), p(4, 5), p(2, 4), p(1, 6)], now)).toBeNull();
  });
  it("rising by less than 2 in total is not enough", () => {
    expect(trendSignal([p(6, 3), p(4, 3.5), p(2, 4), p(1, 4.5)], now)).toBeNull();
  });
  it("sleep and energy both down 2+ over the week", () => {
    expect(trendSignal([p(6, 3, 4, 4), p(3, 3, 3, 3), p(1, 3, 2, 2)], now)?.rule).toBe(
      "sleep_energy_down",
    );
  });
  it("only one of them dropping is not a signal", () => {
    expect(trendSignal([p(6, 3, 4, 4), p(1, 3, 2, 3)], now)).toBeNull();
  });
  it("older than a week doesn't count for sleep and energy", () => {
    expect(trendSignal([p(10, 3, 5, 5), p(1, 3, 2, 2)], now)).toBeNull();
  });
});
