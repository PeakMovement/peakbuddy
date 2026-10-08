import { ASSIST_MSG } from "./assistant";
import { describe, expect, it } from "vitest";
import {
  decide,
  IDS,
  MSG,
  STALE_CHECKIN_MS,
  type ConversationSnapshot,
  type DecisionContext,
  type InboundForDecision,
  WEARABLE_CONNECT_URL,
  readReminderTime,
} from "./conversation";
import { runRedFlagRules } from "./red-flag-rules";
import { OPT_OUT_CONFIRMATION, CONTACT_ACKNOWLEDGEMENT } from "./intent";
import { matchPhone, samePhone, toE164Digits, maskPhone } from "./phone";

// Synthetic only. No real patient words anywhere in this file.
const NOW = new Date("2026-10-05T08:00:00Z");

function snap(
  state: ConversationSnapshot["state"],
  draft = {},
  started: Date | null = null,
): ConversationSnapshot {
  return { state, draft, checkinStartedAt: started };
}

function msg(text: string, replyId?: string): InboundForDecision {
  return { text, replyId, kind: replyId ? "interactive" : "text" };
}

function ctx(over: Partial<DecisionContext> & { message: InboundForDecision }): DecisionContext {
  const text = over.message.text;
  return {
    conversation: snap("idle"),
    client: { firstName: "Test" },
    hasConsent: true,
    checkedInToday: false,
    redFlags: runRedFlagRules({ text }),
    now: NOW,
    ...over,
  };
}

const bodies = (d: ReturnType<typeof decide>) => d.replies.map((r) => ("body" in r ? r.body : ""));

describe("phone matching", () => {
  it("treats every common way of typing a SA number as the same line", () => {
    for (const typed of [
      "082 725 0000",
      "0827250000",
      "+27 82 725 0000",
      "27827250000",
      "+27 (0)82 725 0000",
      "0027 82 725 0000",
      "whatsapp:+27827250000",
    ]) {
      expect(toE164Digits(typed)).toBe("27827250000");
    }
  });
  it("matches a WhatsApp sender to the profile whatever format it was saved in", () => {
    expect(samePhone("27827250000", "082 725 0000")).toBe(true);
    expect(
      matchPhone("+27827250000", [
        { id: "a", phone: "082-725-0000" },
        { id: "b", phone: "0831110000" },
      ]),
    ).toEqual({ kind: "matched", id: "a" });
  });
  it("never guesses between two profiles sharing a number", () => {
    const m = matchPhone("27827250000", [
      { id: "a", phone: "0827250000" },
      { id: "b", phone: "+27 82 725 0000" },
    ]);
    expect(m.kind).toBe("ambiguous");
  });
  it("does not match junk or empty numbers", () => {
    expect(
      matchPhone("27827250000", [
        { id: "a", phone: null },
        { id: "b", phone: "" },
        { id: "c", phone: "123" },
      ]),
    ).toEqual({ kind: "none" });
  });
  it("masks to the last four digits", () => {
    expect(maskPhone("0827250000")).toBe("…0000");
  });
});

describe("unknown numbers", () => {
  it("get a polite reply and nothing is saved", () => {
    const d = decide(ctx({ message: msg("hi"), client: null }));
    expect(bodies(d)).toEqual([MSG.unmatched]);
    expect(d.saveCheckin).toBeUndefined();
    expect(d.recordConsent).toBeUndefined();
    expect(d.next.state).toBe("unmatched");
  });
});

describe("consent", () => {
  it("asks for consent before collecting anything", () => {
    const d = decide(ctx({ message: msg("hi"), hasConsent: false, conversation: snap("new") }));
    expect(d.next.state).toBe("awaiting_consent");
    expect(d.replies[0].kind).toBe("buttons");
    expect(d.saveCheckin).toBeUndefined();
  });
  it("records consent on I agree and goes straight into the check-in", () => {
    const d = decide(
      ctx({
        message: msg("I agree", IDS.consentYes),
        hasConsent: false,
        conversation: snap("awaiting_consent"),
      }),
    );
    expect(d.recordConsent).toBe(true);
    expect(d.next.state).toBe("awaiting_pain");
    expect(bodies(d)).toContain(MSG.askPain);
  });
  it("accepts a typed yes", () => {
    const d = decide(
      ctx({ message: msg("Yes"), hasConsent: false, conversation: snap("awaiting_consent") }),
    );
    expect(d.recordConsent).toBe(true);
  });
  it("No thanks opts out and records nothing", () => {
    const d = decide(
      ctx({
        message: msg("No thanks", IDS.consentNo),
        hasConsent: false,
        conversation: snap("awaiting_consent"),
      }),
    );
    expect(d.optOut).toBe(true);
    expect(d.recordConsent).toBeUndefined();
    expect(bodies(d)).toEqual([MSG.consentDeclined]);
  });
  it("anything else re-asks", () => {
    const d = decide(
      ctx({
        message: msg("what is this"),
        hasConsent: false,
        conversation: snap("awaiting_consent"),
      }),
    );
    expect(d.next.state).toBe("awaiting_consent");
    expect(d.recordConsent).toBeUndefined();
  });
});

describe("the check-in", () => {
  it("runs pain, sleep, energy, notes and saves one row on the app's scales", () => {
    let conv = snap("idle");
    let d = decide(ctx({ message: msg("hi"), conversation: conv }));
    expect(d.next.state).toBe("awaiting_pain");
    conv = d.next;

    d = decide(ctx({ message: msg("6"), conversation: conv }));
    expect(d.next.state).toBe("awaiting_sleep");
    expect(d.replies[0].kind).toBe("list");
    conv = d.next;

    d = decide(ctx({ message: msg("4 Well", IDS.sleep(4)), conversation: conv }));
    expect(d.next.state).toBe("awaiting_energy");
    conv = d.next;

    d = decide(ctx({ message: msg("3"), conversation: conv }));
    expect(d.next.state).toBe("awaiting_notes");
    conv = d.next;

    d = decide(ctx({ message: msg("Knee a bit stiff in the morning"), conversation: conv }));
    expect(d.saveCheckin).toEqual({
      pain: 6,
      sleep: 4,
      energy: 3,
      notes: "Knee a bit stiff in the morning",
      flagged: false,
    });
    expect(d.next.state).toBe("awaiting_wearable");
    expect(bodies(d)).toEqual([MSG.saved, MSG.wearableOffer]);
    expect(d.markWearableOffered).toBe(true);
  });

  it("Nothing to add saves with empty notes", () => {
    const conv = snap("awaiting_notes", { pain: 2, sleep: 5, energy: 5, notes: [] }, NOW);
    const d = decide(ctx({ message: msg("Nothing to add", IDS.notesNone), conversation: conv }));
    expect(d.saveCheckin?.notes).toBe("");
  });

  it("keeps the words around a pain score as a note", () => {
    const conv = snap("awaiting_pain", { notes: [] }, NOW);
    const d = decide(ctx({ message: msg("about a 5, stiff after sitting"), conversation: conv }));
    expect(d.next.draft.pain).toBe(5);
    expect(d.next.draft.notes).toEqual(["about a 5, stiff after sitting"]);
  });

  it("re-asks when the pain answer is not a number, without losing what they said", () => {
    const conv = snap("awaiting_pain", { notes: [] }, NOW);
    const d = decide(ctx({ message: msg("hard to say really"), conversation: conv }));
    expect(d.next.state).toBe("awaiting_pain");
    expect(bodies(d)).toEqual([MSG.askPainRetry]);
    expect(d.next.draft.notes).toEqual(["hard to say really"]);
  });

  it("rejects out of range scale answers", () => {
    const conv = snap("awaiting_sleep", { pain: 3, notes: [] }, NOW);
    const d = decide(ctx({ message: msg("7"), conversation: conv }));
    expect(d.next.state).toBe("awaiting_sleep");
  });

  it("drops a check-in left half done for more than 12 hours", () => {
    const old = new Date(NOW.getTime() - STALE_CHECKIN_MS - 1000);
    const conv = snap("awaiting_energy", { pain: 4, sleep: 3 }, old);
    const d = decide(ctx({ message: msg("hi"), conversation: conv }));
    expect(d.next.state).toBe("awaiting_pain");
    expect(d.next.draft.pain).toBeUndefined();
  });

  it("does not start a second check-in on the same day", () => {
    const d = decide(ctx({ message: msg("hi"), checkedInToday: true }));
    expect(d.replies[0].kind).toBe("list");
    expect(bodies(d)[0]).toMatch(/already checked in today/);
    expect(d.next.state).toBe("idle");
  });

  it("passes a real message sent after today's check-in to the practitioner", () => {
    const d = decide(
      ctx({ message: msg("The new exercise makes my hip click"), checkedInToday: true }),
    );
    expect(d.noteForPractitioner).toBe("The new exercise makes my hip click");
    expect(bodies(d)).toEqual([ASSIST_MSG.noteAddedMenu]);
  });
});

describe("opt out and contact", () => {
  it("STOP opts out in the middle of a check-in", () => {
    const d = decide(
      ctx({ message: msg("STOP"), conversation: snap("awaiting_sleep", { pain: 3 }, NOW) }),
    );
    expect(d.optOut).toBe(true);
    expect(d.next.state).toBe("opted_out");
    expect(bodies(d)).toEqual([OPT_OUT_CONFIRMATION]);
  });
  it("an opted out patient gets silence, not check-ins", () => {
    const d = decide(ctx({ message: msg("hi"), conversation: snap("opted_out") }));
    expect(d.replies).toEqual([]);
    expect(d.next.state).toBe("opted_out");
  });
  it("START brings them back through consent", () => {
    const d = decide(ctx({ message: msg("START"), conversation: snap("opted_out") }));
    expect(d.optIn).toBe(true);
    expect(d.next.state).toBe("awaiting_consent");
  });
  it("call me raises a contact request and keeps the check-in where it was", () => {
    const conv = snap("awaiting_sleep", { pain: 3 }, NOW);
    const d = decide(ctx({ message: msg("Please call me"), conversation: conv }));
    expect(d.contactRequest).toBe(true);
    expect(d.next).toEqual(conv);
    expect(bodies(d)).toEqual([CONTACT_ACKNOWLEDGEMENT]);
  });
});

describe("safety", () => {
  it("a red flag mid check-in gets the safety message first and the check-in carries on", () => {
    const conv = snap("awaiting_pain", { notes: [] }, NOW);
    const d = decide(
      ctx({
        message: msg("9, my calf is swollen and hot"),
        conversation: conv,
        redFlags: runRedFlagRules({ text: "9, my calf is swollen and hot", painScore: 9 }),
      }),
    );
    expect(d.replies.length).toBe(2);
    expect(bodies(d)[0]).toMatch(/flagged this to your physiotherapist|10177/);
    expect(d.next.state).toBe("awaiting_sleep");
  });

  it("an emergency ends the check-in and only sends the safety message", () => {
    const text = "I cannot breathe";
    const d = decide(
      ctx({
        message: msg(text),
        conversation: snap("awaiting_pain", {}, NOW),
        redFlags: runRedFlagRules({ text }),
      }),
    );
    expect(d.replies.length).toBe(1);
    expect(bodies(d)[0]).toMatch(/10177/);
    expect(d.next.state).toBe("idle");
  });

  it("an opted out patient describing an emergency still gets the safety message", () => {
    const text = "I cannot breathe";
    const d = decide(
      ctx({
        message: msg(text),
        conversation: snap("opted_out"),
        redFlags: runRedFlagRules({ text }),
      }),
    );
    expect(bodies(d)[0]).toMatch(/10177/);
    expect(d.next.state).toBe("opted_out");
  });

  it("a red flag before consent still gets the safety message", () => {
    const text = "I cannot breathe";
    const d = decide(
      ctx({
        message: msg(text),
        hasConsent: false,
        conversation: snap("new"),
        redFlags: runRedFlagRules({ text }),
      }),
    );
    expect(bodies(d)[0]).toMatch(/10177/);
  });

  it("the saved check-in is marked flagged when the last message tripped a rule", () => {
    const text = "the wound is oozing pus";
    const conv = snap("awaiting_notes", { pain: 4, sleep: 3, energy: 3, notes: [] }, NOW);
    const d = decide(
      ctx({ message: msg(text), conversation: conv, redFlags: runRedFlagRules({ text }) }),
    );
    expect(d.saveCheckin?.flagged).toBe(true);
  });
});

describe("reading pain from a sentence", () => {
  const read = (t: string) =>
    decide(ctx({ message: msg(t), conversation: snap("awaiting_pain", { notes: [] }, NOW) })).next
      .draft.pain;
  it("reads one plausible number", () => {
    expect(read("about a 5, stiff after sitting")).toBe(5);
    expect(read("9, my calf is sore")).toBe(9);
    expect(read("maybe 3/10 today")).toBe(3);
  });
  it("does not guess when there is a unit or more than one number", () => {
    expect(read("slept 7 hours")).toBeUndefined();
    expect(read("between 4 and 6")).toBeUndefined();
    expect(read("did 12 reps")).toBeUndefined();
    expect(read("it's like 15")).toBeUndefined();
  });
});

describe("wearable offer", () => {
  const done = snap("awaiting_notes", { pain: 3, sleep: 4, energy: 4, notes: [] }, NOW);
  it("is not offered to someone who already has a wearable, or was already asked", () => {
    for (const extra of [{ hasWearable: true }, { wearableOffered: true }]) {
      const d = decide(
        ctx({ message: msg("Nothing", IDS.notesNone), conversation: done, ...extra }),
      );
      expect(bodies(d)).toEqual([MSG.saved]);
      expect(d.next.state).toBe("idle");
    }
  });
  it("Yes sends the same link the app's Connect button uses", () => {
    const d = decide(
      ctx({
        message: msg("Yes, connect it", IDS.wearableYes),
        conversation: snap("awaiting_wearable", {}, NOW),
      }),
    );
    expect(bodies(d)[0]).toContain(WEARABLE_CONNECT_URL);
    expect(d.next.state).toBe("idle");
  });
  it("Not now is accepted and tells them how to ask later", () => {
    const d = decide(
      ctx({
        message: msg("Not now", IDS.wearableNo),
        conversation: snap("awaiting_wearable", {}, NOW),
      }),
    );
    expect(bodies(d)).toEqual([MSG.wearableDeclined]);
  });
  it("anything else drops the offer and is handled normally", () => {
    const d = decide(
      ctx({
        message: msg("hi"),
        conversation: snap("awaiting_wearable", {}, NOW),
        checkedInToday: true,
      }),
    );
    expect(d.replies[0].kind).toBe("list");
  });
  it("WATCH or 'connect my garmin' sends the link any time", () => {
    for (const t of ["WATCH", "can I connect my garmin?"]) {
      const d = decide(ctx({ message: msg(t), checkedInToday: true }));
      expect(bodies(d)[0]).toContain(WEARABLE_CONNECT_URL);
    }
  });
});

describe("check-in time", () => {
  it("reads common ways of asking", () => {
    expect(readReminderTime("remind me at 7am")).toBe("07:00");
    expect(readReminderTime("Can you check in at 18:30 please")).toBe("18:30");
    expect(readReminderTime("change my check-in time to 6pm")).toBe("18:00");
    expect(readReminderTime("message me at 12am")).toBe("00:00");
    expect(readReminderTime("remind me at 25")).toBeNull();
    expect(readReminderTime("my knee hurts at 7")).toBeNull();
  });
  it("sets it without disturbing a check-in in progress", () => {
    const conv = snap("awaiting_sleep", { pain: 3 }, NOW);
    const d = decide(ctx({ message: msg("remind me at 7am"), conversation: conv }));
    expect(d.setReminderTime).toBe("07:00");
    expect(d.next).toEqual(conv);
  });
  it("is not read out of a note", () => {
    const conv = snap("awaiting_notes", { pain: 3, sleep: 3, energy: 3, notes: [] }, NOW);
    const d = decide(
      ctx({ message: msg("I need a check in at the hospital at 3"), conversation: conv }),
    );
    expect(d.setReminderTime).toBeUndefined();
    expect(d.saveCheckin).toBeTruthy();
  });
});

describe("AI fallback and voice notes", () => {
  it("uses the AI reading only when the plain reader found nothing", () => {
    const conv = snap("awaiting_pain", { notes: [] }, NOW);
    expect(
      decide(
        ctx({
          message: msg("much better, barely notice it"),
          conversation: conv,
          assist: { painScore: 1 },
        }),
      ).next.draft.pain,
    ).toBe(1);
    expect(
      decide(ctx({ message: msg("6"), conversation: conv, assist: { painScore: 1 } })).next.draft
        .pain,
    ).toBe(6);
  });
  it("a voice note that could not be read asks them to type", () => {
    const d = decide(ctx({ message: { text: "", kind: "media", mediaType: "audio" } }));
    expect(bodies(d)).toEqual([MSG.voiceUnreadable]);
  });
});

describe("pain answers in everyday words", () => {
  it.each([
    ["3 out of 10", 3],
    ["about 4 out of 10", 4],
    ["six", 6],
    ["about a seven today", 7],
    ["ses", 6],
  ])("%s", async (text, n) => {
    const { readPain } = await import("./conversation");
    expect(readPain({ text, kind: "text" })).toBe(n);
  });
  it("does not guess when two numbers are given", async () => {
    const { readPain } = await import("./conversation");
    expect(readPain({ text: "one or two", kind: "text" })).toBeNull();
  });
});
