import { describe, expect, it } from "vitest";
import {
  decide,
  type ConversationSnapshot,
  type DecisionContext,
  type InboundForDecision,
} from "./conversation";
import { runRedFlagRules } from "./red-flag-rules";
import { readFrequency, sayTime } from "./schedule";
import { OPT_OUT_CONFIRMATION } from "./intent";

// Synthetic only.
const NOW = new Date("2026-10-09T10:00:00Z");
const snap = (state: ConversationSnapshot["state"], draft = {}): ConversationSnapshot => ({
  state,
  draft,
  checkinStartedAt: NOW,
});
const msg = (text: string, replyId?: string): InboundForDecision => ({
  text,
  replyId,
  kind: replyId ? "interactive" : "text",
});
const ctx = (conversation: ConversationSnapshot, message: InboundForDecision): DecisionContext => ({
  conversation,
  message,
  client: { firstName: "Sam" },
  hasConsent: true,
  checkedInToday: false,
  redFlags: runRedFlagRules({ text: message.text }),
  now: NOW,
});
const bodies = (d: ReturnType<typeof decide>) => d.replies.map((r) => ("body" in r ? r.body : ""));

describe("schedule helpers", () => {
  it("says times the way people do", () => {
    expect(sayTime("18:00")).toBe("6pm");
    expect(sayTime("07:30")).toBe("7:30am");
    expect(sayTime("12:00")).toBe("12pm");
    expect(sayTime("00:15")).toBe("12:15am");
  });
  it("reads typed frequencies", () => {
    expect(readFrequency(undefined, "every day please")?.id).toBe("sched_daily");
    expect(readFrequency(undefined, "only weekdays")?.id).toBe("sched_weekdays");
    expect(readFrequency(undefined, "3 times a week")?.id).toBe("sched_3x");
    expect(readFrequency(undefined, "once a week")?.id).toBe("sched_weekly");
    expect(readFrequency(undefined, "hmm not sure")).toBeNull();
  });
});

describe("onboarding asks how often and when", () => {
  it("frequency, then time, then confirms with STOP and starts the first check-in", () => {
    const a = decide(
      ctx(
        snap("awaiting_schedule", { scheduleStep: "frequency" }),
        msg("3 times a week", "sched_3x"),
      ),
    );
    expect(a.next).toMatchObject({
      state: "awaiting_schedule",
      draft: { scheduleStep: "time", scheduleId: "sched_3x" },
    });
    expect(bodies(a)[0]).toMatch(/what time of day/i);

    const b = decide(ctx(a.next, msg("7:30am")));
    expect(b.setSchedule).toEqual({ days: [1, 3, 5], frequency: "custom", time: "07:30" });
    expect(bodies(b)[0]).toContain("on Mondays, Wednesdays and Fridays at 7:30am");
    expect(bodies(b)[0]).toContain("reply STOP");
    expect(b.next.state).toBe("awaiting_pain");
  });

  it("a tapped time works too", () => {
    const d = decide(
      ctx(
        snap("awaiting_schedule", { scheduleStep: "time", scheduleId: "sched_daily" }),
        msg("Evening (6pm)", "time_1800"),
      ),
    );
    expect(d.setSchedule).toEqual({
      days: [0, 1, 2, 3, 4, 5, 6],
      frequency: "daily",
      time: "18:00",
    });
    expect(bodies(d)[0]).toContain("every day at 6pm");
  });

  it("asks once more, then falls back to daily at 6pm rather than getting stuck", () => {
    const a = decide(
      ctx(snap("awaiting_schedule", { scheduleStep: "frequency" }), msg("whatever")),
    );
    expect(a.next.state).toBe("awaiting_schedule");
    const b = decide(ctx(a.next, msg("dunno")));
    expect(b.setSchedule).toMatchObject({ frequency: "daily", time: "18:00" });
    expect(bodies(b)[0]).toMatch(/for now/);
    expect(b.next.state).toBe("awaiting_pain");
  });

  it("STOP still works mid-setup", () => {
    const d = decide(ctx(snap("awaiting_schedule", { scheduleStep: "frequency" }), msg("stop")));
    expect(bodies(d)).toContain(OPT_OUT_CONFIRMATION);
    expect(d.optOut).toBe(true);
  });

  it("later, 'only weekdays' changes the days and keeps the time", () => {
    const d = decide(ctx(snap("idle"), msg("only weekdays please")));
    expect(d.setSchedule).toEqual({ days: [1, 2, 3, 4, 5], frequency: "custom" });
  });
});
