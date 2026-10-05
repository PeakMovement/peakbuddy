import { describe, expect, it } from "vitest";
import {
  ASSIST_MSG,
  PRACTICE_WHATSAPP_LINK,
  practiceAnswerByKeywords,
  progressSummary,
  routeByKeywords,
} from "./assistant";
import { decide, type ConversationSnapshot, type DecisionContext } from "./conversation";
import { runRedFlagRules } from "./red-flag-rules";
import { validRoute } from "./ai.server";

// Synthetic messages only.
const NOW = new Date("2026-10-05T08:00:00Z");
const idle: ConversationSnapshot = { state: "idle", draft: {}, checkinStartedAt: null };

function ctx(text: string, over: Partial<DecisionContext> = {}): DecisionContext {
  return {
    message: { text, kind: "text" },
    conversation: idle,
    client: { firstName: "Test" },
    hasConsent: true,
    checkedInToday: true,
    redFlags: runRedFlagRules({ text }),
    now: NOW,
    ...over,
  };
}
const bodies = (d: ReturnType<typeof decide>) => d.replies.map((r) => ("body" in r ? r.body : ""));

describe("keyword routing", () => {
  it("reads the messages from the first live test correctly", () => {
    expect(routeByKeywords("May I log a change?").intent).toBe("log_change");
    expect(routeByKeywords("May I change my symptom?").intent).toBe("log_change");
  });
  it("recognises bookings, practice questions and clinical questions", () => {
    expect(routeByKeywords("When can I get a check-up?").intent).toBe("booking");
    expect(routeByKeywords("I need to reschedule my appointment").intent).toBe("booking");
    expect(routeByKeywords("How much is a follow up?").intent).toBe("practice_info");
    expect(routeByKeywords("Do you take Discovery medical aid?").intent).toBe("practice_info");
    expect(routeByKeywords("Should I ice it or use heat?").intent).toBe("clinical_question");
    expect(routeByKeywords("What were my exercises again?").intent).toBe("exercises");
    expect(routeByKeywords("How has my pain been this week?").intent).toBe("progress");
    expect(routeByKeywords("thanks!").intent).toBe("greeting");
    expect(routeByKeywords("The new exercise makes my hip click").intent).toBe("other");
  });
});

describe("practice answers without AI", () => {
  it("states only the approved facts", () => {
    expect(practiceAnswerByKeywords("how much is it?")).toMatch(/R900.*R750/);
    expect(practiceAnswerByKeywords("do you do medical aid")).toMatch(/invoice/);
    expect(practiceAnswerByKeywords("where is parking")).toMatch(/Strand Street/);
    expect(practiceAnswerByKeywords("do you have a gym membership")).toBeNull();
  });
});

describe("answering instead of starting a check-in", () => {
  it("log a change after today's check-in asks for pain then what changed, and saves an update", () => {
    let d = decide(ctx("May I log a change?"));
    expect(bodies(d)).toEqual([ASSIST_MSG.changeAskPain]);
    expect(d.next).toMatchObject({ state: "awaiting_pain", draft: { update: true } });

    d = decide(ctx("5", { conversation: d.next }));
    expect(bodies(d)).toEqual([ASSIST_MSG.changeAskWhat]);
    expect(d.next.state).toBe("awaiting_notes");

    d = decide(ctx("Glute is tighter after sitting all day", { conversation: d.next }));
    expect(d.saveCheckin).toEqual({
      pain: 5,
      sleep: null,
      energy: null,
      notes: "Update: Glute is tighter after sitting all day",
      flagged: false,
    });
    expect(bodies(d)).toEqual([ASSIST_MSG.changeSaved]);
    expect(d.next.state).toBe("idle");
    expect(d.markWearableOffered).toBeUndefined();
  });

  it("before today's check-in, logging a change just starts the check-in", () => {
    const d = decide(ctx("I want to update my symptoms", { checkedInToday: false }));
    expect(d.next.state).toBe("awaiting_pain");
    expect(d.next.draft.update).toBeUndefined();
  });

  it("booking requests get the practice WhatsApp link", () => {
    const d = decide(ctx("When can I get a check up?"));
    expect(bodies(d)[0]).toContain(PRACTICE_WHATSAPP_LINK);
  });

  it("clinical questions are never answered and Justin is alerted", () => {
    const d = decide(ctx("Should I ice it?"));
    expect(bodies(d)).toEqual([ASSIST_MSG.clinical]);
    expect(d.clinicalQuestion).toBe("Should I ice it?");
  });

  it("uses the AI's practice answer when there is one, and the link when there isn't", () => {
    const withAnswer = decide(
      ctx("anything", { route: { intent: "practice_info", answer: "We're open from 08:30." } }),
    );
    expect(bodies(withAnswer)).toEqual(["We're open from 08:30."]);
    const without = decide(
      ctx("do you sell protein powder?", { route: { intent: "practice_info", answer: null } }),
    );
    expect(bodies(without)).toEqual([ASSIST_MSG.practiceUnknown]);
  });

  it("nudges toward today's check-in when it hasn't been done", () => {
    const d = decide(ctx("How much is a follow up?", { checkedInToday: false }));
    expect(bodies(d)).toContain(ASSIST_MSG.checkinNudge);
    expect(d.next.state).toBe("idle");
  });

  it("CHECK IN starts the check-in", () => {
    const d = decide(ctx("check in", { checkedInToday: false }));
    expect(d.next.state).toBe("awaiting_pain");
  });

  it("an opening statement is kept as a note on the check-in it starts", () => {
    const d = decide(ctx("my knee is a bit stiff today", { checkedInToday: false }));
    expect(d.next.draft.notes).toEqual(["my knee is a bit stiff today"]);
  });

  it("a red flag inside a question still gets the safety message first", () => {
    const text = "Should I worry that my calf is swollen and hot?";
    const d = decide(ctx(text, { redFlags: runRedFlagRules({ text }) }));
    expect(bodies(d)[0]).toMatch(/flagged this|10177/);
    expect(d.clinicalQuestion).toBeTruthy();
  });
});

describe("progress", () => {
  it("describes the patient's own trend", () => {
    const s = progressSummary([
      { at: "2026-10-01", pain: 6 },
      { at: "2026-10-03", pain: 4 },
      { at: "2026-10-05", pain: 3 },
    ]);
    expect(s).toMatch(/come down from 6 to 3 over your last 3 check-ins/);
  });
  it("says so when there isn't enough yet", () => {
    expect(progressSummary([{ at: "2026-10-05", pain: 3 }])).toBe(ASSIST_MSG.progressNone);
  });
});

describe("AI route validation", () => {
  it("rejects anything outside the known intents and drops answers on other intents", () => {
    expect(validRoute({ intent: "diagnose" })).toBeNull();
    expect(validRoute({ intent: "booking", answer: "Tuesday at 3" })).toEqual({
      intent: "booking",
      answer: null,
    });
    expect(validRoute({ intent: "practice_info", answer: " R900 " })).toEqual({
      intent: "practice_info",
      answer: "R900",
    });
  });
});
