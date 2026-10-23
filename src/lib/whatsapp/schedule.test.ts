import { describe, expect, it } from "vitest";
import {
  decide,
  type ConversationSnapshot,
  type DecisionContext,
  type InboundForDecision,
} from "./conversation";
import { runRedFlagRules } from "./red-flag-rules";
import { readFrequency, readScheduleChange, reminderDueOnWeekday, sayTime } from "./schedule";
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
  it("reads typed frequencies, including a count or named days", () => {
    expect(readFrequency(undefined, "every day please")?.id).toBe("sched_daily");
    expect(readFrequency(undefined, "only weekdays")?.id).toBe("sched_weekdays");
    expect(readFrequency(undefined, "3 times a week")?.id).toBe("sched_3x");
    expect(readFrequency(undefined, "twice a week")?.days).toEqual([1, 4]);
    expect(readFrequency(undefined, "2 times per week")?.id).toBe("sched_2x");
    expect(readFrequency(undefined, "4 times a week")?.days).toEqual([1, 2, 4, 5]);
    expect(readFrequency(undefined, "once a week")?.id).toBe("sched_weekly");
    expect(readFrequency(undefined, "only on Tuesdays and Thursdays")?.days).toEqual([2, 4]);
    expect(readFrequency(undefined, "every Tuesday")?.phrase).toBe("every Tuesday");
    expect(readFrequency(undefined, "every day except Sunday")?.days).toEqual([1, 2, 3, 4, 5, 6]);
    expect(readFrequency(undefined, "not on weekends")?.id).toBe("sched_weekdays");
    expect(readFrequency(undefined, "hmm not sure")).toBeNull();
  });
  it("a later chat changes frequency only when they are asking for that", () => {
    expect(readScheduleChange("please only check in twice a week")?.days).toEqual([1, 4]);
    expect(readScheduleChange("check in 4 times per week")?.days).toEqual([1, 2, 4, 5]);
    expect(readScheduleChange("only on Tuesdays and Thursdays")?.days).toEqual([2, 4]);
    expect(readScheduleChange("actually let's do every Monday")?.days).toEqual([1]);
    expect(readScheduleChange("Is the parking free on weekends?")).toBeNull();
    expect(readScheduleChange("training twice a week")).toBeNull();
    expect(readScheduleChange("my knee hurts on Mondays")).toBeNull();
    expect(readScheduleChange("4")).toBeNull();
    expect(readScheduleChange("remind me at 7am")).toBeNull();
    expect(readScheduleChange("change my check-in time to 6pm")).toBeNull();
  });
  it("the scheduler sends only on the saved days", () => {
    expect(reminderDueOnWeekday([1, 4], 1)).toBe(true);
    expect(reminderDueOnWeekday([1, 4], 2)).toBe(false);
    expect(reminderDueOnWeekday("{1,4}", 4)).toBe(true);
    expect(reminderDueOnWeekday([0, 1, 2, 3, 4, 5, 6], 0)).toBe(true);
    expect(reminderDueOnWeekday([], 3)).toBe(false);
    expect(reminderDueOnWeekday(null, 3)).toBe(false);
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

  it("twice a week, or named days, are what gets saved", () => {
    const a = decide(
      ctx(snap("awaiting_schedule", { scheduleStep: "frequency" }), msg("twice a week")),
    );
    expect(a.next.draft.scheduleDays).toEqual([1, 4]);
    const b = decide(ctx(a.next, msg("8am")));
    expect(b.setSchedule).toEqual({ days: [1, 4], frequency: "custom", time: "08:00" });
    expect(bodies(b)[0]).toContain("on Mondays and Thursdays at 8am");

    const named = decide(
      ctx(
        snap("awaiting_schedule", { scheduleStep: "frequency" }),
        msg("only on Tuesdays and Thursdays"),
      ),
    );
    expect(named.next.draft.scheduleDays).toEqual([2, 4]);
    const done = decide(ctx(named.next, msg("7:30am")));
    expect(done.setSchedule).toEqual({ days: [2, 4], frequency: "custom", time: "07:30" });
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

  it("later, a different weekly count or different days replaces the daily default", () => {
    const twice = decide(ctx(snap("idle"), msg("please only check in twice a week")));
    expect(twice.setSchedule).toEqual({ days: [1, 4], frequency: "custom" });
    expect(bodies(twice)[0]).toContain("on Mondays and Thursdays");

    const days = decide(ctx(snap("idle"), msg("only on Tuesdays and Thursdays")));
    expect(days.setSchedule).toEqual({ days: [2, 4], frequency: "custom" });

    const four = decide(ctx(snap("idle"), msg("check in 4 times per week")));
    expect(four.setSchedule).toEqual({ days: [1, 2, 4, 5], frequency: "custom" });

    const back = decide(ctx(snap("idle"), msg("please check in every day")));
    expect(back.setSchedule).toEqual({
      days: [0, 1, 2, 3, 4, 5, 6],
      frequency: "daily",
    });
  });

  it("a time and days in one message are both saved, without starting from the daily default", () => {
    const d = decide(ctx(snap("idle"), msg("check in at 7am only on weekdays")));
    expect(d.setSchedule).toEqual({
      days: [1, 2, 3, 4, 5],
      frequency: "custom",
      time: "07:00",
    });
    expect(d.setReminderTime).toBeUndefined();
  });

  it("changing days mid check-in keeps the question open", () => {
    const conv = snap("awaiting_sleep", { pain: 3, notes: [] });
    const d = decide(ctx(conv, msg("please check in only twice a week")));
    expect(d.setSchedule).toEqual({ days: [1, 4], frequency: "custom" });
    expect(d.next).toEqual(conv);
  });

  it("a pain score or a sore knee is not a schedule change", () => {
    const pain = decide(ctx(snap("awaiting_pain", { notes: [] }), msg("4")));
    expect(pain.setSchedule).toBeUndefined();
    expect(pain.next.state).toBe("awaiting_sleep");
    const knee = decide(ctx(snap("idle"), msg("my knee hurts on Mondays")));
    expect(knee.setSchedule).toBeUndefined();
  });
});
