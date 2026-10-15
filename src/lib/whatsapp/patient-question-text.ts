/**
 * Reading a practitioner's "ask Tayla when her events are" and turning it
 * into the question the patient sees. Pure text, no database, so the intent
 * reader can use it without import cycles. See patient-questions.server.ts.
 */

const LEAD = String.raw`^\s*(?:(?:hi|hey|hello|ok|okay)\s+buddy[\s,!.]*)?(?:(?:can\s+you|could\s+you|would\s+you|will\s+you|please|pls|plz|buddy|hey)[\s,]+)*`;
const Q_WORD = String.raw`(?:when|what|whether|if|how|where|which|why|who|whose|about|is|are|does|do|did|has|have|will|can)`;

/** "message Tayla (for me) and ask her when ..." */
const VIA_MESSAGE = new RegExp(
  LEAD +
    String.raw`(?:message|text|whatsapp|contact|ping|reach\s+out\s+to|get\s+hold\s+of)\s+(.+?)\s+(?:for\s+me\s+)?(?:and\s+|to\s+)(?:ask|find\s+out|check)\s+(?:her|him|them)?\s*([\s\S]+)$`,
  "i",
);
/** "ask Tayla when ...", "find out from Sam whether ..." */
const DIRECT = new RegExp(
  LEAD +
    String.raw`(?:ask|find\s+out\s+from|check\s+with)\s+(.+?)\s+(?:for\s+me\s+)?(` +
    Q_WORD +
    String.raw`\b[\s\S]+)$`,
  "i",
);

const TAIL =
  /[\s,]*(?:,?\s*and\s+)?(?:take\s+(?:a\s+)?notes?(?:\s+of\s+(?:it|that|the\s+answer))?|note\s+(?:it|that|the\s+answer)(?:\s+down)?|make\s+a\s+note|let\s+me\s+know|tell\s+me|send\s+me\s+(?:the\s+answer|what\s+(?:she|he|they)\s+says?)|save\s+(?:it|that|the\s+answer)|add\s+(?:it|that)\s+to\s+(?:her|his|their|the)\s+(?:notes|profile)|for\s+me|please|thanks?)[\s?.!]*$/i;

/** The question a practitioner wants put to a patient, or null. */
export function readPatientQuestion(text: string): string | null {
  const t = String(text ?? "").trim();
  let q: string | null = null;
  const m = t.match(VIA_MESSAGE);
  if (m) q = m[2];
  else {
    const d = t.match(DIRECT);
    if (
      d &&
      !/^(?:the\s+)?(?:reception|receptionist|front|secretary|sec|admin|office|mishqah)\b/i.test(
        d[1],
      ) &&
      !/^(?:her|him|them|she|he|they|me|you|us)$/i.test(d[1].trim())
    )
      q = d[2];
  }
  if (!q) return null;
  // A check-in request has its own command.
  if (/^(?:to\s+)?(?:do\s+)?(?:a\s+|their\s+|his\s+|her\s+)?check[\s-]?in\b/i.test(q.trim()))
    return null;
  let prev = "";
  while (prev !== q) {
    prev = q;
    q = q.replace(TAIL, "");
  }
  q = q.trim().replace(/[\s?.!]+$/, "");
  if (q.split(/\s+/).length < 2) return null;
  return toPatient(q);
}

/**
 * Practitioner's words about the patient, turned to the patient:
 * "when her sporting events are happening" -> "When are your sporting events happening?"
 */
export function toPatient(q: string): string {
  // "when your events are happening" reads better as a direct question.
  return finishQuestion(swapPronouns(q));
}

/** "she is doing great with her rehab" -> "you are doing great with your rehab". */
export function swapPronouns(q: string): string {
  let s = ` ${q.trim()} `;
  const swaps: Array<[RegExp, string]> = [
    [/\b(?:she|he|they)\s+(?:is|'s)\b/gi, "you are"],
    [/\b(?:she|he|they)\s+are\b/gi, "you are"],
    [/\b(?:she|he|they)\s+was\b/gi, "you were"],
    [/\b(?:she|he|they)\s+were\b/gi, "you were"],
    [/\b(?:she|he|they)\s+has\b/gi, "you have"],
    [/\b(?:she|he|they)\s+have\b/gi, "you have"],
    [/\b(?:she|he|they)\s+does\b/gi, "you do"],
    [/\b(?:she|he|they)\s+do\b/gi, "you do"],
    [/\bis\s+(?:she|he)\b/gi, "are you"],
    [/\bare\s+they\b/gi, "are you"],
    [/\bwas\s+(?:she|he)\b/gi, "were you"],
    [/\bhas\s+(?:she|he)\b/gi, "have you"],
    [/\bhave\s+they\b/gi, "have you"],
    [/\bdoes\s+(?:she|he)\b/gi, "do you"],
    [/\bdo\s+they\b/gi, "do you"],
    [/\bshe's\b|\bhe's\b|\bthey're\b/gi, "you're"],
    [/\b(?:herself|himself|themselves|themself)\b/gi, "yourself"],
    [/\b(?:his|their)\b/gi, "your"],
    [/\btheirs\b|\bhers\b/gi, "yours"],
    [
      /\bher(?=\s+(?!to\b|about\b|for\b|if\b|when\b|and\b|or\b|that\b|at\b|on\b|in\b|with\b|so\b|very\b|too\b|a\s+lot\b|lots\b|loads\b|back\b|again\b|today\b|tomorrow\b|now\b|soon\b|later\b|more\b|please\b|by\b|from\b|this\b|next\b|tonight\b|all\b|as\b|know\b)[a-z])/gi,
      "your",
    ],
    [/\b(?:her|him|them)\b/gi, "you"],
    [/\b(?:she|he|they)\b/gi, "you"],
  ];
  for (const [re, to] of swaps) s = s.replace(re, to);
  return s.trim().replace(/\s+/g, " ");
}

function finishQuestion(input: string): string {
  let s = input;
  const reordered = s.replace(
    /^(when|where|what|how|why|which)\s+(your\s+[a-z]+(?:\s+[a-z]+)?)\s+(are|is|were|was)\s+/i,
    (_m, w: string, subj: string, verb: string) => `${w} ${verb} ${subj} `,
  );
  const AUX = /^(?:are|is|was|were|do|does|did|have|has|had|can|could|will|would|should)\b/i;
  const words = reordered.split(" ");
  const direct =
    reordered !== s ||
    AUX.test(reordered) ||
    (/^(?:when|where|what|how|why|which|who)$/i.test(words[0]) && AUX.test(words[1] ?? ""));
  s = direct
    ? reordered
    : `can you let me know ${/^(?:if|whether)\b/i.test(s) ? s.replace(/^whether\b/i, "if") : s}`;
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}?`;
}
