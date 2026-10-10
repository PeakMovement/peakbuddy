/**
 * How Buddy reads a practitioner's messy WhatsApp (10 Oct 2026).
 *
 * Deterministic, in this order, and nothing here sends a message:
 *   1. Lowercase, strip punctuation, expand the usual SMS shorthand.
 *   2. A fixed typo map (recepton, clints, programe, evry, chek, wit...).
 *   3. Edit distance against intent words only, and only when one word wins.
 *   4. The existing patterns, then a few looser ones.
 *
 * Confidence, decided by the caller together with the client-name match:
 *   - high: the cleaned sentence is an unambiguous command. Act.
 *   - medium: a real reading, but the phrasing or the name is fuzzy.
 *     Ask "Did you mean: ...?" with Yes / No. Do not message a patient,
 *     send a programme notice, or pass an errand to reception yet.
 *   - no match: "Sorry, I didn't quite get that." Never guess an action.
 *
 * Client names are not in the typo map. "sma" stays "sma" here and is
 * matched against the practitioner's own list afterwards.
 *
 * Heidi phrases ("get Sam's files", "what does Heidi say about Sam") are
 * recognised here too, including the same typos. The caller still runs them
 * only when the Heidi secrets are set, and Heidi's own matcher still wants
 * a first and last name. A fuzzy name does not open a chart.
 */
import { readHeidiCommand, type HeidiCommand } from "./heidi";

/**
 * Every way staff name the front desk (10 Oct, Justin: "secretary", "sec",
 * Mishqah...). Strong names count anywhere a reception name is expected.
 * Weak ones ("office", "admin", "sec") only count straight after a verb such
 * as ask or tell, so "Sam is in the office" is never an errand.
 */
export const RECEPTION_NAMES_STRONG = String.raw`receptionists?|reception|front\s+desk|front\s+office|admin\s+desk|admin\s+team|secretary|secretaries|mishqah`;
export const RECEPTION_NAMES_WEAK = String.raw`admin|office|sec`;
/** "the", "our" or "my" in front of the name. */
export const RECEPTION_OWNER = String.raw`(?:(?:the|our|my)\s+)?`;

export const PROGRAMME_SENT =
  /\b(sent|send|emailed|shared|uploaded|given|gave|done|finished|ready)\b[\s\S]{0,80}\b(programme|program|exercises?|rehab|plan|hep)\b|\b(programme|program|exercises?|rehab|plan|hep)\b[\s\S]{0,40}\b(sent|emailed|shared|uploaded|done|ready)\b/i;

/** Intent words edit-distance is allowed to correct towards. Not people. */
const KEYWORDS = [
  "reception",
  "receptionist",
  "secretary",
  "clients",
  "client",
  "patients",
  "patient",
  "programme",
  "exercises",
  "exercise",
  "every",
  "morning",
  "doing",
  "going",
  "message",
  "please",
  "update",
  "updates",
  "quiet",
  "status",
  "weekly",
  "daily",
  "weekdays",
  "weekday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "summary",
  "overview",
  "flags",
  "flag",
  "check",
  "front",
  "invoice",
  "thanks",
  "hello",
  "morning",
  "heidi",
  "files",
  "notes",
  "records",
  "documents",
];

/** Exact token swaps, including the short ones edit-distance must not touch. */
const WORD_FIX: Record<string, string> = {
  recepton: "reception",
  recepion: "reception",
  receptin: "reception",
  recption: "reception",
  receiption: "reception",
  receptoin: "reception",
  recepition: "reception",
  recepiont: "reception",
  receptonist: "receptionist",
  recepionist: "receptionist",
  clints: "clients",
  cleints: "clients",
  clents: "clients",
  cliets: "clients",
  clint: "client",
  clnt: "client",
  clnts: "clients",
  patints: "patients",
  patiens: "patients",
  pateints: "patients",
  patinets: "patients",
  patint: "patient",
  pts: "patients",
  pt: "patient",
  programe: "programme",
  progrm: "programme",
  programee: "programme",
  program: "programme",
  prog: "programme",
  excercise: "exercise",
  excercises: "exercises",
  exersise: "exercise",
  exersises: "exercises",
  excerise: "exercise",
  evry: "every",
  evrey: "every",
  evryday: "everyday",
  mornin: "morning",
  mornng: "morning",
  moring: "morning",
  mornign: "morning",
  chek: "check",
  chekc: "check",
  chck: "check",
  chekin: "check in",
  checkin: "check in",
  doin: "doing",
  doign: "doing",
  goin: "going",
  goign: "going",
  msg: "message",
  mssg: "message",
  mesage: "message",
  messge: "message",
  messsage: "message",
  mesg: "message",
  pls: "please",
  plz: "please",
  plss: "please",
  plese: "please",
  tel: "tell",
  tll: "tell",
  txt: "text",
  hows: "how's",
  howz: "how's",
  whos: "who's",
  whats: "what's",
  thats: "that's",
  dont: "don't",
  cant: "can't",
  havent: "haven't",
  didnt: "didn't",
  wont: "won't",
  isnt: "isn't",
  im: "i'm",
  flagg: "flag",
  flg: "flag",
  flgs: "flags",
  redflag: "red flag",
  redflags: "red flags",
  qiet: "quiet",
  quyet: "quiet",
  quet: "quiet",
  updat: "update",
  updte: "update",
  udpate: "update",
  upate: "update",
  frnt: "front",
  desck: "desk",
  frontdesk: "front desk",
  secratary: "secretary",
  secetary: "secretary",
  secretery: "secretary",
  secritary: "secretary",
  secrtary: "secretary",
  sectretary: "secretary",
  secreatry: "secretary",
  secertary: "secretary",
  secratery: "secretary",
  secetery: "secretary",
  secrotary: "secretary",
  mishka: "mishqah",
  mishkah: "mishqah",
  mishqa: "mishqah",
  misqah: "mishqah",
  mishqha: "mishqah",
  mishquah: "mishqah",
  mishaqh: "mishqah",
  mishqaah: "mishqah",
  snt: "sent",
  wit: "with",
  wth: "with",
  hw: "how",
  thx: "thanks",
  thanx: "thanks",
  thnx: "thanks",
  thnks: "thanks",
  wat: "what",
  appt: "appointment",
  filez: "files",
  fils: "files",
  recods: "records",
  ntoes: "notes",
  documets: "documents",
  hiedi: "heidi",
  heidy: "heidi",
  heidie: "heidi",
};

const KEYWORD_SET = new Set(KEYWORDS);

/**
 * Damerau-Levenshtein. A swapped pair of letters ("sma" / "sam") counts as
 * one change, which is the usual phone typo. Short strings only.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (!al) return bl;
  if (!bl) return al;
  const d: number[][] = Array.from({ length: al + 1 }, () => new Array<number>(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) d[i][0] = i;
  for (let j = 0; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (
        i > 1 &&
        j > 1 &&
        a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      )
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[al][bl];
}

function correctToken(word: string): string {
  if (WORD_FIX[word]) return WORD_FIX[word];
  if (word.includes("'") || word.length < 5 || KEYWORD_SET.has(word)) return word;
  const limit = word.length >= 8 ? 2 : 1;
  let best: string | null = null;
  let bestD = limit + 1;
  let ties = 0;
  for (const k of KEYWORDS) {
    if (k[0] !== word[0]) continue;
    if (Math.abs(k.length - word.length) > limit) continue;
    const d = editDistance(word, k);
    if (d === 0) return word;
    if (d < bestD) {
      best = k;
      bestD = d;
      ties = 1;
    } else if (d === bestD) ties++;
  }
  return best && ties === 1 && bestD <= limit ? best : word;
}

/**
 * Typo fixes with the rest of the casing left as the practitioner typed it,
 * so "call Thea" survives into the errand reception actually sees.
 */
export function fixPractitionerTypos(raw: string): string {
  let t = String(raw ?? "")
    .replace(/[’‘]/g, "'")
    .replace(/\bhow\s*r\b/gi, "how are")
    .replace(/\bchecking\s+in\b/gi, "check in")
    .replace(/\bcheck[\s-]*ins?\b/gi, "check in")
    .replace(/\bfrontdesk\b/gi, "front desk");
  t = t.replace(/\p{L}[\p{L}'-]*/gu, (word) => {
    const lower = word.toLowerCase();
    const fixed = correctToken(lower);
    if (fixed === lower) return word;
    if (fixed.includes(" ") || fixed.includes("'")) return fixed;
    if (word[0] === word[0].toUpperCase()) return fixed[0].toUpperCase() + fixed.slice(1);
    return fixed;
  });
  // "hw r" becomes "how r" only after hw → how, so the phrase runs again.
  return t.replace(/\bhow\s+r\b/gi, "how are");
}

/** Lowercased, punctuation-light, typos corrected. What the patterns read. */
export function normalizePractitionerText(raw: string): string {
  return fixPractitionerTypos(raw)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

/** "don't / haven't / never ..." in front of an outbound. Not "notes". */
export function blocksOutbound(text: string): boolean {
  const n = normalizePractitionerText(text);
  return (
    /\b(do not|don't|never|have not|haven't|did not|didn't|will not|won't|cannot|can't|not yet)\b/.test(
      n,
    ) || /\bnot\s+(?:to\s+)?(?:check|send|sent|ask|tell|message|contact|nudge|pass)\b/.test(n)
  );
}

const TASK_VERB =
  /\b(call|phone|ring|book|schedule|email|invoice|remind|message|text|tell|move|cancel|reschedule|confirm|send|ask|notify|contact|whatsapp|follow up)\b/;

export function isFillerTask(task: string): boolean {
  const n = task
    .toLowerCase()
    .replace(/[^a-z\s']/g, "")
    .trim();
  return (
    n.length < 3 || /^(please|thanks|thank you|now|asap|today|buddy|ok|okay|hi|hey|hello)$/.test(n)
  );
}

/** "contact reception" / "msg front desk pls" / "reception" with nothing to do yet. */
export function bareReception(text: string): boolean {
  const n = normalizePractitionerText(text);
  return new RegExp(
    String.raw`^(?:(?:hi|hey|hello|please|can you|could you|would you|buddy)\s+)*(?:(?:contact|message|text|ping|whatsapp|reach|speak to|talk to|get hold of|ask|tell|call|phone)\s+${RECEPTION_OWNER}(?:${RECEPTION_NAMES_STRONG}|${RECEPTION_NAMES_WEAK})|${RECEPTION_OWNER}(?:${RECEPTION_NAMES_STRONG}))(?:\s+please)?$`,
  ).test(n);
}

/**
 * Reception is named and a task verb follows, but not "ask reception to ...".
 * Medium: confirm before anything is sent.
 */
export function looseReceptionTask(text: string): string | null {
  const n = normalizePractitionerText(text);
  if (blocksOutbound(n) || bareReception(n)) return null;
  const m = n.match(new RegExp(String.raw`\b(?:${RECEPTION_NAMES_STRONG})\b\s+(.+)$`));
  if (!m) return null;
  const rest = m[1].replace(/^(?:please|to|can you|could you)\s+/, "").trim();
  if (rest.length < 3 || !TASK_VERB.test(rest) || isFillerTask(rest)) return null;
  return tidyErrand(rest);
}

const PERSON_STOP = new Set(
  `the a an my our your to for with and or on in at of please buddy can you could would just also now today tomorrow later time check need needs want wants get got him her them his their its about that this from into onto via hey hi hello morning afternoon evening update updates send sent programme program exercises exercise rehab doing going how what when where who why are is was were been being have has had will shall not dont do did me we us i i'm they client clients patient patients someone anyone everybody everyone people caseload status quick thanks thank reception front desk receptionist red flag flags quiet daily weekly every secretary secretaries sec admin office mishqah receptionists again soon asap very really still open help door notes note website shoes weather pain knee back shoulder hard well nice lovely great bad sore easy fine good difficult painful closed here there yesterday bit little much really`.split(
    /\s+/,
  ),
);

export function hasPersonToken(text: string): boolean {
  const n = normalizePractitionerText(text);
  return n.split(/[^a-z']+/).some((w) => w.length >= 3 && !PERSON_STOP.has(w));
}

/** "check in sam" / "check in with sam" once the words are cleaned up. High. */
export function directCheckin(text: string): boolean {
  const n = normalizePractitionerText(text);
  if (blocksOutbound(n)) return false;
  const m = n.match(/\bcheck in(?:\s+(?:with|on|for))?\s+([a-z][a-z'-]{2,30})\b/);
  return Boolean(m && m[1].length >= 3 && !PERSON_STOP.has(m[1]));
}

/** Odd word order ("sam needs a check in", "sam check in pls"). Medium. */
export function looseCheckin(text: string): boolean {
  const n = normalizePractitionerText(text);
  if (blocksOutbound(n)) return false;
  const patterns = [
    /\b([a-z][a-z'-]{2,30})\s+(?:to\s+)?check in\b/,
    /\b([a-z][a-z'-]{2,30})\s+needs?\s+(?:a\s+)?check in\b/,
    /\bcheck in\s+(?:for|about)\s+([a-z][a-z'-]{2,30})\b/,
    /\b(?:get|ask)\s+([a-z][a-z'-]{2,30})\s+(?:to\s+)?(?:do\s+)?(?:a\s+)?check in\b/,
  ];
  return patterns.some((p) => {
    const m = n.match(p);
    return Boolean(m && m[1].length >= 3 && !PERSON_STOP.has(m[1]));
  });
}

const NOT_A_CLIENT = new Set([
  ...PERSON_STOP,
  "life",
  "work",
  "things",
  "it",
  "that",
  "this",
  "everything",
  "anything",
  "clinic",
  "practice",
  "team",
  "staff",
  "schedule",
  "appointment",
  "invoice",
  "going",
  "doing",
  "today",
  "tomorrow",
  "morning",
  "afternoon",
  "evening",
  "weather",
  "everyone",
  "everybody",
]);

/** "how is sam" / "how's sam" without the word "doing". */
export function looseStatusName(text: string): boolean {
  const n = normalizePractitionerText(text);
  const m = n.match(/\bhow(?:'s| is| are)\s+(.+)$/);
  if (!m) return false;
  const parts = m[1]
    .replace(/\b(doing|going|getting on|progressing|coming along|now|today|lately|please)\b/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length || parts.length > 3) return false;
  const names = parts.filter((p) => p.length >= 2 && !NOT_A_CLIENT.has(p));
  return names.length > 0 && names.length === parts.length;
}

/** "how's it going" is not a client. */
export function statusOneJunk(text: string): boolean {
  const n = normalizePractitionerText(text);
  const m =
    n.match(
      /\bhow(?:'s| is| are)\s+(.*?)\s+(?:doing|going|getting on|progressing|coming along)\b/,
    ) ?? n.match(/\b(?:update|status|news)\s+on\s+(.+)$/);
  if (!m) return false;
  const parts = m[1].trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 && parts.every((p) => NOT_A_CLIENT.has(p) || p.length < 2);
}

export function programmeConfidence(text: string): "high" | "medium" | null {
  const n = normalizePractitionerText(text);
  if (blocksOutbound(n)) return null;
  if (PROGRAMME_SENT.test(n) || PROGRAMME_SENT.test(text)) return "high";
  if (!/\b(programme|exercises|exercise|rehab)\b/.test(n)) return null;
  const tokens = n
    .replace(/'s\b/g, "")
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !PERSON_STOP.has(w));
  return tokens.length ? "medium" : null;
}

export function looksLikeProgramme(text: string): boolean {
  return programmeConfidence(text) !== null;
}

const HEIDI_FILE = String.raw`(?:files?|records?|notes?|documents?)`;

function stripPolite(text: string): string {
  let t = text;
  for (let i = 0; i < 3; i++) {
    const next = t.replace(/^(?:please|can you|could you|would you|buddy|hey|hi)\s+/, "");
    if (next === t) break;
    t = next;
  }
  return t.trim();
}

/**
 * A Heidi read, after the same typo cleanup as other practitioner commands.
 * Button picks stay exact. A negated sentence is not a read. Names are
 * passed through for Heidi's own first-and-last match; this does not guess
 * a person.
 */
export function readPractitionerHeidi(text: string, replyId: string | null): HeidiCommand | null {
  const picked = readHeidiCommand("", replyId);
  if (picked?.kind === "pick") return picked;
  if (blocksOutbound(text)) return null;
  const direct = readHeidiCommand(text, null);
  if (direct) return direct;
  const fixed = fixPractitionerTypos(text);
  if (fixed !== text) {
    const again = readHeidiCommand(fixed, null);
    if (again) return again;
  }
  const n = stripPolite(normalizePractitionerText(text));
  const cleaned = readHeidiCommand(n, null);
  if (cleaned) return cleaned;
  const patterns = [
    new RegExp(
      `^(?:get|fetch|pull|show|read)\\s+(?:me\\s+)?(?:the\\s+)?${HEIDI_FILE}\\s+(?:for|on|about)\\s+(.+?)(?:\\s+from\\s+heidi)?$`,
    ),
    /^(?:get|fetch|pull|show|read)\s+(?:me\s+)?(.+?)\s+from\s+heidi$/,
    new RegExp(
      `^(?:get|fetch|pull|show|read)\\s+(?:me\\s+)?(.+?)(?:'s)?\\s+${HEIDI_FILE}(?:\\s+from\\s+heidi)?$`,
    ),
    new RegExp(`^heidi\\s+${HEIDI_FILE}\\s+(?:for|on|about)\\s+(.+)$`),
    /^what(?:'s| does| did)\s+heidi\s+(?:say|said)\s+about\s+(.+)$/,
  ];
  for (const pattern of patterns) {
    const name = n
      .match(pattern)?.[1]
      ?.replace(/^(?:the|a|an)\s+/, "")
      .trim();
    if (name && name.length >= 2) return { kind: "ask", name };
  }
  return null;
}

export function tidyErrand(text: string): string {
  const t = String(text ?? "")
    .trim()
    .replace(/[\s.?!]+$/g, "")
    .replace(/\s+/g, " ");
  if (t.length < 3) return "";
  const clipped = t.length > 600 ? `${t.slice(0, 597).trimEnd()}...` : t;
  return clipped.charAt(0).toUpperCase() + clipped.slice(1);
}

const SMALL = new Set(
  "a an the to for of and or on in at by with from about that this them her his their our my please".split(
    " ",
  ),
);
const TASK_VERBS = new Set(
  TASK_VERB.source
    .replace(/[\\()|]/g, " ")
    .split(/\s+/)
    .filter(Boolean),
);

/** "Call thea about thursday" → "call Thea about Thursday" for the confirm line. */
export function prettyTask(task: string): string {
  return task
    .split(/\s+/)
    .map((w, i) => {
      const bare = w.toLowerCase().replace(/[^a-z'-]/g, "");
      if (i === 0) return w.charAt(0).toLowerCase() + w.slice(1);
      if (!bare || SMALL.has(bare) || TASK_VERBS.has(bare)) return w.toLowerCase();
      if (bare.length >= 3 && bare === w.toLowerCase().replace(/[^a-z'-]/g, ""))
        return w.charAt(0).toUpperCase() + w.slice(1);
      return w;
    })
    .join(" ");
}

export function isCancel(text: string): boolean {
  const n = normalizePractitionerText(text);
  return /^(no|nope|nah|cancel|stop|never mind|nevermind|nvm|forget it|nothing|do not worry|don't worry|all good|leave it|no thanks)$/.test(
    n,
  );
}

export function isYes(text: string): boolean {
  const n = normalizePractitionerText(text);
  return /^(yes|yep|yeah|y|ya|confirm|do it|please do|go ahead)$/.test(n);
}

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

const NAME_TOKEN_STOP = new Set([
  ...PERSON_STOP,
  "tell",
  "ask",
  "message",
  "contact",
  "call",
  "book",
  "text",
  "phone",
  "ping",
  "nudge",
  "remind",
  "let",
  "know",
  "been",
  "from",
  "your",
  "have",
  "just",
  "that",
  "this",
  "with",
  "them",
  "she",
  "him",
  "emailed",
  "shared",
  "given",
  "gave",
  "uploaded",
  "finished",
  "ready",
  "done",
  "his",
  "her",
  "their",
  "programme",
  "program",
  "exercises",
  "exercise",
  "rehab",
  "plan",
  "sent",
  "send",
  "check",
  "doing",
  "going",
  "please",
  "thanks",
  "hello",
  "about",
  "well",
  "hard",
  "nice",
  "lovely",
  "reception",
  "front",
  "desk",
  "secretary",
  "office",
  "admin",
  "mishqah",
]);

export interface RankedPatient<T> {
  patient: T;
  confidence: "high" | "medium";
  score: number;
}

function closeName(token: string, name: string): boolean {
  if (token === name || name.length < 3 || token.length < 3) return false;
  if (token[0] !== name[0] || Math.abs(token.length - name.length) > 2) return false;
  const d = editDistance(token, name);
  if (name.length <= 5) return d === 1;
  return d > 0 && d <= 2;
}

/**
 * Exact full name, then exact first name, then a fuzzy name (sma → Sam,
 * kruge → Kruger). Everyone at the best score is returned, so two Sams
 * stay a choice instead of a guess.
 */
export function rankPatients<T extends { id: string; full_name: string | null }>(
  text: string,
  patients: T[],
): Array<RankedPatient<T>> {
  const n = normalizePractitionerText(text).replace(/'s\b/g, "");
  const tokens = n.split(/[^a-z'-]+/).filter((w) => w.length >= 2 && !NAME_TOKEN_STOP.has(w));
  const tokenSet = new Set(tokens);
  const hay = ` ${n} `;
  const scored: Array<RankedPatient<T>> = [];
  for (const patient of patients) {
    const parts = String(patient.full_name ?? "")
      .toLowerCase()
      .split(/[^a-z'-]+/)
      .filter((w) => w.length >= 2);
    if (!parts.length) continue;
    const first = parts[0];
    const last = parts.length > 1 ? parts[parts.length - 1] : null;
    let score = 0;
    let confidence: "high" | "medium" = "high";
    if (parts.length > 1 && hay.includes(` ${parts.join(" ")} `)) score = 30;
    else if (last && tokenSet.has(first) && tokenSet.has(last)) score = 20;
    else if (tokenSet.has(first)) score = 10;
    else {
      const fuzzyFirst = tokens.some((t) => closeName(t, first));
      const fuzzyLast = last ? tokens.some((t) => closeName(t, last)) : false;
      const exactLast = Boolean(last && tokenSet.has(last));
      if (
        (fuzzyFirst || tokenSet.has(first)) &&
        last &&
        (fuzzyLast || exactLast) &&
        (fuzzyFirst || fuzzyLast)
      ) {
        score = 8;
        confidence = "medium";
      } else if (last && fuzzyLast && last.length >= 4) {
        score = 6;
        confidence = "medium";
      } else if (fuzzyFirst && first.length >= 4) {
        score = 5;
        confidence = "medium";
      } else if (fuzzyFirst) {
        score = 4;
        confidence = "medium";
      }
    }
    if (score > 0) scored.push({ patient, confidence, score });
  }
  if (!scored.length) return [];
  const best = Math.max(...scored.map((s) => s.score));
  return scored.filter((s) => s.score === best);
}

/* ------------------------------------------------------------------ */
/* Memory between messages: the errand we asked for, or a Yes/No       */
/* ------------------------------------------------------------------ */

export type PracConfirm =
  | { kind: "checkin"; clientId: string; line: string }
  | { kind: "programme"; clientId: string; line: string }
  | { kind: "status_one"; clientId: string; line: string }
  | { kind: "reception"; task: string; line: string };

export interface PracMemory {
  awaitingReception?: boolean;
  awaitingReceptionAt?: number;
  confirm?: PracConfirm | null;
  confirmAt?: number;
}

export const PRAC_MEMORY_MS = 30 * 60 * 1000;

export function expireMemory(mem: PracMemory, now: number): void {
  if (mem.awaitingReceptionAt != null && now - mem.awaitingReceptionAt > PRAC_MEMORY_MS)
    mem.awaitingReception = false;
  if (mem.confirmAt != null && now - mem.confirmAt > PRAC_MEMORY_MS) mem.confirm = null;
}

export function readPracMemory(draft: unknown, now = Date.now()): PracMemory {
  const prac =
    draft && typeof draft === "object"
      ? ((draft as { prac?: PracMemory }).prac ?? undefined)
      : undefined;
  const mem: PracMemory = {
    awaitingReception: Boolean(prac?.awaitingReception),
    awaitingReceptionAt: prac?.awaitingReceptionAt,
    confirm: prac?.confirm ?? null,
    confirmAt: prac?.confirmAt,
  };
  expireMemory(mem, now);
  if (!mem.awaitingReception) mem.awaitingReception = false;
  return mem;
}

export function writePracMemory(draft: unknown, memory: PracMemory): Record<string, unknown> {
  const base = draft && typeof draft === "object" ? { ...(draft as Record<string, unknown>) } : {};
  if (memory.awaitingReception || memory.confirm) base.prac = { ...memory };
  else delete base.prac;
  return base;
}
