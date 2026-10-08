/**
 * What is this patient message FOR?
 *
 * Justin settled the scope on 4 October: Buddy's WhatsApp line asks how the
 * patient is doing, interprets the answer, and writes it to their profile. It
 * is not a conversation a practitioner joins. That leaves exactly three things
 * a patient can want:
 *
 *   1. Answer the check-in.
 *   2. Stop receiving check-ins. The agent accepts and stops, no argument,
 *      no "are you sure?", no retention attempt.
 *   3. Reach their practitioner. The agent does not connect them; it tells the
 *      practitioner someone wants to be contacted.
 *
 * SAFETY: this classifier does NOT gate the red flag rules. Those run on every
 * inbound message regardless of what intent is detected here, because "stop
 * messaging me my calf is agony" is both an opt-out and an emergency, and the
 * classifier getting it wrong must never cost the escalation.
 *
 * Opt-out is deliberately the most generous rule in the file. A missed opt-out
 * is a POPIA problem and a patient who feels ignored. A false opt-out costs one
 * patient one check-in cycle and a phone call to put right. Those are not
 * symmetrical, so the detection is not symmetrical either.
 */

export type MessageIntent = "opt_out" | "contact_practitioner" | "checkin_answer" | "unclear";

export interface IntentResult {
  intent: MessageIntent;
  /** certain = act on it without a model. likely = act, but worth logging. */
  confidence: "certain" | "likely" | "unsure";
  matched: string[];
}

/** A message that is ONLY one of these words is an opt-out, by convention. */
const BARE_STOP_WORDS = new Set([
  "stop",
  "stop.",
  "stopp",
  "unsubscribe",
  "cancel",
  "quit",
  "opt out",
  "optout",
  "opt-out",
  "remove me",
  "hou op", // Afrikaans: stop
  "stop asseblief",
  "please stop",
]);

/** Phrases that mean opt-out wherever they appear in a message. */
const OPT_OUT_PHRASES = [
  "stop messaging",
  "stop sending",
  "stop texting",
  "stop the check",
  "stop these check",
  "stop checking in",
  "stop with the check",
  "no more messages",
  "no more check",
  "dont message me",
  "don't message me",
  "do not message me",
  "dont send me",
  "don't send me",
  "take me off",
  "remove me from",
  "unsubscribe me",
  "opt me out",
  "i want to opt out",
  "i dont want these",
  "i don't want these",
  "i dont want to receive",
  "i don't want to receive",
  "please stop messaging",
  "please stop sending",
  "please stop the check",
  "moenie meer boodskappe", // Afrikaans: no more messages
  "cancel the check",
  "cancel my check",
  "cancel check",
  "pause the check",
  "pause my check",
  "pause check",
  "hou op met die boodskappe", // stop with the messages
  "ek wil nie meer boodskappe", // I don't want any more messages
  "nie meer die boodskappe", // (want) no more of the messages
];

/** Phrases that mean "I want to reach my practitioner". */
const CONTACT_PHRASES = [
  "speak to",
  "talk to",
  "call me",
  "phone me",
  "ring me",
  "contact me",
  "get hold of",
  "can someone call",
  "can someone phone",
  "need to speak",
  "want to speak",
  "need to talk",
  "want to talk",
  "book an appointment",
  "make an appointment",
  "bel my", // Afrikaans: call me
  "skakel my", // phone me
  "kan ek praat", // can I speak
  "wil praat", // want to talk
];

/** Words that confirm a contact request is about their clinician. */
const PERSON_WORDS = [
  "physio",
  "physiotherapist",
  "practitioner",
  "therapist",
  "doctor",
  "biokineticist",
  "someone",
  "anyone",
  "justin",
  "my person",
  "the practice",
  "reception",
  "fisio", // Afrikaans
  "dokter",
];

function normalise(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

function hasWord(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z'])${escaped}([^a-z']|$)`, "i").test(haystack);
}

export function classifyIntent(input: {
  text: string;
  /** A tapped button means they are answering the check-in, not writing prose. */
  replyId?: string;
}): IntentResult {
  const raw = normalise(input.text ?? "");

  // A tapped button is unambiguous and short-circuits everything.
  if (input.replyId) {
    if (input.replyId === "opt_out") {
      return { intent: "opt_out", confidence: "certain", matched: ["button:opt_out"] };
    }
    if (input.replyId === "contact_practitioner") {
      return {
        intent: "contact_practitioner",
        confidence: "certain",
        matched: ["button:contact_practitioner"],
      };
    }
    return {
      intent: "checkin_answer",
      confidence: "certain",
      matched: [`button:${input.replyId}`],
    };
  }

  if (!raw) return { intent: "unclear", confidence: "unsure", matched: [] };

  // 1. Opt-out, checked first and most generously.
  const bare = raw.replace(/[.!]+$/, "");
  if (BARE_STOP_WORDS.has(bare)) {
    return { intent: "opt_out", confidence: "certain", matched: [bare] };
  }
  const optHits = OPT_OUT_PHRASES.filter((p) => raw.includes(p));
  if (optHits.length) {
    return { intent: "opt_out", confidence: "certain", matched: optHits };
  }

  // 2. Reaching their practitioner.
  const contactHits = CONTACT_PHRASES.filter((p) => raw.includes(p));
  if (contactHits.length) {
    const personHits = PERSON_WORDS.filter((p) => hasWord(raw, p));
    // "call me" on its own is already a request to be called. "speak to" needs
    // someone to speak to, otherwise "I spoke to my sister about it" trips it.
    const selfEvident = contactHits.some((p) =>
      [
        "call me",
        "phone me",
        "ring me",
        "contact me",
        "bel my",
        "skakel my",
        "book an appointment",
        "make an appointment",
      ].includes(p),
    );
    if (selfEvident || personHits.length) {
      return {
        intent: "contact_practitioner",
        confidence: selfEvident ? "certain" : "likely",
        matched: [...contactHits, ...personHits],
      };
    }
  }

  // 3. Anything else with substance is treated as an answer to the check-in.
  //    Extraction decides what it can actually read out of it.
  return { intent: "checkin_answer", confidence: "likely", matched: [] };
}

/**
 * The reply a patient gets when they opt out. Fixed text, no model, no attempt
 * to talk them round. Justin signs this off like the safety messages.
 */
export const OPT_OUT_CONFIRMATION =
  "Done. You won't get any more check-in messages from us. Your treatment is not affected in any way, and if you change your mind just reply START. If you need your physiotherapist, phone the practice on 067 369 0593.";

/** The reply when a patient asks to reach their practitioner. */
export const CONTACT_ACKNOWLEDGEMENT =
  "Thanks, I've passed that on and someone will come back to you. If it's urgent, phone the practice on 067 369 0593. If it's an emergency, phone 10177 or 112 from any cellphone rather than waiting for us.";
