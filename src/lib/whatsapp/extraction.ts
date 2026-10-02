import { z } from "zod";

/**
 * Turning a patient's WhatsApp reply into the same shape a check-in form
 * produces, so nothing downstream has to know where the data came from.
 *
 * Two passes, in this order:
 *
 *   1. `extractDeterministic` - regex and button ids. Catches the common case
 *      ("7", "pain is 7/10", a tapped button) with no model call, no cost and
 *      no variance. Confidence 1 when it fires.
 *   2. The model, for free text that pass 1 could not read. It must return
 *      `ExtractionSchema` and nothing else.
 *
 * The model never decides safety. Red flags come from red-flag-rules.ts on the
 * raw text, whatever extraction does or does not manage to read out of it.
 */

export const TREND_VALUES = ["better", "same", "worse", "unknown"] as const;
export const ADHERENCE_VALUES = ["all", "most", "some", "none", "unknown"] as const;
export const SLEEP_VALUES = ["good", "fair", "poor", "unknown"] as const;

export type Trend = (typeof TREND_VALUES)[number];
export type Adherence = (typeof ADHERENCE_VALUES)[number];
export type Sleep = (typeof SLEEP_VALUES)[number];

export const ExtractionSchema = z.object({
  /** 0-10. Null when the patient did not give one. Never guessed. */
  painScore: z.number().int().min(0).max(10).nullable(),
  trend: z.enum(TREND_VALUES),
  exerciseAdherence: z.enum(ADHERENCE_VALUES),
  sleepQuality: z.enum(SLEEP_VALUES),
  /**
   * One or two clinical sentences for the practitioner. Patient's meaning, not
   * their verbatim text, and no diagnosis or advice.
   */
  notesSummary: z.string().max(400),
  /** 0-1. How much of the above was actually stated rather than inferred. */
  confidence: z.number().min(0).max(1),
  /** Which fields the model could not read at all. Drives the follow-up question. */
  missing: z.array(
    z.enum(["painScore", "trend", "exerciseAdherence", "sleepQuality"]),
  ),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

export interface ExtractionResult extends Extraction {
  /** Patient's words, stored once on the entry. Not copied into logs. */
  rawText: string;
  source: "deterministic" | "model" | "none";
}

export const EMPTY_EXTRACTION: Extraction = {
  painScore: null,
  trend: "unknown",
  exerciseAdherence: "unknown",
  sleepQuality: "unknown",
  notesSummary: "",
  confidence: 0,
  missing: ["painScore", "trend", "exerciseAdherence", "sleepQuality"],
};

/* ------------------------------------------------------------------ */
/* Button ids we send, so pass 1 can read our own replies back          */
/* ------------------------------------------------------------------ */

export const BUTTON_IDS = {
  trend: { better: "trend_better", same: "trend_same", worse: "trend_worse" },
  adherence: {
    all: "adh_all",
    most: "adh_most",
    some: "adh_some",
    none: "adh_none",
  },
  sleep: { good: "sleep_good", fair: "sleep_fair", poor: "sleep_poor" },
} as const;

const BUTTON_LOOKUP: Record<string, Partial<Extraction>> = {
  trend_better: { trend: "better" },
  trend_same: { trend: "same" },
  trend_worse: { trend: "worse" },
  adh_all: { exerciseAdherence: "all" },
  adh_most: { exerciseAdherence: "most" },
  adh_some: { exerciseAdherence: "some" },
  adh_none: { exerciseAdherence: "none" },
  sleep_good: { sleepQuality: "good" },
  sleep_fair: { sleepQuality: "fair" },
  sleep_poor: { sleepQuality: "poor" },
};

for (let n = 0; n <= 10; n += 1) BUTTON_LOOKUP[`pain_${n}`] = { painScore: n };

/* ------------------------------------------------------------------ */
/* Pass 1                                                              */
/* ------------------------------------------------------------------ */

/**
 * Pain written as a number. Deliberately narrow: we would rather hand a
 * sentence to the model than read "I slept 7 hours" as a pain score of 7.
 */
const PAIN_PATTERNS: RegExp[] = [
  /^\s*(\d{1,2})\s*$/,                                   // "7"
  /^\s*(\d{1,2})\s*\/\s*10\s*$/,                          // "7/10"
  /\bpain\b[^.\n\d]{0,20}?(\d{1,2})\s*(?:\/\s*10)?\b/i,   // "pain is 7", "pain 7/10"
  /\bpyn\b[^.\n\d]{0,20}?(\d{1,2})\s*(?:\/\s*10)?\b/i,    // Afrikaans
  /\b(\d{1,2})\s*(?:\/\s*10)?\s*(?:out of ten|uit tien)\b/i,
];

// Word-boundary matching only. "I have no pain" must not match "same".
function has(text: string, terms: string[]): boolean {
  return terms.some((t) =>
    new RegExp(`(^|[^a-z])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i").test(
      text,
    ),
  );
}

const TREND_TERMS: Array<[Trend, string[]]> = [
  ["worse", ["worse", "worsening", "more sore", "more painful", "slegter", "erger", "deteriorating", "going backwards"]],
  ["better", ["better", "improving", "improved", "easier", "less pain", "beter", "verbeter", "much better"]],
  ["same", ["same", "no change", "unchanged", "dieselfde", "net dieselfde", "about the same"]],
];

const ADHERENCE_TERMS: Array<[Adherence, string[]]> = [
  ["none", ["none", "did not do", "didnt do", "did nt do", "no exercises", "skipped", "nie gedoen", "geen"]],
  ["all", ["all of them", "all", "every one", "everything", "almal", "alles", "did them all"]],
  ["most", ["most", "most of them", "meeste", "nearly all"]],
  ["some", ["some", "a few", "half", "sommige", "partly"]],
];

const SLEEP_TERMS: Array<[Sleep, string[]]> = [
  ["poor", ["poor", "bad", "badly", "terrible", "awake", "couldnt sleep", "could not sleep", "sleg", "swak", "nie geslaap"]],
  ["good", ["good", "well", "fine", "slept well", "goed", "lekker geslaap"]],
  ["fair", ["fair", "ok", "okay", "so so", "alright", "redelik"]],
];

function firstMatch<T extends string>(
  text: string,
  table: Array<[T, string[]]>,
): T | null {
  for (const [value, terms] of table) if (has(text, terms)) return value;
  return null;
}

export interface DeterministicInput {
  text: string;
  /** Button or list id the patient tapped, if any. */
  replyId?: string;
  /** What we actually asked for in the last outbound message, when known. */
  expecting?: "painScore" | "trend" | "exerciseAdherence" | "sleepQuality";
}

/**
 * Reads what can be read with certainty. Anything it is not sure about is left
 * at "unknown" and listed in `missing` for the model pass.
 */
export function extractDeterministic(input: DeterministicInput): ExtractionResult {
  const text = (input.text ?? "").trim();
  const result: Extraction = { ...EMPTY_EXTRACTION, missing: [] };
  let read = 0;

  if (input.replyId && BUTTON_LOOKUP[input.replyId]) {
    Object.assign(result, BUTTON_LOOKUP[input.replyId]);
    read += 1;
  }

  if (result.painScore === null && text) {
    // A bare number only counts as pain when that is what we asked for, or
    // when it is written as a score.
    for (const [index, pattern] of PAIN_PATTERNS.entries()) {
      const bare = index === 0;
      if (bare && input.expecting !== "painScore") continue;
      const m = text.match(pattern);
      if (!m) continue;
      const n = Number(m[1]);
      if (Number.isInteger(n) && n >= 0 && n <= 10) {
        result.painScore = n;
        read += 1;
      }
      break;
    }
  }

  if (text) {
    if (result.trend === "unknown") {
      const t = firstMatch(text, TREND_TERMS);
      if (t) {
        result.trend = t;
        read += 1;
      }
    }
    if (result.exerciseAdherence === "unknown") {
      const a = firstMatch(text, ADHERENCE_TERMS);
      // Only trust adherence words when exercises are the subject, otherwise
      // "I did some walking" reads as exercise adherence.
      if (a && (input.expecting === "exerciseAdherence" || has(text, ["exercise", "exercises", "oefening", "oefeninge", "homework", "program", "programme"]))) {
        result.exerciseAdherence = a;
        read += 1;
      }
    }
    if (result.sleepQuality === "unknown") {
      const s = firstMatch(text, SLEEP_TERMS);
      if (s && (input.expecting === "sleepQuality" || has(text, ["sleep", "slept", "sleeping", "slaap", "geslaap", "night", "nag"]))) {
        result.sleepQuality = s;
        read += 1;
      }
    }
  }

  result.missing = (
    ["painScore", "trend", "exerciseAdherence", "sleepQuality"] as const
  ).filter((field) =>
    field === "painScore" ? result.painScore === null : result[field] === "unknown",
  );

  result.confidence = read > 0 ? 1 : 0;

  return { ...result, rawText: text, source: read > 0 ? "deterministic" : "none" };
}

/** True when the model pass is worth paying for. */
export function needsModelPass(result: ExtractionResult): boolean {
  return result.missing.length > 0 && result.rawText.length > 0;
}

/* ------------------------------------------------------------------ */
/* Pass 2 prompt                                                       */
/* ------------------------------------------------------------------ */

/**
 * No patient identifiers go into this prompt. Only the message text and which
 * fields are still missing.
 */
export const EXTRACTION_SYSTEM_PROMPT = `You read one WhatsApp message from a physiotherapy patient and return structured data about it.

Return JSON only, matching exactly this shape:
{
  "painScore": integer 0-10 or null,
  "trend": "better" | "same" | "worse" | "unknown",
  "exerciseAdherence": "all" | "most" | "some" | "none" | "unknown",
  "sleepQuality": "good" | "fair" | "poor" | "unknown",
  "notesSummary": string, at most two sentences,
  "confidence": number 0-1,
  "missing": array of the field names you could not read
}

Rules:
- Only report what the patient actually said. If they did not mention something, it is "unknown" or null. Do not infer a pain score from descriptive words.
- The patient may write in English or Afrikaans, or mix them. Read both.
- notesSummary is for the treating practitioner. Plain clinical language, no diagnosis, no advice, no reassurance.
- You are not a safety check. Do not add warnings or urge the patient to seek care. Something else handles that.
- Return the JSON object and nothing else. No prose, no code fences.`;

/** Parse and validate a model response. Returns null rather than throwing. */
export function parseModelExtraction(raw: string): Extraction | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = ExtractionSchema.safeParse(JSON.parse(trimmed.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Deterministic wins on any field it read. The model only fills the gaps. */
export function mergeExtractions(
  deterministic: ExtractionResult,
  model: Extraction | null,
): ExtractionResult {
  if (!model) return deterministic;

  const merged: Extraction = {
    painScore: deterministic.painScore ?? model.painScore,
    trend: deterministic.trend !== "unknown" ? deterministic.trend : model.trend,
    exerciseAdherence:
      deterministic.exerciseAdherence !== "unknown"
        ? deterministic.exerciseAdherence
        : model.exerciseAdherence,
    sleepQuality:
      deterministic.sleepQuality !== "unknown"
        ? deterministic.sleepQuality
        : model.sleepQuality,
    notesSummary: model.notesSummary,
    confidence: Math.min(deterministic.confidence || 1, model.confidence),
    missing: [],
  };

  merged.missing = (
    ["painScore", "trend", "exerciseAdherence", "sleepQuality"] as const
  ).filter((field) =>
    field === "painScore" ? merged.painScore === null : merged[field] === "unknown",
  );

  return { ...merged, rawText: deterministic.rawText, source: "model" };
}
