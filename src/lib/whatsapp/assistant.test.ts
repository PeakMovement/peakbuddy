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

describe("the second live test (5 Oct, 05:41)", () => {
  it("Hi buddy after checking in gets a hello and the menu, not 'passed on'", () => {
    expect(routeByKeywords("Hi buddy").intent).toBe("greeting");
    const d = decide(ctx("Hi buddy"));
    expect(d.replies[0].kind).toBe("list");
    expect(d.noteForPractitioner).toBeUndefined();
  });
  it("Can I change my symptoms? logs a change, it is not a clinical question", () => {
    expect(routeByKeywords("Can I change my symptoms?").intent).toBe("log_change");
    const d = decide(ctx("Can I change my symptoms?"));
    expect(d.clinicalQuestion).toBeUndefined();
    expect(bodies(d)).toEqual([ASSIST_MSG.changeAskPain]);
  });
  it("Can you tell what you can do? shows the menu", () => {
    expect(routeByKeywords("Can you tell what you can do ?").intent).toBe("help");
    expect(routeByKeywords("menu").intent).toBe("help");
    const d = decide(ctx("Can you tell what you can do ?"));
    expect(d.replies[0].kind).toBe("list");
  });
});

describe("menu choices", () => {
  const pick = (id: string, over: Partial<DecisionContext> = {}) =>
    decide({ ...ctx("", over), message: { text: "", replyId: id, kind: "interactive" } });
  it("each item does what it says", () => {
    expect(bodies(pick("menu_change"))).toEqual([ASSIST_MSG.changeAskPain]);
    expect(bodies(pick("menu_book"))[0]).toContain(PRACTICE_WHATSAPP_LINK);
    expect(bodies(pick("menu_info"))[0]).toMatch(/Strand Street/);
    expect(bodies(pick("menu_exercises"))[0]).toMatch(/Library/);
    expect(bodies(pick("menu_watch"))[0]).toMatch(/Wearables/);
    expect(bodies(pick("menu_progress", { progressText: "trend" }))).toEqual(["trend"]);
  });
  it("Ask a question takes the next message as the question for Justin", () => {
    const first = pick("menu_question");
    expect(first.next.draft.awaitingQuestion).toBe(true);
    const d = decide(ctx("Is it ok to run on it yet", { conversation: first.next }));
    expect(d.clinicalQuestion).toBe("Is it ok to run on it yet");
  });
  it("Change check-in time takes a bare time next", () => {
    const first = pick("menu_time");
    const d = decide(ctx("7am", { conversation: first.next }));
    expect(d.setReminderTime).toBe("07:00");
  });
});

describe("merged from Lovable's pass (5 Oct)", () => {
  it("reads more ways of logging a change", () => {
    for (const t of [
      "I made a mistake",
      "wrong score earlier",
      "my pain has gone up",
      "I'm getting worse",
    ]) {
      expect(routeByKeywords(t).intent).toBe("log_change");
    }
  });
  it("a short question it can't place is asked back instead of filed as a note", () => {
    const d = decide(ctx("Is the parking free on weekends?", { route: { intent: "other" } }));
    expect(bodies(d)).toEqual([ASSIST_MSG.clarify]);
    expect(d.noteForPractitioner).toBeUndefined();
  });
  it("the model calling it 'capabilities' still shows the menu", () => {
    expect(validRoute({ intent: "capabilities" })).toEqual({ intent: "help", answer: null });
  });
});
