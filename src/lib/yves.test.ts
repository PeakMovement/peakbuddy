import { describe, it, expect } from "vitest";
import { checkHardOverride, applyKeywordFloor, analyzeRealTime, evaluateCheckIn } from "./yves";

describe("checkHardOverride", () => {
  it("triggers on emergency phrases", () => {
    expect(checkHardOverride("I have chest pain right now").triggered).toBe(true);
    expect(checkHardOverride("worst headache of my life").triggered).toBe(true);
    expect(checkHardOverride("I want to kill myself").triggered).toBe(true);
  });

  it("returns the matched phrase", () => {
    const r = checkHardOverride("crushing chest pain since lunch");
    expect(r.phrase).toBe("chest pain");
  });

  it("does not trigger when the symptom is attributed to someone else", () => {
    expect(checkHardOverride("my friend has chest pain").triggered).toBe(false);
    expect(checkHardOverride("my mother had a stroke last year").triggered).toBe(false);
  });

  it("still triggers on negated phrasing (safety-first by design)", () => {
    // Negation is intentionally NOT applied to hard overrides — a missed
    // emergency is worse than a false alarm. The AI layer handles negation.
    expect(checkHardOverride("I don't have chest pain").triggered).toBe(true);
  });

  it("does not trigger on benign text", () => {
    expect(checkHardOverride("mild stiffness after my run").triggered).toBe(false);
    expect(checkHardOverride("").triggered).toBe(false);
  });
});

describe("applyKeywordFloor", () => {
  it("escalates urgency and severity for matched terms", () => {
    const r = applyKeywordFloor("numbness in my foot", "routine", 0);
    expect(r.escalated).toBe(true);
    expect(r.urgency).toBe("soon");
    expect(r.severity).toBeGreaterThanOrEqual(5);
    expect(r.matchedTerms).toContain("numbness");
  });

  it("never downgrades an existing higher assessment", () => {
    const r = applyKeywordFloor("numbness in my foot", "emergency", 10);
    expect(r.urgency).toBe("emergency");
    expect(r.severity).toBe(10);
    expect(r.escalated).toBe(false);
  });

  it("skips negated terms", () => {
    const r = applyKeywordFloor("there is no numbness anywhere", "routine", 0);
    expect(r.matchedTerms).not.toContain("numbness");
    expect(r.escalated).toBe(false);
  });

  it("skips attributed terms", () => {
    const r = applyKeywordFloor("my husband mentions numbness sometimes", "routine", 0);
    expect(r.matchedTerms).not.toContain("numbness");
  });

  it("accumulates multiple matched terms", () => {
    const r = applyKeywordFloor("fever and night sweats this week", "routine", 0);
    expect(r.matchedTerms).toEqual(expect.arrayContaining(["fever", "night sweats"]));
    expect(r.urgency).toBe("soon");
  });

  it("treats cauda equina indicators as emergency", () => {
    const r = applyKeywordFloor("I lost bowel control this morning", "routine", 0);
    expect(r.urgency).toBe("emergency");
    expect(r.severity).toBe(10);
  });
});

describe("analyzeRealTime", () => {
  it("returns not detected for empty input", () => {
    const r = analyzeRealTime("   ");
    expect(r.detected).toBe(false);
    expect(r.urgency).toBe("routine");
  });

  it("returns not detected for benign input", () => {
    const r = analyzeRealTime("feeling good, slept well, pain is low");
    expect(r.detected).toBe(false);
  });

  it("routes hard overrides to emergency with severity 10", () => {
    const r = analyzeRealTime("I can't breathe properly");
    expect(r.detected).toBe(true);
    expect(r.urgency).toBe("emergency");
    expect(r.severity).toBe(10);
    expect(r.source).toBe("hard_override");
  });

  it("routes keyword matches with floor urgency", () => {
    const r = analyzeRealTime("my pain is 9/10 today");
    expect(r.detected).toBe(true);
    expect(r.urgency).toBe("urgent");
    expect(r.source).toBe("keyword");
  });
});


describe("numeric pain parser", () => {
  it("parses 'out of 10' phrasing the old literal terms missed", () => {
    const r = applyKeywordFloor("my pain is 7 out of 10 today", "routine", 0);
    expect(r.severity).toBeGreaterThanOrEqual(6);
    expect(r.urgency).toBe("soon");
    expect(r.escalated).toBe(true);
  });

  it("parses 'pain is at a 9'", () => {
    const r = applyKeywordFloor("the pain is at a 9 right now", "routine", 0);
    expect(r.severity).toBeGreaterThanOrEqual(7);
    expect(r.urgency).toBe("urgent");
  });

  it("treats 10/10 as urgent severity 8", () => {
    const r = applyKeywordFloor("headache 10/10", "routine", 0);
    expect(r.urgency).toBe("urgent");
    expect(r.severity).toBeGreaterThanOrEqual(8);
  });

  it("realtime detects a numeric-only rating", () => {
    const r = analyzeRealTime("pain is 8 out of 10");
    expect(r.detected).toBe(true);
    expect(r.urgency).toBe("soon");
  });
});

describe("severity / onset modifiers", () => {
  it("boosts a matched symptom when described as crushing", () => {
    const base = applyKeywordFloor("radiating pain in my back", "routine", 0);
    const boosted = applyKeywordFloor("crushing radiating pain in my back", "routine", 0);
    expect(boosted.severity).toBeGreaterThan(base.severity);
  });

  it("does not fabricate severity from a modifier with no symptom", () => {
    const r = applyKeywordFloor("it came on suddenly and then i felt fine", "routine", 0);
    expect(r.escalated).toBe(false);
    expect(r.severity).toBe(0);
  });
});

describe("category clustering", () => {
  it("escalates when multiple cardiac terms co-occur", () => {
    const r = applyKeywordFloor("chest tightness with palpitations and jaw pain", "routine", 0);
    expect(r.urgency).toBe("urgent");
    expect(r.severity).toBeGreaterThanOrEqual(8);
    expect(r.topCategory).toBe("cardiac");
  });

  it("does not push clustering to emergency (reserved for hard overrides)", () => {
    const r = applyKeywordFloor("chest tightness with palpitations and jaw pain", "routine", 0);
    expect(r.urgency).not.toBe("emergency");
  });
});

describe("refined attribution guard", () => {
  it("still discards a symptom attributed to someone else", () => {
    const r = applyKeywordFloor("my brother gets palpitations", "routine", 0);
    expect(r.matchedTerms).not.toContain("palpitations");
  });

  it("keeps the symptom when the patient reclaims it with a self-pronoun", () => {
    const r = applyKeywordFloor("my brother is fine but i have palpitations", "routine", 0);
    expect(r.matchedTerms).toContain("palpitations");
  });
});

describe("merged vocabulary", () => {
  it("detects named MSK injuries the old floor lacked", () => {
    const r = applyKeywordFloor("physio thinks it is a meniscus tear", "routine", 0);
    expect(r.matchedTerms).toContain("meniscus tear");
    expect(r.topCategory).toBe("msk_alarm");
  });

  it("treats high fever as urgent", () => {
    const r = applyKeywordFloor("high fever since last night", "routine", 0);
    expect(r.urgency).toBe("urgent");
    expect(r.severity).toBeGreaterThanOrEqual(7);
  });

  it("does not double-count 'fever' when 'high fever' matched", () => {
    const r = applyKeywordFloor("high fever since last night", "routine", 0);
    // "fever" substring is dropped, so no spurious infection cluster bonus.
    expect(r.severity).toBeLessThanOrEqual(8);
  });
});

describe("evaluateCheckIn (shared check-in triage)", () => {
  it("flags high pain as urgent", () => {
    const r = evaluateCheckIn(8, "");
    expect(r.flagged).toBe(true);
    expect(r.urgency).toBe("urgent");
  });

  it("never downgrades an emergency note to urgent", () => {
    const r = evaluateCheckIn(3, "chest pain since this morning");
    expect(r.flagged).toBe(true);
    expect(r.urgency).toBe("emergency");
  });

  it("leaves a benign check-in unflagged", () => {
    const r = evaluateCheckIn(3, "feeling good, slept well");
    expect(r.flagged).toBe(false);
    expect(r.urgency).toBe("routine");
  });

  it("only flags notes at severity >= 6", () => {
    // "numbness" alone scores 5 — below the notes-flag threshold.
    expect(evaluateCheckIn(2, "numbness in my foot").flagged).toBe(false);
    // "burning down my leg" scores 7 — flags.
    expect(evaluateCheckIn(4, "burning pain down my leg").flagged).toBe(true);
  });
});

describe("Afrikaans / SA red-flag coverage", () => {
  it("treats Afrikaans emergencies as hard overrides", () => {
    expect(checkHardOverride("ek dink ek het n hartaanval").triggered).toBe(true);
    expect(checkHardOverride("ek het n beroerte gehad").triggered).toBe(true);
    expect(checkHardOverride("ek kan nie asemhaal nie").triggered).toBe(true);
    expect(checkHardOverride("ek dink aan selfmoord").triggered).toBe(true);
  });

  it("escalates Afrikaans floor terms", () => {
    const r = applyKeywordFloor("brandende pyn in my been", "routine", 0);
    expect(r.matchedTerms).toContain("brandende pyn");
    expect(r.urgency).toBe("soon");
  });

  it("clusters Afrikaans infection signs without double-counting koors", () => {
    const r = applyKeywordFloor("ek het hoe koors en n stywe nek", "routine", 0);
    expect(r.urgency).toBe("urgent");
    expect(r.severity).toBeGreaterThanOrEqual(7);
    expect(r.matchedTerms).not.toContain("koors"); // dropped in favour of "hoe koors"
  });

  it("routes an Afrikaans emergency through evaluateCheckIn", () => {
    expect(evaluateCheckIn(3, "ek kan nie asemhaal nie").urgency).toBe("emergency");
  });
});
