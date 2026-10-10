import { describe, it, expect } from "vitest";
import { looksPostOperative, runRedFlagRules } from "./red-flag-rules";

/**
 * The acceptance suite the build plan requires before any real patient is put on
 * WhatsApp: red flags in many phrasings must all be caught, and ordinary rehab
 * chatter must stay quiet.
 *
 * False negatives are the dangerous failure here. False positives are merely
 * annoying, so where a term is ambiguous the rules deliberately escalate — a
 * post-operative patient saying "calf" is worth a practitioner's glance even if
 * it turns out to be nothing.
 */

const flag = (text: string, extra = {}) => runRedFlagRules({ text, ...extra });

describe("layer 1 — must catch (clinical red flags)", () => {
  const mustCatch: Array<[string, string]> = [
    // DVT, the one the existing engine missed entirely
    ["calf pain after surgery", "My left calf is really sore today"],
    ["calf swelling", "the calf is swollen and warm to the touch"],
    ["redness and heat", "my leg is red and hot below the knee"],
    ["shiny tight skin", "the skin looks tight and shiny around the ankle"],
    ["explicit clot worry", "could this be a blood clot?"],
    ["DVT abbreviation", "the doctor mentioned DVT last time, feels like that"],
    ["Afrikaans calf", "my kuit is baie seer vandag"],
    ["Afrikaans swelling", "dit is geswel en warm"],

    // Wound infection / dehiscence
    ["wound discharge", "there is discharge coming from the wound"],
    ["pus", "I can see pus at the incision"],
    ["wound opening", "the wound has opened up a bit"],
    ["smelly wound", "the dressing smells bad today"],
    ["stitches concern", "two of the stitches have come out"],
    ["Afrikaans wound", "die wond lyk nie goed nie, daar is etter"],

    // Covered by the existing engine
    ["fever", "I have had a fever since last night"],
    ["chest pain", "I have chest pain and it is hard to breathe"],
    ["shortness of breath", "I am short of breath walking to the bathroom"],
    ["new numbness", "my foot has gone numb since yesterday"],
    ["pins and needles", "pins and needles down the whole leg"],
    ["weakness", "my leg feels weak and keeps giving way"],
    ["saddle numbness", "numbness in the saddle area"],
    ["bladder change", "I cannot control my bladder properly"],
    ["bowel change", "I have lost control of my bowel"],
    ["fall", "I had a fall in the bathroom this morning"],
    ["self harm", "I do not want to be here anymore"],
    ["Afrikaans emergency", "ek kan nie asemhaal nie"],
  ];

  for (const [name, text] of mustCatch) {
    it(`catches: ${name}`, () => {
      const r = flag(text);
      expect(r.triggered).toBe(true);
      expect(r.hits.length).toBeGreaterThan(0);
    });
  }
});

describe("layer 1 — pain rules", () => {
  it("catches pain at the absolute threshold", () => {
    const r = flag("sore today", { painScore: 8 });
    expect(r.triggered).toBe(true);
    expect(r.hits.some((h) => h.rule === "pain_absolute")).toBe(true);
  });

  it("catches pain above the threshold", () => {
    expect(flag("", { painScore: 10 }).triggered).toBe(true);
  });

  it("does not fire on pain just below the threshold", () => {
    const r = flag("a bit sore", { painScore: 7 });
    expect(r.hits.some((h) => h.rule === "pain_absolute")).toBe(false);
  });

  it("catches a rise of 3 points", () => {
    const r = flag("", { painScore: 6, previousPainScore: 3 });
    expect(r.hits.some((h) => h.rule === "pain_rise")).toBe(true);
  });

  it("catches a large rise even at a low absolute score", () => {
    const r = flag("", { painScore: 5, previousPainScore: 1 });
    expect(r.triggered).toBe(true);
  });

  it("ignores a rise of 2", () => {
    const r = flag("", { painScore: 5, previousPainScore: 3 });
    expect(r.hits.some((h) => h.rule === "pain_rise")).toBe(false);
  });

  it("ignores a falling score", () => {
    const r = flag("", { painScore: 2, previousPainScore: 7 });
    expect(r.triggered).toBe(false);
  });

  it("does not fire the rise rule without a previous score", () => {
    const r = flag("", { painScore: 6, previousPainScore: null });
    expect(r.hits.some((h) => h.rule === "pain_rise")).toBe(false);
  });
});

describe("layer 1 — post-operative fever", () => {
  it("raises a monitor fever to soon after surgery", () => {
    const plain = flag("I have had a fever since last night");
    const postOp = flag("I have had a fever since last night", { isPostOperative: true });
    expect(plain.urgency).not.toBe("soon");
    expect(postOp.urgency).toBe("soon");
    expect(postOp.hits.some((h) => h.detail === "Fever in a post-operative patient")).toBe(true);
  });

  it("leaves a high fever urgent", () => {
    const r = flag("ek het hoe koors", { isPostOperative: true });
    expect(r.urgency === "urgent" || r.urgency === "emergency").toBe(true);
  });

  it("recognises a surgical note", () => {
    expect(looksPostOperative("6 weeks after knee replacement")).toBe(true);
    expect(looksPostOperative("general knee pain")).toBe(false);
  });
});

describe("layer 1 — missed check-ins", () => {
  it("fires for a post-operative patient after three misses", () => {
    const r = flag("", { isPostOperative: true, consecutiveMissedCheckins: 3 });
    expect(r.hits.some((h) => h.rule === "missed_checkins_postop")).toBe(true);
  });

  it("does not fire at two misses", () => {
    const r = flag("", { isPostOperative: true, consecutiveMissedCheckins: 2 });
    expect(r.triggered).toBe(false);
  });

  it("does not fire for a non-post-operative patient", () => {
    const r = flag("", { isPostOperative: false, consecutiveMissedCheckins: 5 });
    expect(r.triggered).toBe(false);
  });
});

describe("layer 1 — must stay quiet (ordinary rehab chatter)", () => {
  const mustNotFire: Array<[string, string]> = [
    ["good day", "Feeling good today thanks"],
    ["exercises done", "Did all my exercises this morning, no problems"],
    ["appointment admin", "Can I move my appointment to Thursday please?"],
    ["thanks", "Thanks Yves, see you next week"],
    ["better sleep", "Slept much better last night"],
    ["gradual improvement", "Getting a little better each week I think"],
    ["walked further", "I managed 2km today with no trouble"],
    ["mild stiffness", "A bit stiff first thing in the morning but it eases"],
    ["tired", "Quite tired today but otherwise fine"],
    ["busy week", "Been a busy week at work so I missed one session"],
    ["asking about exercise", "Should I add more reps to the squats?"],
    ["positive progress", "Much happier with how the knee is moving"],
    ["weather small talk", "Lovely weather in Cape Town today"],
    ["no change", "Pretty much the same as last time"],
    ["mild ache after exercise", "Slight ache after the session yesterday, settled overnight"],
  ];

  for (const [name, text] of mustNotFire) {
    it(`stays quiet: ${name}`, () => {
      expect(flag(text).triggered).toBe(false);
    });
  }
});

describe("layer 1 — result shape", () => {
  it("reports every rule that fired, not just the worst", () => {
    const r = flag("my calf is swollen and there is pus in the wound", {
      painScore: 9,
      previousPainScore: 2,
    });
    const rules = new Set(r.hits.map((h) => h.rule));
    expect(rules.has("pain_absolute")).toBe(true);
    expect(rules.has("pain_rise")).toBe(true);
    expect(rules.has("keyword_post_surgical")).toBe(true);
    expect(r.hits.length).toBeGreaterThanOrEqual(4);
  });

  it("surfaces the highest urgency across hits", () => {
    const r = flag("I cannot breathe", { painScore: 8 });
    expect(r.urgency).toBe("emergency");
  });

  it("gives a practitioner-readable reason for every hit", () => {
    const r = flag("the wound is oozing", { painScore: 9 });
    for (const hit of r.hits) {
      expect(hit.detail.length).toBeGreaterThan(10);
    }
  });

  it("returns a clean negative for empty input", () => {
    const r = flag("");
    expect(r).toMatchObject({ triggered: false, urgency: "routine", severity: 0 });
  });
});
