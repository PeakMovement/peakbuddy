import { describe, expect, it } from "vitest";
import { decide, type ConversationSnapshot, type DecisionContext } from "./conversation";
import {
  ONBOARD_MSG,
  chatToBuddyLink,
  consentPageUrl,
  looksLikeEmail,
  matchPractitioner,
  newInviteCode,
  parseJoinCode,
  readName,
  stripJoinCode,
} from "./onboarding";
import { runRedFlagRules } from "./red-flag-rules";

// Synthetic only. No real patient words or names anywhere in this file.
const NOW = new Date("2026-10-05T08:00:00Z");
const PRACS = [
  { id: "p1", name: "Alex Testerson" },
  { id: "p2", name: "Sam Example" },
];
const SIGNUP = {
  practiceId: "practice-1",
  practiceName: "Test Practice",
  practitioners: PRACS,
  fallback: PRACS[0],
};

const snap = (state: ConversationSnapshot["state"], draft = {}): ConversationSnapshot => ({
  state,
  draft,
  checkinStartedAt: null,
});

function ctx(text: string, over: Partial<DecisionContext> = {}, replyId?: string): DecisionContext {
  return {
    message: { text, replyId, kind: replyId ? "interactive" : "text" },
    conversation: snap("new"),
    client: null,
    hasConsent: false,
    checkedInToday: false,
    redFlags: runRedFlagRules({ text }),
    now: NOW,
    ...over,
  };
}

const bodies = (d: ReturnType<typeof decide>) =>
  d.replies.map((r) => ("body" in r ? r.body : "")).join("\n");

describe("join codes and links", () => {
  it("makes 6 character codes without look-alike characters", () => {
    for (let i = 0; i < 50; i += 1) expect(newInviteCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it("reads the code however it's typed and strips it from the text", () => {
    expect(parseJoinCode("Hi Buddy (JOIN-ab23cd)")).toBe("AB23CD");
    expect(parseJoinCode("join - ab23cd")).toBe("AB23CD");
    expect(parseJoinCode("Hi Buddy, I'd like to join (JOIN-PEAK)")).toBe("PEAK");
    expect(parseJoinCode("I want to join")).toBeNull();
    expect(parseJoinCode("I'd like to join your practice")).toBeNull();
    expect(parseJoinCode("join today")).toBeNull();
    expect(stripJoinCode("Hi Buddy, I'd like to start (JOIN-AB23CD)")).toBe(
      "Hi Buddy, I'd like to start",
    );
  });

  it("round trips: the prefilled message carries a code the parser finds", () => {
    const link = chatToBuddyLink("AB23CD", "client");
    expect(link.startsWith("https://wa.me/27675724314?text=")).toBe(true);
    const text = decodeURIComponent(link.split("text=")[1]);
    expect(parseJoinCode(text)).toBe("AB23CD");
    expect(consentPageUrl("tok_en")).toContain("/consent?t=tok_en");
  });

  it("reads names, emails and practitioners sensibly", () => {
    expect(readName("my name is test person")).toBe("Test Person");
    expect(readName("123")).toBeNull();
    expect(looksLikeEmail(" Someone@Example.com ")).toBe("someone@example.com");
    expect(looksLikeEmail("not an email")).toBeNull();
    expect(matchPractitioner("I see Dr Testerson", PRACS)?.id).toBe("p1");
    expect(matchPractitioner("no idea", PRACS)).toBeNull();
  });
});

describe("self sign-up from a practice link", () => {
  it("welcomes, asks name, then practitioner, then creates the profile", () => {
    const d1 = decide(ctx("Hi Buddy, I'm a patient", { signup: SIGNUP }));
    expect(bodies(d1)).toContain("Test Practice");
    expect(d1.next.state).toBe("awaiting_name");

    const d2 = decide(ctx("Test Person", { signup: SIGNUP, conversation: d1.next }));
    expect(d2.next.state).toBe("awaiting_practitioner");
    expect(d2.next.draft.signupName).toBe("Test Person");

    const d3 = decide(ctx("Sam Example", { signup: SIGNUP, conversation: d2.next }, "prac_p2"));
    expect(d3.createClient).toEqual({
      fullName: "Test Person",
      practitionerId: "p2",
      practiceId: "practice-1",
    });
  });

  it("sends 'not sure' to the practice owner and re-asks on no match", () => {
    const at = snap("awaiting_practitioner", { signupName: "Test Person" });
    const unsure = decide(ctx("Not sure", { signup: SIGNUP, conversation: at }, "prac_unsure"));
    expect(unsure.createClient?.practitionerId).toBe("p1");
    const miss = decide(ctx("someone else", { signup: SIGNUP, conversation: at }));
    expect(miss.createClient).toBeUndefined();
    expect(miss.next.state).toBe("awaiting_practitioner");
  });

  it("never creates a profile from a bad code", () => {
    const d = decide(ctx("JOIN-ZZZZZZ", { inviteInvalid: true }));
    expect(bodies(d)).toBe(ONBOARD_MSG.inviteInvalid);
    expect(d.createClient).toBeUndefined();
  });
});

describe("consent gate for existing profiles", () => {
  const url = "https://example.test/consent?t=x";

  it("sends the consent link instead of starting a check-in", () => {
    const d = decide(ctx("hi", { client: { firstName: "Test" }, consentUrl: url }));
    expect(bodies(d)).toContain(url);
    expect(d.next.state).toBe("awaiting_consent");
    expect(d.saveCheckin).toBeUndefined();
  });

  it("reminds rather than repeats the full message while waiting", () => {
    const d = decide(
      ctx("ok", {
        client: { firstName: "Test" },
        consentUrl: url,
        conversation: snap("awaiting_consent"),
      }),
    );
    expect(bodies(d)).toContain(ONBOARD_MSG.consentReminder(url).split("\n")[0]);
  });
});
