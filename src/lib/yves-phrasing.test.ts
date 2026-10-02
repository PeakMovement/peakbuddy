import { describe, it, expect } from "vitest";
import { analyzeRealTime } from "./yves";

/**
 * Phrasing coverage for the live detection engine.
 *
 * The engine was built around textbook phrasings ("shortness of breath",
 * "loss of bladder control"). Patients do not write like that. Probing the
 * live engine on 2026-10-02 found that "I am short of breath", "I cannot
 * control my bladder", "I had a fall this morning" and, worst of all,
 * "I don't want to be here anymore" all produced no flag and no alert, and
 * that there were no terms at all for the post-surgical set: calf pain,
 * swelling, wounds, discharge, clots.
 *
 * The second block matters as much as the first. Matching is substring based,
 * so a short term fires inside an ordinary word: a bare "etter" (Afrikaans for
 * pus) raised an urgent alert on "feeling much better, thanks" until it was
 * caught here. False alarms destroy a practitioner's trust in the channel as
 * surely as misses harm patients, so every term added below has a quiet case
 * guarding it.
 */

const MUST_FLAG: Array<[string, string]> = [
  ["self-harm, indirect", "I don't want to be here anymore"],
  ["self-harm, no apostrophe", "I dont want to be here any more"],
  ["self-harm, bare noun", "suicide"],
  ["self-harm, in a sentence", "I've been thinking about suicide"],
  ["self-harm, hedged", "I might kill myself"],
  ["self-harm, want to die", "I want to die"],
  ["self-harm, wish dead", "I wish I was dead"],
  ["self-harm, burden framing", "everyone would be better off without me"],
  ["self-harm, end it", "I want to end it all"],
  ["self-harm, not living like this", "I don't want to live like this"],
  ["self-harm, Afrikaans", "ek wil doodgaan"],

  ["respiratory, first person", "I am short of breath"],
  ["respiratory, on exertion", "short of breath walking to the car"],
  ["respiratory, struggling", "struggling to breathe since yesterday"],
  ["respiratory, catch breath", "I cant catch my breath"],
  ["respiratory, gasping", "gasping for air on the stairs"],

  ["cauda equina, cannot bladder", "I cannot control my bladder"],
  ["cauda equina, cannot bowels", "I cannot control my bowels"],
  ["cauda equina, incontinence", "I have been wetting myself"],
  ["cauda equina, saddle numbness", "numb in my groin"],
  ["cauda equina, retention", "I cannot urinate since this morning"],

  ["DVT, calf pain", "my calf pain is bad today"],
  ["DVT, pain in calf", "pain in my calf since yesterday"],
  ["DVT, swollen calf", "my calf is swollen"],
  ["DVT, swollen and warm", "swollen calf and it is warm"],
  ["DVT, named", "worried about a blood clot"],
  ["DVT, red and hot", "the back of my leg is red and hot"],
  ["DVT, asymmetry", "one leg is bigger than the other"],

  ["wound, red", "my wound is red around the edges"],
  ["wound, pus", "there is pus coming from it"],
  ["wound, dehiscence", "the wound has opened"],
  ["wound, incision red", "my incision is red"],
  ["wound, odour", "the wound smells bad"],
  ["wound, discharge", "discharge from my wound"],
  ["wound, oozing", "oozing from the site"],
  ["wound, stitches", "my stitches came out"],

  ["neuro, weakness first person", "weakness in my leg"],
  ["neuro, leg weak", "my leg is weak today"],
  ["msk, giving way", "my knee gave way on the stairs"],
  ["msk, giving way generic", "it keeps giving way"],
  ["neuro, foot drop", "I have foot drop"],
  ["fall, had a fall", "I had a fall this morning"],
  ["fall, fell in", "I fell in the bathroom"],
  ["fall, fell down", "I fell down the step"],
];

/**
 * Ordinary rehab messages. Each one guards a specific term above: "push ups"
 * guards "pus", "wonderful" guards the Afrikaans "wond", "better" guards
 * "etter", "I fell asleep" guards "i fell", "recommend it all" guards
 * "end it all".
 */
const MUST_STAY_QUIET: string[] = [
  "Pain is 3 today, did all my exercises",
  "Feeling much better, thanks",
  "Feeling a lot better this week",
  "I am sleeping better now",
  "Slept well, knee a bit stiff in the morning",
  "Did the bike for 20 minutes, no issues",
  "A bit sore after the session yesterday but fine",
  "Can we move my appointment to Thursday?",
  "The exercises are getting easier",
  "Still some tightness in the hamstring after running",
  "Pain 4/10, mostly in the morning",
  "I managed the full walk today",
  "My shoulder is stiff but no pain",
  "Doing the band work twice a day as you said",
  "I hurt myself at the gym last week before I started here",
  "Thanks, see you Tuesday",
  "Swelling has gone down a lot since last week",
  "The ice helps",
  "No pain at all today",
  "Did some walking and some of the exercises",
  "My calf feels a bit tight after the calf raises",
  "Did 3 sets of push ups",
  "Doing pushups and the band work",
  "You have been wonderful, thank you",
  "I fell asleep on the couch after the session",
  "I would recommend it all day long",
  "Got your letter, thanks",
  // Negation. These only stay quiet because the breathing phrasings live in the
  // keyword floor, which checks for negation. As hard overrides they would have
  // fired an emergency.
  "I am not short of breath at all",
  "no shortness of breath today",
  "no difficulty breathing at all",
];

describe("phrasings a patient actually uses are detected", () => {
  for (const [label, text] of MUST_FLAG) {
    it(label, () => {
      expect(analyzeRealTime(text).detected).toBe(true);
    });
  }
});

describe("ordinary rehab messages stay quiet", () => {
  for (const text of MUST_STAY_QUIET) {
    it(text.slice(0, 48), () => {
      expect(analyzeRealTime(text).detected).toBe(false);
    });
  }
});

describe("the most urgent categories route correctly", () => {
  it("self-harm is an emergency", () => {
    const r = analyzeRealTime("I don't want to be here anymore");
    expect(r.urgency).toBe("emergency");
    expect(r.category).toBe("mental_health");
  });

  it("bladder loss routes to cauda equina", () => {
    expect(analyzeRealTime("I cannot control my bladder").category).toBe("cauda_equina");
  });

  it("wound signs route to infection", () => {
    expect(analyzeRealTime("there is pus coming from it").category).toBe("infection");
  });

  it("a fall escalates but is not an emergency on its own", () => {
    const r = analyzeRealTime("I had a fall this morning");
    expect(r.detected).toBe(true);
    expect(r.urgency).toBe("urgent");
  });
});

/**
 * Calibration. The same symptom must not get two different responses depending
 * on how the patient happened to type it. "shortness of breath" has always been
 * an urgent/7 keyword, so every first-person phrasing of it is urgent too, and
 * all of them sit in the keyword floor where negation is checked. Acute
 * inability to breathe is a different thing and stays an emergency.
 */
describe("breathlessness is urgent, not an emergency", () => {
  const phrasings = [
    "shortness of breath on exertion",
    "I am short of breath",
    "struggling to breathe since yesterday",
    "I cant catch my breath",
    "gasping for air on the stairs",
    "ek sukkel om asem te haal",
    "difficulty breathing when I walk",
    "ek is kortasem na die trappe",
  ];
  for (const text of phrasings) {
    it(text.slice(0, 44), () => {
      const r = analyzeRealTime(text);
      expect(r.detected).toBe(true);
      expect(r.urgency).toBe("urgent");
      expect(r.source).toBe("keyword");
    });
  }
});

describe("acute inability to breathe stays an emergency", () => {
  for (const text of ["I cannot breathe properly", "my throat is closing up", "I stopped breathing for a moment"]) {
    it(text.slice(0, 44), () => {
      const r = analyzeRealTime(text);
      expect(r.urgency).toBe("emergency");
      expect(r.source).toBe("hard_override");
    });
  }
});
