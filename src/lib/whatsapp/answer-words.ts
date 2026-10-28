/**
 * Reading answers people actually type (28 Oct 2026). Found in the Test Lab:
 * "slept well", "low" and "did all of them" were asked again, and "pain 1,
 * slept 4, energy 4, stress 1, did all my exercises" only kept the pain.
 *
 * Pure and deterministic, so it is instant and free. Claude still handles
 * anything this can't read. English and Afrikaans.
 */

export type ScaleKind = "sleep" | "energy" | "stress";

const clean = (t: string) =>
  String(t ?? "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[.!?]+$/g, "")
    .trim();

/** Ordered: the first matching rule wins, so "very" and "not" come first. */
const SCALE_WORDS: Record<ScaleKind, Array<[RegExp, number]>> = {
  sleep: [
    [/\b(not (great|good|well|too well|so well|the best)|nie (lekker|goed))\b/, 2],
    [
      /\b(didn'?t sleep|no sleep|barely|hardly|terribl[ey]|awful|horribl[ey]|very (poorly|badly|bad)|baie sleg|glad nie)\b/,
      1,
    ],
    [
      /\b(very well|great|amazing|excellent|brilliant|like a baby|like a log|perfect|baie goed|uitstekend)\b/,
      5,
    ],
    [
      /\b(not (great|good|well|too well)|poorly|badly|bad|rough|restless|broken|on and off|sleg|nie lekker)\b/,
      2,
    ],
    [/\b(ok(ay)?|alright|average|so-?so|meh|fair|reasonable|not bad|redelik|orraait|oukei)\b/, 3],
    [/\b(well|good|fine|decent|solid|lekker|goed)\b/, 4],
  ],
  energy: [
    [/\b(not (great|good|much|high)|nie (lekker|goed))\b/, 2],
    [/\b(very low|exhausted|drained|wiped|shattered|no energy|dead|baie moeg|pootuit)\b/, 1],
    [/\b(very high|great|amazing|full of energy|energetic|buzzing|excellent|baie goed)\b/, 5],
    [/\b(not (great|good|much)|low|tired|flat|sluggish|meh|moeg|laag)\b/, 2],
    [/\b(ok(ay)?|alright|average|normal|so-?so|fair|not bad|redelik)\b/, 3],
    [/\b(high|good|decent|fine|well|goed|hoog)\b/, 4],
  ],
  stress: [
    [/\b(very stressed|very high|overwhelmed|panick(ing|ed)|through the roof|baie gestres)\b/, 5],
    [/\b(very calm|no stress|not stressed|relaxed|chilled|zen|baie kalm)\b/, 1],
    [/\b(stressed|high|busy|anxious|tense|gestres|hoog)\b/, 4],
    [/\b(calm|low|not (much|really)|a little|little|bit|kalm|laag)\b/, 2],
    [/\b(ok(ay)?|moderate|average|normal|so-?so|redelik)\b/, 3],
  ],
};

/** A word answer to one 1 to 5 question, or null. Short messages only. */
export function scaleFromWords(text: string, kind: ScaleKind): number | null {
  const t = clean(text);
  if (!t || t.split(/\s+/).length > 10) return null;
  const leading = t.match(/^([1-5])\b/);
  if (leading) return Number(leading[1]);
  for (const [re, n] of SCALE_WORDS[kind]) if (re.test(t)) return n;
  return null;
}

export function adherenceFromWords(text: string): "all" | "most" | "some" | "none" | null {
  const t = clean(text);
  if (!t || t.split(/\s+/).length > 14) return null;
  // Only an amount on its own, or an amount about the exercises. "I did some
  // walking" is about something else and goes to the notes.
  const leftover = t
    .replace(
      /\b(i|did|do|done|didn'?t|did not|got|get|to|managed|of|them|it|they|all|most|some|none|nothing|no|the|my|a|few|half|nearly|almost|every|one|everything|lot|yes|yep|mostly|just|only|couple|bit|today|yesterday|this|week|so|far|exercises?|programme|program|rehab|home|work|homework|stretches|oefeninge|alles|al|die|meeste|sommige|party|niks|geen|ek|het|gedoen)\b/g,
      " ",
    )
    .replace(/[^a-z]/g, "")
    .trim();
  if (leftover) return null;
  if (/\b(none|nothing|didn'?t (do|get to)|did not|no exercises|skipped|niks|geen)\b/.test(t))
    return "none";
  if (/\b(all|every(thing| one)|the lot|alles|al die)\b/.test(t)) return "all";
  if (/\b(most|nearly all|almost all|mostly|meeste)\b/.test(t)) return "most";
  if (/\b(some|a few|half|a couple|bit|sommige|party)\b/.test(t)) return "some";
  return null;
}

export interface MultiAnswer {
  pain?: number;
  sleep?: number;
  energy?: number;
  stress?: number;
  adherence?: "all" | "most" | "some" | "none";
}

/**
 * Several labelled answers in one message: "pain 1, slept 4, energy is ok,
 * stress low, did all my exercises". Each needs its label, so a bare "4"
 * is never guessed here.
 */
export function readMulti(text: string): MultiAnswer {
  const t = clean(text);
  const out: MultiAnswer = {};
  if (!t) return out;
  const parts = t
    .split(/[,;\n]|\band\b|\ben\b/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const p of parts) {
    const painN = p.match(
      /\b(?:pain|pyn|sore(?:ness)?|knee|back|shoulder|ankle|hip|neck)\b\D{0,14}?\b(10|[0-9])\b(?:\s*\/\s*10)?/,
    );
    if (painN && out.pain === undefined) {
      out.pain = Number(painN[1]);
      continue;
    }
    if (/\b(sleep|slept|slaap|geslaap)\b/.test(p) && out.sleep === undefined) {
      const n = p.match(/\b([1-5])\b/);
      const v = n
        ? Number(n[1])
        : scaleFromWords(p.replace(/\b(i |sleep|slept|slaap|geslaap|was|is)\b/g, " "), "sleep");
      if (v != null) out.sleep = v;
      continue;
    }
    if (/\b(energy|energie)\b/.test(p) && out.energy === undefined) {
      const n = p.match(/\b([1-5])\b/);
      const v = n
        ? Number(n[1])
        : scaleFromWords(p.replace(/\b(energy|energie|is|was|my)\b/g, " "), "energy");
      if (v != null) out.energy = v;
      continue;
    }
    if (/\b(stress|stressed|gestres|spanning)\b/.test(p) && out.stress === undefined) {
      const n = p.match(/\b([1-5])\b/);
      const v = n
        ? Number(n[1])
        : scaleFromWords(p.replace(/\b(stress|is|was|my)\b/g, " "), "stress");
      if (v != null) out.stress = v;
      continue;
    }
    if (
      /\b(exercises?|programme|program|rehab|oefeninge|home work|homework)\b/.test(p) &&
      !out.adherence
    ) {
      const a = adherenceFromWords(p);
      if (a) out.adherence = a;
    }
  }
  return out;
}

export function multiCount(m: MultiAnswer): number {
  return Object.values(m).filter((v) => v !== undefined).length;
}

/** "pain 1, sleep 4, energy 4, stress 1 and all your exercises" */
export function describeMulti(m: MultiAnswer): string {
  const bits = [
    m.pain !== undefined ? `pain ${m.pain}` : null,
    m.sleep !== undefined ? `sleep ${m.sleep}` : null,
    m.energy !== undefined ? `energy ${m.energy}` : null,
    m.stress !== undefined ? `stress ${m.stress}` : null,
    m.adherence
      ? `${m.adherence === "none" ? "no" : m.adherence === "all" ? "all your" : m.adherence + " of your"} exercises`
      : null,
  ].filter(Boolean) as string[];
  if (bits.length <= 1) return bits.join("");
  return `${bits.slice(0, -1).join(", ")} and ${bits[bits.length - 1]}`;
}

export function isGreeting(text: string): boolean {
  return /^(hi|hey|hello|hallo|howzit|molo|molweni|sawubona|good (morning|afternoon|evening)|morning|evening|goeie (more|môre|middag|aand)|hi buddy|hey buddy|hello buddy)[\s!.,?]*(buddy)?[\s!.?]*$/i.test(
    String(text ?? "").trim(),
  );
}
