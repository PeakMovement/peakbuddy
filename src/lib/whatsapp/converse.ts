/**
 * The conversational layer: what Buddy says when a message fits none of the
 * fixed paths.
 *
 * Justin's brief (5 Oct): when someone says something that doesn't register,
 * don't dead-end and don't be rigid. Interpret it, answer like a person would,
 * then bring it back to centre and move the conversation on from there.
 *
 * How it stays safe while being free:
 *  - The model writes the words, but it can only pick ONE action from a closed
 *    list. The code carries the action out with the same fixed content as
 *    everywhere else (links, prices, the clinical hand-off). The model never
 *    invents a link, a time slot or a price that ends up acted on.
 *  - Clinical questions are never answered. If the model picks
 *    clinical_question, or its words read like advice anyway, its text is
 *    thrown away and the fixed hand-off to Justin is sent instead.
 *  - Red flags are handled before any of this, deterministically.
 *  - Any URL the model writes that is not one of ours is removed.
 *
 * This file is pure. The model call lives in ai.server.ts.
 */

import { BOOKING_URL, LIBRARY_URL, PRACTICE_WHATSAPP_LINK } from "./assistant";

export const CONVERSE_ACTIONS = [
  "none",
  "start_checkin",
  "log_change",
  "booking",
  "practice_info",
  "clinical_question",
  "progress",
  "exercises",
  "menu",
  "note_for_practitioner",
  "connect_wearable",
  "set_checkin_time",
  "skip_question",
  "pause_checkin",
] as const;

export type ConverseAction = (typeof CONVERSE_ACTIONS)[number];

export interface ConverseResult {
  reply: string;
  action: ConverseAction;
  /** "HH:MM" for set_checkin_time. */
  time?: string | null;
}

export interface ConverseTurn {
  from: "patient" | "buddy";
  text: string;
}

const OUR_URLS = [
  PRACTICE_WHATSAPP_LINK,
  BOOKING_URL,
  LIBRARY_URL,
  "https://peakbuddy.lovable.app",
];

/**
 * Words that read as treatment advice. Deliberately broad: a false positive
 * just means the patient gets the hand-off to Justin instead of a chatty line.
 */
const ADVICE =
  /\b(ibuprofen|paracetamol|panado|nurofen|voltaren|myprodol|anti-?inflammator\w*|painkillers?|ice (it|the|your)|apply (ice|heat)|use (ice|heat)|heat pack|you should (rest|stretch|ice|avoid|take|try|keep|stop|start)|i('?d| would)? (recommend|suggest|advise)|try (stretching|resting|icing)|it'?s (probably|likely|just) (a |an )?(strain|sprain|tear|nothing|normal|fine)|sounds like (a |an )?(strain|sprain|tear|tendon|muscle)|(that'?s|it'?s|this is|that is|totally|perfectly|quite) (completely |totally |perfectly |very )?normal|nothing to worry|common after|should (settle|ease|improve|go away|get better)|will (settle|ease|go away|get better))\b/i;

export function looksLikeAdvice(text: string): boolean {
  return ADVICE.test(text);
}

/** Strip foreign links, dashes and runaway length from the model's words. */
export function sanitizeReply(text: string): string {
  let out = text
    .replace(/https?:\/\/\S+/gi, (url) => (OUR_URLS.some((u) => url.startsWith(u)) ? url : ""))
    .replace(/\s+[–—]\s+/g, ", ")
    .replace(/[–—]/g, ", ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (out.length > 700) out = `${out.slice(0, 697).replace(/\s+\S*$/, "")}...`;
  return out;
}

/**
 * Validate the model's choice. Unknown actions are refused, bad times are
 * dropped, and words that read like advice turn the action into the clinical
 * hand-off whatever the model chose.
 */
export function validConverse(
  input:
    | {
        reply?: unknown;
        action?: unknown;
        time?: unknown;
      }
    | undefined,
): ConverseResult | null {
  if (!input) return null;
  const action = input.action;
  if (typeof action !== "string" || !(CONVERSE_ACTIONS as readonly string[]).includes(action)) {
    return null;
  }
  const raw = typeof input.reply === "string" ? input.reply : "";
  if (looksLikeAdvice(raw)) return { reply: "", action: "clinical_question" };
  const reply = sanitizeReply(raw);
  const time =
    action === "set_checkin_time" &&
    typeof input.time === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)
      ? input.time
      : null;
  // A reply is needed for every action except the clinical hand-off, whose
  // words are fixed, and the menu, which has its own intro.
  if (!reply && action !== "clinical_question" && action !== "menu") return null;
  return { reply, action: action as ConverseAction, time };
}

/** Last few turns, oldest first, trimmed, as the model sees them. */
export function formatHistory(turns: ConverseTurn[], max = 8): string {
  return turns
    .slice(-max)
    .map(
      (t) =>
        `${t.from === "patient" ? "Patient" : "Buddy"}: ${t.text.replace(/\s+/g, " ").slice(0, 300)}`,
    )
    .join("\n");
}
