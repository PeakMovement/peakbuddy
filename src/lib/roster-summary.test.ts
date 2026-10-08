import { describe, expect, it } from "vitest";
import { cadenceDays, summarizeCheckIns, windowCompliance } from "./roster-summary";
import { fetchAllPages } from "./paged-select";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-08T12:00:00Z");
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

describe("summarizeCheckIns", () => {
  it("takes the newest check-in per client and counts the window", () => {
    const s = summarizeCheckIns([
      { client_id: "a", created_at: iso(1) },
      { client_id: "b", created_at: iso(2) },
      { client_id: "a", created_at: iso(5) },
    ]);
    expect(s.a).toEqual({ last: iso(1), windowCount: 2 });
    expect(s.b).toEqual({ last: iso(2), windowCount: 1 });
  });
});

describe("windowCompliance", () => {
  it("scores a daily client over the overlap of programme and window", () => {
    const client = {
      created_at: iso(10),
      tracking_duration_weeks: 8,
      check_in_frequency: "daily",
    };
    expect(windowCompliance(client, 5, NOW)).toBe(50);
  });

  it("only expects check-ins inside the 90 day window for long programmes", () => {
    const client = {
      created_at: iso(400),
      tracking_duration_weeks: 104,
      check_in_frequency: "weekly",
    };
    // 90 days / 7 = 13 expected
    expect(windowCompliance(client, 13, NOW)).toBe(100);
  });

  it("returns null when the programme ended before the window", () => {
    const client = {
      created_at: iso(300),
      tracking_duration_weeks: 8,
      check_in_frequency: "daily",
    };
    expect(windowCompliance(client, 0, NOW)).toBeNull();
  });

  it("treats as_needed as fully compliant", () => {
    expect(cadenceDays("as_needed")).toBe(0);
    expect(windowCompliance({ created_at: iso(5), check_in_frequency: "as_needed" }, 0, NOW)).toBe(
      100,
    );
  });
});

describe("fetchAllPages", () => {
  it("walks past the first page until a short page", async () => {
    const all = Array.from({ length: 2500 }, (_, i) => i);
    const calls: [number, number][] = [];
    const r = await fetchAllPages<number>(async (from, to) => {
      calls.push([from, to]);
      return { data: all.slice(from, to + 1), error: null };
    });
    expect(r.rows).toHaveLength(2500);
    expect(r.truncated).toBe(false);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("stops at maxRows and reports truncation", async () => {
    const r = await fetchAllPages<number>(
      async (from, to) => ({ data: Array.from({ length: to - from + 1 }, () => 1), error: null }),
      { pageSize: 10, maxRows: 25 },
    );
    expect(r.rows).toHaveLength(25);
    expect(r.truncated).toBe(true);
  });
});
