/**
 * WhatsApp reactions and quoted replies.
 * A reaction is an answer only when the emoji is one we asked them to use.
 * Anything else is ignored so a heart on an old message does not start a check in.
 */

const YES = new Set(["👍", "👍🏻", "👍🏼", "👍🏽", "👍🏾", "👍🏿", "✅", "👌"]);
const NO = new Set(["👎", "👎🏻", "👎🏼", "👎🏽", "👎🏾", "👎🏿", "❌"]);

export function reactionReplyId(emoji: string): "react_yes" | "react_no" | null {
  const e = emoji.trim();
  if (YES.has(e)) return "react_yes";
  if (NO.has(e)) return "react_no";
  return null;
}

/** Which check in question a quoted Buddy message was asking. */
export function fieldFromQuote(
  quoted: string | null | undefined,
): "pain" | "sleep" | "energy" | "stress" | "adherence" | "notes" | null {
  const t = (quoted ?? "").toLowerCase();
  if (!t) return null;
  if (/\bpain\b|0 to 10|worst pain/.test(t)) return "pain";
  if (/\bsleep\b|slept/.test(t)) return "sleep";
  if (/\benergy\b/.test(t)) return "energy";
  if (/\bstress/.test(t)) return "stress";
  if (/home exercise|programme did you|adherence/.test(t)) return "adherence";
  if (/anything else/.test(t)) return "notes";
  return null;
}
