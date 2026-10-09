import { analyzeRealTime, type RedFlagCategory, type UrgencyTier } from "@/lib/yves";

/**
 * Layer 1 of the WhatsApp red-flag net: deterministic rules that run on every
 * inbound message and every check-in entry, BEFORE the model sees anything.
 *
 * The model (layer 2) is never the only safety net. Either layer alone is
 * enough to escalate, so this file must stay readable and testable on its own.
 *
 * It composes `analyzeRealTime` from yves.ts rather than copying its keyword
 * lists, so the two never drift. What it adds is the post-surgical set — calf
 * pain, swelling, redness, wounds, discharge, clots — which the existing engine
 * does not cover at all, and which matters most for the post-operative rehab
 * patients this channel is aimed at.
 */

export const PAIN_ABSOLUTE_THRESHOLD = 8;
export const PAIN_RISE_THRESHOLD = 3;
export const MISSED_CHECKINS_THRESHOLD = 3;

export type RuleId =
  | "pain_absolute"
  | "pain_rise"
  | "keyword_existing"
  | "keyword_post_surgical"
  | "missed_checkins_postop";

export interface RuleHit {
  rule: RuleId;
  /** Plain-language reason, safe to show a practitioner. Never shown to the patient. */
  detail: string;
  severity: number;
  urgency: UrgencyTier;
  category: RedFlagCategory | null;
  matchedTerms: string[];
}

export interface RuleInput {
  /** The patient's own words for this message or entry. */
  text: string;
  /** Pain 0-10 for this entry, if one was captured. */
  painScore?: number | null;
  /** Pain 0-10 from the previous entry, for the rise rule. */
  previousPainScore?: number | null;
  /** Consecutive scheduled check-ins with no response. */
  consecutiveMissedCheckins?: number;
  /** Post-operative patients get the missed-check-in rule; others do not. */
  isPostOperative?: boolean;
}

export interface RuleLayerResult {
  triggered: boolean;
  hits: RuleHit[];
  /** Highest urgency across all hits. */
  urgency: UrgencyTier;
  /** Highest severity across all hits. */
  severity: number;
  /** Category of the most severe hit. */
  category: RedFlagCategory | null;
}

const URGENCY_RANK: Record<UrgencyTier, number> = {
  routine: 0,
  monitor: 1,
  soon: 2,
  urgent: 3,
  emergency: 4,
};

/**
 * Clinical term groups, English and Afrikaans, grouped so the practitioner-facing
 * reason names the concern rather than echoing the word that matched.
 *
 * Matched on word boundaries, not substrings: the existing engine's floor uses
 * indexOf, which is why a term like "pus" cannot safely live there.
 *
 * Two kinds of group live here:
 *   1. Post-surgical concerns (DVT, wound infection) the existing engine does
 *      not cover at all.
 *   2. Everyday phrasings of categories the existing engine DOES cover, but only
 *      in textbook wording. Verified 2026-10-02: it matches "shortness of breath"
 *      but not "short of breath"; "loss of bladder control" but not "I cannot
 *      control my bladder"; "want to kill myself" but not "I don't want to be
 *      here anymore". Patients use the phrasings that miss, so this layer
 *      carries them.
 */
const CLINICAL_GROUPS: Array<{
  concern: string;
  category: RedFlagCategory;
  urgency: UrgencyTier;
  severity: number;
  terms: string[];
}> = [
  {
    concern: "Possible DVT (calf pain, swelling, redness or heat in the limb)",
    category: "msk_alarm",
    urgency: "urgent",
    severity: 8,
    terms: [
      "calf", "calves", "kuit", "kuite",
      "clot", "blood clot", "dvt", "bloedklont", "klont",
      "swollen", "swelling", "geswel", "geswolle", "swelsel",
      "red and hot", "hot and red", "redness", "rooi en warm", "warm en rooi",
      "hot to touch", "warm to the touch", "warm aan die raak",
      "tight and shiny", "shiny skin",
    ],
  },
  {
    concern: "Possible wound infection or dehiscence",
    category: "infection",
    urgency: "urgent",
    severity: 8,
    terms: [
      "wound", "wond", "snywond",
      "incision", "insnyding",
      "stitches", "sutures", "staples", "steke", "hegtings",
      "discharge", "oozing", "weeping", "pus", "etter", "dreinering",
      "smells", "smelly", "foul smell", "ruik sleg", "stink",
      "opened up", "opening up", "wound opened", "gaping", "split open",
      "oopgegaan", "oop gegaan",
    ],
  },
  {
    concern: "Breathing difficulty",
    category: "respiratory",
    urgency: "emergency",
    severity: 9,
    terms: [
      "short of breath", "shortness of breath", "breathless", "out of breath",
      "struggling to breathe", "hard to breathe", "cant breathe", "can't breathe",
      "cannot breathe", "gasping", "winded",
      "kortasem", "kort asem", "sukkel om asem te haal",
    ],
  },
  {
    concern: "New or worsening weakness / limb giving way",
    category: "neuro",
    urgency: "urgent",
    severity: 8,
    terms: [
      "weak", "weakness", "weaker",
      "giving way", "gives way", "gave way", "buckling", "buckles", "buckled",
      "cant lift", "can't lift", "cannot lift", "foot drop", "dragging my foot",
      "swak", "gee pad",
    ],
  },
  {
    concern: "Bladder or bowel control change (possible cauda equina)",
    category: "cauda_equina",
    urgency: "emergency",
    severity: 10,
    terms: [
      "cannot control my bladder", "cant control my bladder", "can't control my bladder",
      "cannot control my bowel", "cant control my bowel", "can't control my bowel",
      "lost control of my bladder", "lost control of my bowel",
      "wetting myself", "soiling myself", "incontinent", "incontinence",
      "cannot pass urine", "cant pee", "can't pee", "unable to pee",
      "kan nie urineer nie", "kan nie my blaas beheer nie",
    ],
  },
  {
    concern: "Fall or new injury",
    category: "msk_alarm",
    urgency: "urgent",
    severity: 7,
    terms: [
      "had a fall", "i fell", "ive fallen", "i've fallen", "fell over", "fell down",
      "tripped and fell", "slipped and fell", "collapsed", "came down hard",
      "het geval", "ek het geval",
    ],
  },
  {
    concern: "Self-harm or suicidal language",
    category: "mental_health",
    urgency: "emergency",
    severity: 10,
    terms: [
      "suicide", "suicidal", "kill myself", "end my life", "end it all",
      "harm myself", "hurt myself", "self harm",
      "dont want to be here", "don't want to be here", "do not want to be here",
      "dont want to live", "don't want to live", "do not want to live",
      "no point in living", "no point anymore", "better off without me",
      "selfmoord", "ek wil nie meer hier wees nie", "wil myself seermaak",
    ],
  },
];

/** Word-boundary match, so "pus" never fires on "campus". Multi-word terms match as phrases. */
function findTerms(haystack: string, terms: string[]): string[] {
  const found: string[] = [];
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, "iu").test(haystack)) {
      found.push(term);
    }
  }
  return found;
}

/*
 * Negation. "No chest pain", "my calf isn't swollen", "geen swelsel nie" are
 * patients telling us they are fine, and used to raise the same alert as the
 * symptom itself. A term is treated as negated only when ALL of these hold:
 *   - a negation word appears up to 6 words before it, in the same clause
 *     (a comma, full stop, "but", "and", "maar", "en" ... starts a new clause,
 *     so "no pain but my calf is swollen" still alerts);
 *   - the term itself carries no negation word ("can't breathe",
 *     "kan nie asemhaal nie", "don't want to live" are the symptom);
 *   - the negation is not uncertainty ("not sure", "don't know", "nie seker");
 *   - it is not self-harm language, which is never suppressed.
 * Every occurrence must be negated: "no swelling yesterday. Calf swollen now"
 * still alerts.
 */
const NEGATION_CUE =
  /\b(no|not|never|without|none|nor|dont|don't|doesnt|doesn't|didnt|didn't|isnt|isn't|wasnt|wasn't|arent|aren't|havent|haven't|hasnt|hasn't|hadnt|hadn't|wont|won't|geen|nie|nooit|sonder)\b/i;
const NEGATION_CUE_G = new RegExp(NEGATION_CUE.source, "gi");
const CLAUSE_BREAK =
  /[.;:!?\n,]|\b(but|though|although|however|except|and|yet|now|maar|en|nou)\b/gi;
const UNCERTAIN_AFTER = /^\s*(sure|certain|know|seker|weet)\b/i;

function negatedAt(lower: string, index: number): boolean {
  let prefix = lower.slice(0, index);
  let lastBreak = -1;
  for (const m of prefix.matchAll(CLAUSE_BREAK)) lastBreak = (m.index ?? 0) + m[0].length;
  if (lastBreak >= 0) prefix = prefix.slice(lastBreak);
  const words = prefix.trim().split(/\s+/).filter(Boolean);
  const windowText = words.slice(-6).join(" ");
  let cue: RegExpMatchArray | null = null;
  for (const m of windowText.matchAll(NEGATION_CUE_G)) cue = m;
  if (!cue) return false;
  const after = windowText.slice((cue.index ?? 0) + cue[0].length);
  return !UNCERTAIN_AFTER.test(after);
}

function occurrences(lower: string, term: string): number[] {
  const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^\\p{L}])(${escaped})(?=[^\\p{L}]|$)`, "giu");
  const out: number[] = [];
  for (const m of lower.matchAll(re)) out.push((m.index ?? 0) + m[1].length);
  // Fallback for terms the other engine matches as plain substrings.
  if (out.length === 0) {
    let i = lower.indexOf(term.toLowerCase());
    while (i !== -1) {
      out.push(i);
      i = lower.indexOf(term.toLowerCase(), i + 1);
    }
  }
  return out;
}

/** True when every mention of `term` in `text` is negated. */
export function isNegatedTerm(text: string, term: string): boolean {
  if (NEGATION_CUE.test(term)) return false;
  // Phones type curly apostrophes ("don’t"); same length, so indexes hold.
  const lower = text.toLowerCase().replace(/[\u2018\u2019]/g, "'");
  const at = occurrences(lower, term);
  return at.length > 0 && at.every((i) => negatedAt(lower, i));
}

function maskTerms(text: string, terms: string[]): string {
  let out = text;
  for (const term of terms) {
    const lower = out.toLowerCase();
    for (const i of occurrences(lower, term)) {
      out = out.slice(0, i) + " ".repeat(term.length) + out.slice(i + term.length);
    }
  }
  return out;
}

/**
 * The existing engine with negated mentions taken out. Self-harm results are
 * returned untouched.
 */
function realtimeIgnoringNegation(text: string): ReturnType<typeof analyzeRealTime> {
  let t = text;
  let result = analyzeRealTime(t);
  for (let i = 0; i < 6 && result.detected; i++) {
    if (result.category === "mental_health") break;
    const negated = result.matchedTerms.filter((term) => isNegatedTerm(t, term));
    if (negated.length === 0) break;
    t = maskTerms(t, negated);
    result = analyzeRealTime(t);
  }
  return result;
}

/** Body parts that alert on their own, unless the symptoms named with them were all denied. */
const ANCHOR_TERMS = new Set([
  "calf", "calves", "kuit", "kuite",
  "wound", "wond", "snywond", "incision", "insnyding",
  "stitches", "sutures", "staples", "steke", "hegtings",
]);

function clinicalGroupHits(text: string): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const group of CLINICAL_GROUPS) {
    const found = findTerms(text, group.terms);
    let matched = found;
    if (group.category !== "mental_health") {
      const negated = found.filter((term) => isNegatedTerm(text, term));
      matched = found.filter((term) => !negated.includes(term));
      // "My calf isn't swollen", "wound is fine, no pus": the body part on its
      // own still alerts ("my calf is sore"), but not when every symptom named
      // alongside it was denied.
      if (negated.length > 0 && matched.every((term) => ANCHOR_TERMS.has(term))) {
        matched = [];
      }
    }
    if (matched.length > 0) {
      hits.push({
        rule: "keyword_post_surgical",
        detail: group.concern,
        severity: group.severity,
        urgency: group.urgency,
        category: group.category,
        matchedTerms: matched,
      });
    }
  }
  return hits;
}

/**
 * Run every layer-1 rule. Always returns every hit, not just the worst, so the
 * practitioner sees each reason and the alert can record which rule fired.
 */
export function runRedFlagRules(input: RuleInput): RuleLayerResult {
  const text = input.text ?? "";
  const hits: RuleHit[] = [];

  // 1. Absolute pain.
  if (typeof input.painScore === "number" && input.painScore >= PAIN_ABSOLUTE_THRESHOLD) {
    hits.push({
      rule: "pain_absolute",
      detail: `Pain reported at ${input.painScore}/10`,
      severity: 7,
      urgency: "urgent",
      category: null,
      matchedTerms: [],
    });
  }

  // 2. Pain rise since the last entry.
  if (
    typeof input.painScore === "number" &&
    typeof input.previousPainScore === "number"
  ) {
    const rise = input.painScore - input.previousPainScore;
    if (rise >= PAIN_RISE_THRESHOLD) {
      hits.push({
        rule: "pain_rise",
        detail: `Pain rose ${rise} points since the last check-in (${input.previousPainScore} to ${input.painScore})`,
        severity: 7,
        urgency: "urgent",
        category: null,
        matchedTerms: [],
      });
    }
  }

  // 3. The existing engine's hard overrides and keyword floor.
  if (text.trim()) {
    const realtime = realtimeIgnoringNegation(text);
    if (realtime.detected) {
      hits.push({
        rule: "keyword_existing",
        detail: `Symptom language matched: ${realtime.matchedTerms.join(", ")}`,
        severity: realtime.severity,
        urgency: realtime.urgency,
        category: realtime.category,
        matchedTerms: realtime.matchedTerms,
      });
    }
    // 4. Terms and phrasings the existing engine does not carry.
    hits.push(...clinicalGroupHits(text));
  }

  // 5. Missed check-ins, post-operative patients only.
  if (
    input.isPostOperative &&
    (input.consecutiveMissedCheckins ?? 0) >= MISSED_CHECKINS_THRESHOLD
  ) {
    hits.push({
      rule: "missed_checkins_postop",
      detail: `Post-operative patient has missed ${input.consecutiveMissedCheckins} check-ins in a row`,
      severity: 6,
      urgency: "soon",
      category: null,
      matchedTerms: [],
    });
  }

  if (hits.length === 0) {
    return { triggered: false, hits: [], urgency: "routine", severity: 0, category: null };
  }

  const worst = hits.reduce((a, b) =>
    URGENCY_RANK[b.urgency] > URGENCY_RANK[a.urgency] ||
    (URGENCY_RANK[b.urgency] === URGENCY_RANK[a.urgency] && b.severity > a.severity)
      ? b
      : a,
  );

  return {
    triggered: true,
    hits,
    urgency: worst.urgency,
    severity: Math.max(...hits.map((h) => h.severity)),
    category: worst.category,
  };
}
