/**
 * Reading a practitioner's "tell Nicola well done on her race" or "can you
 * tell her I love her" and turning it into the message the client sees.
 * Pure text, no database. patient-questions.server.ts does the sending and
 * the client's reply comes back the same way as an answer to a question.
 *
 * Returns the words after the verb ("Nicola well done on her race"); the
 * mode handler knows the client list and strips the name off the front.
 */

const LEAD = String.raw`^\s*(?:(?:hi|hey|hello|ok|okay)\s+buddy[\s,!.]*)?(?:(?:can\s+you|could\s+you|would\s+you|will\s+you|please|pls|plz|buddy|hey|and|also|then)[\s,]+)*`;

const PRONOUN = String.raw`(?:her|him|them|she|he|they)`;

/** "let Nicola know (that) ...": the name is fenced by "know". */
const LET_KNOW = new RegExp(LEAD + String.raw`let\s+(.+?)\s+know\s+(?:that\s+)?([\s\S]+)$`, "i");
/** "message Nicola saying ...", "send Nicola a message: ...", "text her and say ..." */
const SAYING = new RegExp(
  LEAD +
    String.raw`(?:message|text|whatsapp|send|drop|write(?:\s+to)?)\s+(.+?)\s+(?:a\s+(?:quick\s+)?(?:message|msg|note|text)\s*)?(?:saying|that\s+says|to\s+say|and\s+say|and\s+tell\s+${PRONOUN}|:|-)\s*(?:that\s+)?([\s\S]+)$`,
  "i",
);
/** "pass on to Nicola that ...", "pass this on to her: ..." */
const PASS_ON = new RegExp(
  LEAD + String.raw`pass\s+(?:(?:this|that|it)\s+)?on\s+to\s+(.+?)(?:\s*:\s*|\s+that\s+)([\s\S]+)$`,
  "i",
);
/** "tell Nicola ...", "tell her I love her", "say to Sam ...", "say hi to Sam" */
const TELL = new RegExp(LEAD + String.raw`(?:tell|say\s+to|wish)\s+([\s\S]+)$`, "i");
const SAY_HI = new RegExp(
  LEAD +
    String.raw`say\s+((?:hi|hello|hey|thanks|thank\s+you|well\s+done|congrats|congratulations|good\s+luck|happy\s+birthday)\b[^]*?)\s+to\s+(.+?)[\s?.!]*$`,
  "i",
);

const NOT_A_CLIENT =
  /^(?:the\s+)?(?:me|us|you|yourself|buddy|reception|receptionist|front\s+desk|secretary|admin|office|mishqah|everyone|everybody|all\s+(?:my\s+)?(?:clients|patients))\b/i;

export interface PatientMessageRequest {
  /** Who it's for, as typed ("Nicola", "her", "Nicola Stockdale"), or null when not fenced. */
  who: string | null;
  /** Everything after the verb when the name isn't fenced off ("Nicola well done"). */
  rest: string;
  /** The client is named by a pronoun ("her"): use the client in context. */
  pronoun: boolean;
}

function tidy(s: string): string {
  return s
    .replace(/[\s,]*(?:for\s+me|please|thanks?|thank\s+you)[\s?.!]*$/i, "")
    .replace(/[\s?]+$/, "")
    .trim();
}

/** A request to pass a message to a client, or null. */
export function readPatientMessage(text: string): PatientMessageRequest | null {
  const t = String(text ?? "").trim();
  if (!t || t.length > 1200) return null;
  // Programmes, check-ins and "how is X" have their own commands.
  if (/\bprogram+e?s?\b|\bexercises?\b|\brehab\s+plan\b/i.test(t)) return null;

  let who: string | null = null;
  let body = "";
  let rest = "";
  const hi = t.match(SAY_HI);
  const fenced = t.match(LET_KNOW) ?? t.match(SAYING) ?? t.match(PASS_ON);
  if (hi) {
    who = hi[2].trim();
    body = hi[1];
  } else if (fenced) {
    who = fenced[1].trim();
    body = fenced[2];
  } else {
    const m = t.match(TELL);
    if (!m) return null;
    rest = m[1].trim();
    const first = rest.split(/\s+/)[0] ?? "";
    if (new RegExp(`^${PRONOUN}$`, "i").test(first)) {
      who = first;
      body = rest.slice(first.length);
    }
  }
  if (who != null) {
    if (NOT_A_CLIENT.test(who) || who.split(/\s+/).length > 4) return null;
    body = tidy(body);
    if (!body) return null;
    if (isOtherCommand(body)) return null;
    return {
      who,
      rest: `${who} ${body}`,
      pronoun: new RegExp(`^${PRONOUN}$`, "i").test(who),
    };
  }
  rest = tidy(rest);
  if (!rest || NOT_A_CLIENT.test(rest)) return null;
  // "tell Sam to check in" / "tell me how Sam is" are other commands.
  if (isOtherCommand(rest.split(/\s+/).slice(1).join(" "))) return null;
  if (rest.split(/\s+/).length < 2) return null;
  return { who: null, rest, pronoun: false };
}

function isOtherCommand(body: string): boolean {
  const b = body.trim();
  return (
    /^(?:to\s+)?(?:do\s+)?(?:a\s+|their\s+|his\s+|her\s+)?check[\s-]?in\b/i.test(b) ||
    /^how\s+(?:\w+\s+){0,2}(?:is|'s|are|has\s+been)(?:\s+(?:doing|getting\s+on|going))?\b/i.test(
      b,
    ) ||
    /^(?:how|what)\s+(?:\w+\s+){0,2}(?:is\s+doing|'s\s+doing)/i.test(b)
  );
}

/**
 * What the client reads, from the practitioner's words about them:
 * "I love her" -> "I love you", "well done on her race" -> "Well done on your race".
 */
export function toClientMessage(words: string, swap: (s: string) => string): string {
  let s = swap(words.trim()).replace(/^(?:that|to\s+say)\s+/i, "");
  // "wish her good luck" -> "Good luck", "say thanks" -> "Thanks"
  s = s.replace(/^(?:say|says|saying)\s+/i, "");
  if (!s) return s;
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
}

/** Strip the client's name from the front of "Nicola Stockdale well done". */
export function stripLeadingName(
  rest: string,
  fullName: string,
  close: (token: string, name: string) => boolean,
): string {
  const parts = String(fullName ?? "")
    .toLowerCase()
    .split(/[^a-z'-]+/)
    .filter((w) => w.length >= 2);
  const words = rest.trim().split(/\s+/);
  let i = 0;
  while (i < words.length && i < 3) {
    const w = words[i]
      .toLowerCase()
      .replace(/[^a-z'-]/g, "")
      .replace(/'s$/, "");
    if (!w) break;
    if (parts.some((p) => p === w || (w.length >= 3 && close(w, p)))) i++;
    else break;
  }
  return words
    .slice(i)
    .join(" ")
    .replace(/^[\s,:-]+/, "");
}

/** A question gets question wording; anything else is a message. */
export function isQuestionText(text: string): boolean {
  return /\?\s*$/.test(String(text ?? ""));
}
