/**
 * What Buddy does with a message that is not an answer to a check-in question.
 *
 * Settled by Justin on 5 October:
 *  - Practice questions are answered ONLY from PRACTICE_INFO below. Anything
 *    not in it: send the practice's WhatsApp link rather than guess.
 *  - Bookings go to the practice's WhatsApp, to keep them on WhatsApp, and to
 *    the online booking page.
 *  - Clinical questions are never answered. Buddy says it is not medically
 *    equipped to answer, that Justin (practice manager) has been notified and
 *    will answer shortly, and Justin is alerted.
 *  - "Log a change" records a new pain score and what changed, as an update
 *    alongside today's check-in.
 *
 * This file is pure: the intent comes either from the AI router (worker, AI
 * consent only) or from `routeByKeywords` here, which is the fallback and the
 * whole of it for patients without AI consent.
 */

export type AssistIntent =
  | "capabilities"
  | "log_change"
  | "booking"
  | "practice_info"
  | "clinical_question"
  | "progress"
  | "exercises"
  | "greeting"
  | "other";

export const ASSIST_INTENTS: readonly AssistIntent[] = [
  "capabilities",
  "log_change",
  "booking",
  "practice_info",
  "clinical_question",
  "progress",
  "exercises",
  "greeting",
  "other",
];

export interface AssistRoute {
  intent: AssistIntent;
  /** For practice_info: an answer drawn only from PRACTICE_INFO, or null. */
  answer?: string | null;
}

export const PRACTICE_WHATSAPP = "+27 67 369 0593";
export const PRACTICE_WHATSAPP_LINK = "https://wa.me/27673690593";
export const BOOKING_URL = "https://www.peakmovement.co.za/book-online";
export const LIBRARY_URL = "https://peakbuddy.lovable.app/client/app/library";

/**
 * The only facts Buddy may state about the practice. Checked against the
 * website and Wix Bookings on 5 October 2026. Change here, nowhere else.
 */
export const PRACTICE_INFO = `Peak Movement, physiotherapy and high-performance practice.
Address: 94 Strand Street (The Barracks building), Cape Town CBD.
Hours: from 08:30, last booking at 17:00, Monday to Friday. Closed Saturdays, Sundays and public holidays.
Parking: on-street parking outside.
Services: physiotherapy, biokinetics, massage therapy, shockwave, dry needling and red light therapy.
Fees: physiotherapy initial consultation R900 (1 hour). Physiotherapy follow-up appointment R750 (45 minutes). Other services: ask the practice.
Medical aid: Peak Movement does not bill medical aids directly. You pay the practice, and the practice gives you an invoice to submit to your medical aid yourself for a refund. The practice is registered with all the medical aids.
Booking: online at ${BOOKING_URL}, or on WhatsApp at ${PRACTICE_WHATSAPP} (${PRACTICE_WHATSAPP_LINK}).
Contact: WhatsApp or phone ${PRACTICE_WHATSAPP}.`;

const PRACTICE_CHAT = `You can chat to the practice directly on WhatsApp here: ${PRACTICE_WHATSAPP_LINK}`;

export const ASSIST_MSG = {
  booking:
    `To book, message the practice on WhatsApp and they'll find you a time: ${PRACTICE_WHATSAPP_LINK}\n\n` +
    `Or book online: ${BOOKING_URL}\n\nWe're open from 08:30, last booking at 17:00, Monday to Friday.`,
  practiceUnknown: `I don't have that information, sorry. ${PRACTICE_CHAT}`,
  clinical:
    "I'm not medically equipped to answer that question, but Justin, our practice manager, has been notified and will answer you shortly.",
  changeAskPain:
    "Of course. What's your pain right now? Reply with a number from 0 (no pain) to 10 (worst pain imaginable).",
  changeAskWhat: "And what's changed? Tell me in your own words.",
  changeSaved:
    "Got it, I've logged that change on your Buddy profile and your physiotherapist can see it.",
  exercises: `Your exercise programme is in the Buddy app under Library: ${LIBRARY_URL}\n\nIf you're not sure about an exercise, ${PRACTICE_CHAT.charAt(0).toLowerCase()}${PRACTICE_CHAT.slice(1)}`,
  checkinNudge: "Whenever you're ready for today's check-in, just reply CHECK IN.",
  progressNone:
    "I don't have enough check-ins yet to show a trend. Keep checking in and I'll be able to tell you how you're going.",
  capabilities:
    "I'm Buddy, Peak Movement's recovery assistant. Here's what I can help with:\n\n" +
    "• *Daily check-in*: reply CHECK IN\n" +
    "• *Update a symptom or pain score*: say \"log a change\"\n" +
    "• *Your progress*: ask \"how is my progress?\"\n" +
    "• *Your exercises*: ask \"send my exercises\"\n" +
    "• *Book an appointment*: say \"book\"\n" +
    "• *Clinic info*: hours, address, fees, medical aid\n" +
    "• *Connect a smartwatch*: reply WATCH\n\n" +
    "Anything else you type goes to your physiotherapist as a note. I can't give medical advice, and in an emergency phone 10177 or 112.",
  clarify:
    "I want to make sure I get this right. Would you like to *log a change* to today's check-in, *book* an appointment, ask about the *clinic*, or leave this as a *note* for your physiotherapist? Reply HELP to see everything I can do.",
} as const;

/** "check in", "checkin", "start check-in". */
export const CHECKIN_REQUEST = /^(?:start\s+)?(?:my\s+)?check[\s-]?in[.!]*$/i;

const has = (t: string, words: RegExp) => words.test(t);

/**
 * Keyword fallback. Deliberately conservative: anything it is not sure of is
 * "other", which keeps today's behaviour (start a check-in, or pass a note to
 * the practitioner).
 */
export function routeByKeywords(text: string): AssistRoute {
  const t = text.toLowerCase().trim();
  if (!t) return { intent: "other" };
  if (
    /^(hi|hello|hey|hallo|howzit|good (morning|afternoon|evening)|thanks|thank you|dankie|ok|okay|cool|great)[.!]*$/.test(
      t,
    )
  ) {
    return { intent: "greeting" };
  }
  if (
    has(
      t,
      /\b(what can you do|what do you do|who are you|what are you|how does (this|it|buddy) work|how do (i|you) use|help|menu|options|commands)\b/,
    ) &&
    t.length < 80
  ) {
    return { intent: "capabilities" };
  }
  if (
    has(
      t,
      /\b(log|record|update|change|add|edit|fix|correct)\b.{0,25}\b(change|update|symptoms?|pain|score|check[\s-]?in|entry|answer)\b|\b(feeling|got|getting) (worse|better)\b|\b(made a mistake|wrong (number|score|answer))\b|\bpain (is|has) (gone )?(up|down|worse|better)\b/,
    )
  ) {
    return { intent: "log_change" };
  }
  if (
    has(
      t,
      /\b(book|booking|appointment|appt|check[\s-]?up|reschedule|cancel|slot|available|availability|see (justin|someone|a physio|the physio))\b/,
    )
  ) {
    return { intent: "booking" };
  }
  if (
    has(t, /\b(how (has|have|is) my|my progress|progress|trend|this week|last week)\b/) &&
    has(t, /\b(pain|progress|doing|going|trend|scores?)\b/)
  ) {
    return { intent: "progress" };
  }
  if (
    has(
      t,
      /\b(what|send|show|where|remind|forgot|lost|need)\b.{0,30}\b(exercises?|programme|program|routine|homework|stretches|oefeninge?)\b/,
    ) &&
    !has(t, /\b(hurt|hurts|pain|sore|click|should i)\b/)
  ) {
    return { intent: "exercises" };
  }
  if (
    has(
      t,
      /\b(price|prices|cost|costs|fee|fees|how much|medical aid|medical-aid|discovery|bonitas|gems|polmed|invoice|hours|open|close|closing|address|where are you|parking|park)\b/,
    )
  ) {
    return { intent: "practice_info" };
  }
  if (
    /\?\s*$/.test(t) &&
    has(
      t,
      /\b(should i|can i|is it (normal|ok|okay|safe)|ice|heat|stretch|run|train|gym|painkiller|anti-?inflammator|swelling|sore|pain|injur)/,
    )
  ) {
    return { intent: "clinical_question" };
  }
  return { intent: "other" };
}

/** Practice answers without AI: a fixed snippet per topic, never composed. */
export function practiceAnswerByKeywords(text: string): string | null {
  const t = text.toLowerCase();
  if (/\b(medical aid|discovery|bonitas|gems|polmed|invoice|claim)\b/.test(t)) {
    return "We don't bill medical aids directly. You pay the practice, and we give you an invoice to submit to your medical aid yourself. We're registered with all the medical aids.";
  }
  if (/\b(price|prices|cost|costs|fee|fees|how much)\b/.test(t)) {
    return (
      "A physiotherapy initial consultation is R900 (1 hour) and a follow-up is R750 (45 minutes). For other services, ask the practice: " +
      PRACTICE_WHATSAPP_LINK
    );
  }
  if (/\b(hours|open|close|closing|when are you)\b/.test(t)) {
    return "We're open from 08:30, last booking at 17:00, Monday to Friday. Closed weekends and public holidays.";
  }
  if (/\b(address|where are you|location|parking|park)\b/.test(t)) {
    return "We're at 94 Strand Street, in The Barracks building, Cape Town CBD. There's on-street parking outside.";
  }
  return null;
}

export interface CheckinPoint {
  at: string;
  pain: number | null;
}

/** "Your pain has gone from 6 to 3 over your last 5 check-ins." From their own rows only. */
export function progressSummary(points: CheckinPoint[]): string {
  const withPain = points.filter((p) => typeof p.pain === "number") as Array<{
    at: string;
    pain: number;
  }>;
  if (withPain.length < 2) return ASSIST_MSG.progressNone;
  const ordered = [...withPain].sort((a, b) => a.at.localeCompare(b.at));
  const first = ordered[0].pain;
  const last = ordered[ordered.length - 1].pain;
  const n = ordered.length;
  const avg = Math.round((ordered.reduce((s, p) => s + p.pain, 0) / n) * 10) / 10;
  const direction =
    last < first
      ? `Your pain has come down from ${first} to ${last}`
      : last > first
        ? `Your pain has gone up from ${first} to ${last}`
        : `Your pain has held steady at ${last}`;
  return `${direction} over your last ${n} check-ins, averaging ${avg} out of 10. Your physiotherapist sees the same picture.`;
}
