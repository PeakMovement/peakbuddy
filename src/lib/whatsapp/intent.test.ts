import { describe, it, expect } from "vitest";
import { classifyIntent } from "./intent";

const intentOf = (text: string, replyId?: string) => classifyIntent({ text, replyId }).intent;

describe("opt-out is caught generously", () => {
  const optOuts = [
    "STOP",
    "stop",
    "Stop.",
    "unsubscribe",
    "cancel",
    "please stop",
    "please stop messaging me",
    "stop sending me these",
    "stop the check ins",
    "stop checking in on me",
    "no more messages please",
    "I dont want these messages anymore",
    "take me off this list",
    "remove me from the check ins",
    "opt me out",
    "do not message me again",
    "hou op",
    "moenie meer boodskappe stuur nie",
    "ek wil nie meer die boodskappe he nie",
  ];
  for (const t of optOuts) {
    it(t.slice(0, 44), () => expect(intentOf(t)).toBe("opt_out"));
  }
});

describe("ordinary messages are not mistaken for opt-out", () => {
  const notOptOuts = [
    "I had to stop my exercises because of the pain",
    "the pain does not stop at night",
    "I stopped taking the tablets",
    "my knee stops me sleeping",
    "cant stop the swelling",
    "I will stop by the practice on Tuesday",
    "pain 4, stopped the bike after 10 minutes",
    "the physio said to stop if it hurts",
  ];
  for (const t of notOptOuts) {
    it(t.slice(0, 48), () => expect(intentOf(t)).not.toBe("opt_out"));
  }
});

describe("asking to reach a practitioner", () => {
  const contacts = [
    "can someone call me please",
    "please phone me",
    "call me when you can",
    "I need to speak to my physio",
    "can I talk to my physiotherapist",
    "I want to speak to someone about my knee",
    "can I get hold of my therapist",
    "I want to book an appointment",
    "bel my asseblief",
    "kan ek praat met my fisio",
  ];
  for (const t of contacts) {
    it(t.slice(0, 44), () => expect(intentOf(t)).toBe("contact_practitioner"));
  }
});

describe("ordinary messages are not mistaken for a contact request", () => {
  const notContacts = [
    "pain is 4 today",
    "I spoke to my sister about the exercises",
    "feeling better thanks",
    "did all my exercises",
    "slept badly but the knee is fine",
  ];
  for (const t of notContacts) {
    it(t.slice(0, 48), () => expect(intentOf(t)).not.toBe("contact_practitioner"));
  }
});

describe("check-in answers fall through", () => {
  for (const t of ["7", "pain 6/10 and feeling worse", "much better, did all of them", "slept well"]) {
    it(t.slice(0, 44), () => expect(intentOf(t)).toBe("checkin_answer"));
  }
  it("an empty message is unclear rather than an answer", () => {
    expect(intentOf("")).toBe("unclear");
  });
});

describe("buttons are unambiguous", () => {
  it("the opt-out button opts out", () => {
    expect(intentOf("", "opt_out")).toBe("opt_out");
  });
  it("the contact button asks for contact", () => {
    expect(intentOf("", "contact_practitioner")).toBe("contact_practitioner");
  });
  it("any other button is a check-in answer", () => {
    expect(intentOf("", "pain_7")).toBe("checkin_answer");
  });
  it("a button beats whatever prose came with it", () => {
    expect(intentOf("stop", "pain_7")).toBe("checkin_answer");
  });
});

describe("opt-out wins over a contact request in the same message", () => {
  it("stops rather than phoning back", () => {
    expect(intentOf("please stop messaging me, just call me if you need anything")).toBe("opt_out");
  });
});

describe("intent never gates safety", () => {
  it("an opt-out that is also a red flag is still classified as an opt-out here", () => {
    // The point of this test is the comment: red flag rules run separately on
    // the raw text, so this classification does not suppress the escalation.
    expect(intentOf("stop messaging me, my calf is swollen and agony")).toBe("opt_out");
  });
});
