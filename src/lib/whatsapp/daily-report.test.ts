import { describe, expect, it } from "vitest";
import {
  dailyReportDue,
  formatDailyReport,
  isDailyReportAsk,
  shortDailyReport,
  sumAiUsage,
  type DailyReport,
} from "./daily-report.server";
import { reminderSlot } from "./checkin-reminder-tick.server";

const base: DailyReport = {
  date: "2026-10-28",
  due: 12,
  sent: 11,
  failed: 1,
  windowClosed: 0,
  replied: 8,
  saved: 9,
  savedWhatsApp: 7,
  redFlags: 1,
  redFlagsUnread: 0,
  inbound: 34,
  inboundFailed: 0,
  aiCalls: 52,
  aiFailed: 1,
  problems: [],
};

describe("daily Buddy report", () => {
  it("adds up AI heartbeats", () => {
    expect(
      sumAiUsage([
        "claude-sonnet calls=3 failed=1 in=10 out=5; gemini calls=2 failed=0 in=1 out=1",
        null,
        "claude-sonnet calls=4 failed=0 in=1 out=1",
      ]),
    ).toEqual({ calls: 9, failed: 1 });
  });

  it("reads like a status, counts only", () => {
    const text = formatDailyReport(base);
    expect(text).toContain("Check-ins: 12 due, 11 sent, 1 failed, 8 answered.");
    expect(text).toContain("AI: 52 calls, 1 failed.");
    expect(text).not.toContain("all good");
    expect(formatDailyReport({ ...base, failed: 0, aiFailed: 0 })).toContain("all good");
  });

  it("lists stopped jobs", () => {
    const text = formatDailyReport({
      ...base,
      problems: [{ label: "Wearables sync", problem: "No successful run since 2026-10-27 06:00" }],
    });
    expect(text).toContain("Needs a look:\n• Wearables sync: No successful run");
  });

  it("the template line has no line breaks", () => {
    const line = shortDailyReport(base);
    expect(line).not.toContain("\n");
    expect(line).toBe("11 of 12 check-ins sent, 8 answered, 1 red flag, 2 things to look at");
  });

  it("goes out between 19:30 and 22:00 South African time", () => {
    expect(dailyReportDue(new Date("2026-10-28T17:29:00Z"))).toBe(false);
    expect(dailyReportDue(new Date("2026-10-28T17:30:00Z"))).toBe(true);
    expect(dailyReportDue(new Date("2026-10-28T20:00:00Z"))).toBe(false);
  });

  it("knows when it's being asked for", () => {
    expect(isDailyReportAsk("buddy report")).toBe(true);
    expect(isDailyReportAsk("how's buddy doing?")).toBe(true);
    expect(isDailyReportAsk("is buddy working")).toBe(true);
    expect(isDailyReportAsk("report sam's pain")).toBe(false);
  });
});

describe("reminder retry", () => {
  const at = (h: number, m: number) => h * 60 + m;
  it("first try at the time, one retry two hours later", () => {
    expect(reminderSlot(at(18, 0), at(18, 0))).toBe("first");
    expect(reminderSlot(at(18, 6), at(18, 0))).toBe("first");
    expect(reminderSlot(at(18, 30), at(18, 0))).toBeNull();
    expect(reminderSlot(at(20, 2), at(18, 0))).toBe("retry");
    expect(reminderSlot(at(20, 10), at(18, 0))).toBeNull();
  });
  it("no retry late at night", () => {
    expect(reminderSlot(at(22, 0), at(20, 0))).toBeNull();
    expect(reminderSlot(at(21, 30), at(19, 30))).toBe("retry");
  });
});
