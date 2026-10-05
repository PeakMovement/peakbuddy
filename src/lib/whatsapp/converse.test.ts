import { describe, expect, it } from "vitest";
import { looksLikeAdvice, sanitizeReply, validConverse, formatHistory } from "./converse";
import { decide, type ConversationSnapshot, type DecisionContext } from "./conversation";
import { ASSIST_MSG, PRACTICE_WHATSAPP_LINK } from "./assistant";
import { runRedFlagRules } from "./red-flag-rules";

// Synthetic only.
const NOW = new Date("2026-10-05T08:00:00Z");
const idle: ConversationSnapshot = { state: "idle", draft: {}, checkinStartedAt: null };
const midSleep: ConversationSnapshot = {
  state: "awaiting_sleep",
  draft: { pain: 4, notes: [] },
  checkinStartedAt: NOW,
};

function ctx(text: string, over: Partial<DecisionContext> = {}): DecisionContext {
  return {
    message: { text, kind: "text" },
    conversation: idle,
    client: { firstName: "Test" },
    hasConsent: true,
    checkedInToday: true,
    redFlags: runRedFlagRules({ text }),
    now: NOW,
    route: { intent: "other" },
    ...over,
  };
}
const bodies = (d: ReturnType<typeof decide>) => d.replies.map((r) => ("body" in r ? r.body : ""));

describe("guarding the model's words", () => {
  it("anything that reads like treatment advice becomes the hand-off to Justin", () => {
    for (const r of [
      "Try icing it for 20 minutes.",
      "I'd recommend resting it for a few days.",
      "Sounds like a muscle strain, nothing to worry about.",
      "You should take some ibuprofen.",
    ]) {
      expect(looksLikeAdvice(r)).toBe(true);
      expect(validConverse({ reply: r, action: "none", time: null })).toEqual({
        reply: "",
        action: "clinical_question",
      });
    }
    expect(looksLikeAdvice("That sounds frustrating, sorry to hear it.")).toBe(false);
  });
  it("removes links that aren't ours and dashes", () => {
    expect(sanitizeReply("See https://evil.example/x — or ours " + PRACTICE_WHATSAPP_LINK)).toBe(
      "See, or ours " + PRACTICE_WHATSAPP_LINK,
    );
  });
  it("refuses unknown actions and bad times", () => {
    expect(validConverse({ reply: "hi", action: "prescribe", time: null })).toBeNull();
    expect(
      validConverse({ reply: "Sure", action: "set_checkin_time", time: "25:00" })?.time,
    ).toBeNull();
    expect(validConverse({ reply: "Sure", action: "set_checkin_time", time: "07:30" })?.time).toBe(
      "07:30",
    );
    expect(validConverse({ reply: "", action: "none", time: null })).toBeNull();
  });
  it("formats recent history for the model", () => {
    expect(
      formatHistory([
        { from: "patient", text: "hi" },
        { from: "buddy", text: "Hello" },
      ]),
    ).toBe("Patient: hi\nBuddy: Hello");
  });
});

describe("talking like a person outside a check-in", () => {
  it("a plain reply when that's all that's needed", () => {
    const d = decide(
      ctx("haha you're quick", {
        converse: { reply: "Ha, I try! Anything I can help with?", action: "none" },
      }),
    );
    expect(bodies(d)).toEqual(["Ha, I try! Anything I can help with?"]);
    expect(d.next.state).toBe("idle");
  });
  it("brings it back to centre with a nudge when today's check-in isn't done", () => {
    const d = decide(
      ctx("long day at work", {
        checkedInToday: false,
        converse: { reply: "Sounds like a long one. Sorry to hear it.", action: "none" },
      }),
    );
    expect(bodies(d)).toEqual([
      "Sounds like a long one. Sorry to hear it.",
      ASSIST_MSG.checkinNudge,
    ]);
  });
  it("starts the check-in when the model judges they're ready", () => {
    const d = decide(
      ctx("ok lets go", {
        checkedInToday: false,
        converse: { reply: "Great, let's do it.", action: "start_checkin" },
      }),
    );
    expect(d.next.state).toBe("awaiting_pain");
  });
  it("passes a statement on to the physio with a human acknowledgement", () => {
    const d = decide(
      ctx("my glute is still really tight", {
        converse: {
          reply: "Thanks for letting me know, I'll pass that on.",
          action: "note_for_practitioner",
        },
      }),
    );
    expect(d.noteForPractitioner).toBe("my glute is still really tight");
    expect(bodies(d)).toEqual(["Thanks for letting me know, I'll pass that on."]);
  });
  it("never lets the model's words through on a clinical question", () => {
    const d = decide(
      ctx("is it bad that it clicks", { converse: { reply: "", action: "clinical_question" } }),
    );
    expect(bodies(d)).toEqual([ASSIST_MSG.clinical]);
    expect(d.clinicalQuestion).toBe("is it bad that it clicks");
  });
  it("booking adds the real links after the model's words", () => {
    const d = decide(
      ctx("can I come in thursday", { converse: { reply: "Of course.", action: "booking" } }),
    );
    expect(bodies(d)).toEqual(["Of course.", ASSIST_MSG.booking]);
  });
  it("without the model, the old fixed behaviour still applies", () => {
    const d = decide(ctx("Is the parking free on weekends?"));
    expect(bodies(d)).toEqual([ASSIST_MSG.clarify]);
  });
});

describe("off-script in the middle of a check-in", () => {
  it("answers, then puts the pending question back", () => {
    const d = decide(
      ctx("sorry was driving", {
        conversation: midSleep,
        converse: { reply: "No stress, take your time.", action: "none" },
      }),
    );
    expect(bodies(d)[0]).toBe("No stress, take your time.");
    expect(d.replies[1].kind).toBe("list");
    expect(d.next.state).toBe("awaiting_sleep");
    expect(d.next.draft.notes).toEqual(["sorry was driving"]);
  });
  it("can skip sleep or energy, but never pain", () => {
    const skip = decide(
      ctx("rather not say", {
        conversation: midSleep,
        converse: { reply: "That's fine.", action: "skip_question" },
      }),
    );
    expect(skip.next.state).toBe("awaiting_energy");
    const pain: ConversationSnapshot = {
      state: "awaiting_pain",
      draft: { notes: [] },
      checkinStartedAt: NOW,
    };
    const noSkip = decide(
      ctx("skip this", {
        conversation: pain,
        converse: { reply: "Sure.", action: "skip_question" },
      }),
    );
    expect(noSkip.next.state).toBe("awaiting_pain");
  });
  it("can pause and keeps what was answered", () => {
    const d = decide(
      ctx("can we do this later", {
        conversation: midSleep,
        converse: { reply: "", action: "pause_checkin" },
      }),
    );
    expect(bodies(d)).toEqual([ASSIST_MSG.paused]);
    expect(d.next.state).toBe("idle");
    expect(d.next.draft.pain).toBe(4);
  });
  it("a clinical question mid check-in goes to Justin and the question comes back", () => {
    const d = decide(
      ctx("should i be sleeping on my side?", {
        conversation: midSleep,
        converse: { reply: "", action: "clinical_question" },
      }),
    );
    expect(bodies(d)[0]).toBe(ASSIST_MSG.clinical);
    expect(d.replies[1].kind).toBe("list");
    expect(d.clinicalQuestion).toBeTruthy();
  });
});
