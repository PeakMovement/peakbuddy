/**
 * One WhatsApp bubble, read without a model.
 * Slang and mixed language are understood. Nothing here writes a reply.
 * A missed adherence is left empty. It is never stored as "none".
 */

export type ScaleField = "pain" | "sleep" | "energy" | "stress";
export type AdherenceValue = "all" | "most" | "some" | "none";

export interface FieldScore {
  value: number;
  how: "digit" | "word" | "emoji";
}

export interface BubbleCorrection {
  field: ScaleField | null;
  value: number;
  clear: boolean;
}

export type BubbleAside =
  | { kind: "booking" }
  | { kind: "appointment" }
  | { kind: "programme" }
  | { kind: "practice" }
  | { kind: "clinical" }
  | { kind: "pause" }
  | { kind: "wearable" }
  | { kind: "help" };

export interface BubbleRead {
  pain: FieldScore | null;
  sleep: FieldScore | null;
  energy: FieldScore | null;
  stress: FieldScore | null;
  adherence: { value: AdherenceValue; how: "digit" | "word" } | null;
  notes: string[];
  aside: BubbleAside | null;
  correction: BubbleCorrection | null;
  defer: { when: "later" | "busy" | "tonight" | "soon"; time: string | null } | null;
  tone: "neutral" | "frustrated" | "celebration";
  distress: boolean;
  ambiguous: boolean;
  /** The two numbers that made the bubble ambiguous, in the order they appeared. */
  ambiguousNumbers: number[];
  greeting: boolean;
  smallTalk: boolean;
  saveNow: boolean;
  skip: boolean;
}

const EMPTY: BubbleRead = {
  pain: null,
  sleep: null,
  energy: null,
  stress: null,
  adherence: null,
  notes: [],
  aside: null,
  correction: null,
  defer: null,
  tone: "neutral",
  distress: false,
  ambiguous: false,
  ambiguousNumbers: [],
  greeting: false,
  smallTalk: false,
  saveNow: false,
  skip: false,
};

function clampPain(n: number): number | null {
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : null;
}
function clamp5(n: number): number | null {
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

const WORD_NUM: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  nul: 0, een: 1, twee: 2, drie: 3, vier: 4, vyf: 5, ses: 6, sewe: 7, agt: 8, nege: 9, tien: 10,
};

function wordNum(text: string): number | null {
  const keys = Object.keys(WORD_NUM).join("|");
  const m = text.toLowerCase().match(new RegExp(`\\b(${keys})\\b`));
  return m ? WORD_NUM[m[1]] : null;
}

const PAIN_EMOJI: Record<string, number> = { "😭": 10, "💀": 10, "😫": 8, "😩": 8, "😣": 8, "🤕": 6, "😕": 5, "😐": 4, "🙂": 2, "😊": 2, "😁": 0 };

export function readCheckinBubble(
  text: string,
  opts?: {
    pending?: ScaleField | "adherence" | "notes" | null;
    replyId?: string | null;
    quoted?: string | null;
  },
): BubbleRead {
  const original = (text ?? "").replace(/\s+/g, " ").trim();
  const pending = opts?.pending ?? fieldFromPendingReply(opts?.replyId) ?? null;
  const out: BubbleRead = { ...EMPTY, notes: [] };
  if (!original && !opts?.replyId) return out;

  const lower = original.toLowerCase().replace(/[’']/g, "'");
  out.distress = /\b(not coping|can'?t cope|cannot cope|feel hopeless|so depressed|breaking down)\b/i.test(
    lower,
  );
  if (/\b(useless|annoying|waste of time|this bot|so frustrated|eish)\b/i.test(lower)) {
    out.tone = "frustrated";
  }
  if (/\b(lekker|smashed|nailed|personal best|\bpb\b|proud|yay)\b/i.test(lower) || /🎉/.test(original)) {
    if (out.tone === "neutral") out.tone = "celebration";
  }
  out.greeting = /^(hi|hello|hey|howzit|hallo|morning|evening|good morning)[.!]*$/i.test(lower);
  out.smallTalk =
    out.greeting ||
    /^(sharp|ja nee|lekker|cool|thanks|thank you|dankie|cheers|how'?s it|whats good)[.!]*$/i.test(lower);
  out.saveNow = /^(save|save it|save that|that'?s all|thats all|nothing else|nothing to add|all good)[.!]*$/i.test(
    lower,
  );
  out.skip = /^(skip|skip that|pass|don'?t know|not sure)[.!]*$/i.test(lower);

  if (/^(later|not now|busy now|i'?m busy|im busy|busy|now now|just now)[.!]*$/i.test(lower)) {
    out.defer = {
      when: /now now|just now/.test(lower) ? "soon" : /busy/.test(lower) ? "busy" : "later",
      time: /now now|just now/.test(lower) ? null : null,
    };
  }
  if (/\bremind me tonight\b/i.test(lower) || /^tonight[.!]*$/i.test(lower)) {
    out.defer = { when: "tonight", time: "18:00" };
  }

  const aside = readAside(lower);
  if (aside) out.aside = aside;

  const correction = readCorrection(lower, pending);
  if (correction) out.correction = correction;

  const tapped = scoreFromReply(opts?.replyId);
  if (tapped) {
    if (tapped.kind === "scale") out[tapped.field] = { value: tapped.value, how: "digit" };
    if (tapped.kind === "adherence") out.adherence = { value: tapped.value, how: "digit" };
    return out;
  }

  const quotedField = fieldFromQuoted(opts?.quoted);
  const focus = quotedField ?? pending;

  assignScales(out, original, lower, focus);
  out.adherence = readAdherence(lower, opts?.replyId, focus === "adherence");

  if (!out.pain && !out.sleep && !out.energy && !out.stress && !out.adherence) {
    const bare = bareDigit(lower);
    if (bare != null && focus && focus !== "notes" && focus !== "adherence") {
      const value = focus === "pain" ? clampPain(bare) : clamp5(bare);
      if (value != null) out[focus] = { value, how: "digit" };
    } else if (bare != null && !focus) {
      const pain = clampPain(bare);
      if (pain != null && lower.split(/\s+/).length <= 3) out.pain = { value: pain, how: "digit" };
    }
  }

  if (countScores(out) === 0) {
    const nums = [...lower.matchAll(/\b(\d{1,2})\b/g)].map((m) => Number(m[1]));
    const plausible = nums.filter((n) => n >= 0 && n <= 10);
    if (plausible.length >= 2 && !/\bpain\b|\bsleep\b|\benergy\b|\bstress\b/.test(lower)) {
      out.ambiguous = true;
      out.ambiguousNumbers = plausible.slice(0, 2);
    }
  }

  out.notes = noteFragments(original, out);
  return out;
}

function countScores(out: BubbleRead): number {
  return [out.pain, out.sleep, out.energy, out.stress, out.adherence].filter(Boolean).length;
}

function scoreFromReply(replyId?: string | null):
  | { kind: "scale"; field: ScaleField; value: number }
  | { kind: "adherence"; value: AdherenceValue }
  | null {
  if (!replyId) return null;
  const amb = replyId.match(/^amb_(pain|sleep|energy|stress)_(\d{1,2})$/);
  if (amb) {
    const field = amb[1] as ScaleField;
    const n = Number(amb[2]);
    const value = field === "pain" ? clampPain(n) : clamp5(n);
    return value == null ? null : { kind: "scale", field, value };
  }
  const pain = replyId.match(/^pain_(\d{1,2})$/);
  if (pain) {
    const value = clampPain(Number(pain[1]));
    return value == null ? null : { kind: "scale", field: "pain", value };
  }
  const scale = replyId.match(/^w(sleep|energy|stress)_(\d)$/);
  if (scale) {
    const field = scale[1] as ScaleField;
    const value = clamp5(Number(scale[2]));
    return value == null ? null : { kind: "scale", field, value };
  }
  if (replyId === "adh_all" || replyId === "adh_most" || replyId === "adh_some" || replyId === "adh_none") {
    return { kind: "adherence", value: replyId.slice(4) as AdherenceValue };
  }
  return null;
}

function fieldFromPendingReply(replyId?: string | null): ScaleField | "adherence" | null {
  if (!replyId) return null;
  if (replyId.startsWith("pain_")) return "pain";
  if (replyId.startsWith("wsleep_")) return "sleep";
  if (replyId.startsWith("wenergy_")) return "energy";
  if (replyId.startsWith("wstress_")) return "stress";
  if (replyId.startsWith("adh_")) return "adherence";
  return null;
}

function fieldFromQuoted(quoted?: string | null): ScaleField | "adherence" | "notes" | null {
  const t = (quoted ?? "").toLowerCase();
  if (!t) return null;
  if (/\bpain\b/.test(t)) return "pain";
  if (/\bsleep\b|\bslept\b/.test(t)) return "sleep";
  if (/\benergy\b/.test(t)) return "energy";
  if (/\bstress/.test(t)) return "stress";
  if (/programme|exercises did you/.test(t)) return "adherence";
  return null;
}

function bareDigit(lower: string): number | null {
  const m = lower.match(/^(?:about\s+)?(?:a\s+)?(\d{1,2})(?:\s*\/\s*10)?[.!]*$/);
  if (m) return Number(m[1]);
  const w = wordNum(lower);
  if (w != null && lower.split(/\s+/).length <= 4) return w;
  if (/^worst([ ]pain)?[.!]*$/.test(lower)) return 10;
  return null;
}

function readAside(lower: string): BubbleAside | null {
  if (/\b(what time do you close|when do you close|opening hours|what are your hours|where are you|how much|price|fees)\b/.test(lower)) {
    return { kind: "practice" };
  }
  if (/\b(what time is my appointment|when is my (next )?(appointment|session)|my next appointment)\b/.test(lower)) {
    return { kind: "appointment" };
  }
  if (/\b(book|booking|reschedule|move (my )?(thursday|tuesday|monday|wednesday|friday|appointment)|can i move)\b/.test(lower)) {
    return { kind: "booking" };
  }
  if (/\b(what exercises|home programme|home program|my programme|my program)\b/.test(lower) && !/\bdid\b/.test(lower)) {
    return { kind: "programme" };
  }
  if (/\b(should i|is it normal|is it ok to|painkiller|ibuprofen|ice it|can i run)\b/.test(lower)) {
    return { kind: "clinical" };
  }
  if (/\b(connect my watch|link my garmin|my watch)\b/.test(lower)) return { kind: "wearable" };
  if (/^(help|menu|what can you do)[.?]*$/.test(lower)) return { kind: "help" };
  if (/\b(stop for now|pause|chat later|not the check in)\b/.test(lower)) return { kind: "pause" };
  return null;
}

function readCorrection(lower: string, pending: ScaleField | "adherence" | "notes" | null): BubbleCorrection | null {
  const named = lower.match(
    /\b(pain|sleep|energy|stress)\s+(?:was|is)\s+(\d{1,2}|ten|worst)\s+not\s+(\d{1,2}|ten|worst)\b/,
  );
  if (named) {
    const field = named[1] as ScaleField;
    const value = named[2] === "worst" || named[2] === "ten" ? 10 : Number(named[2]);
    const n = field === "pain" ? clampPain(value) : clamp5(value);
    if (n == null) return null;
    return { field, value: n, clear: false };
  }
  const meant = lower.match(/\b(?:i meant|meant|rather|make it)\s+(\d{1,2}|ten|worst)\b/);
  if (meant) {
    const raw = meant[1] === "worst" || meant[1] === "ten" ? 10 : Number(meant[1]);
    const field = pending === "adherence" || pending === "notes" ? null : pending;
    const value = field === "pain" || field == null ? clampPain(raw) : clamp5(raw);
    if (value == null) return null;
    return { field, value, clear: false };
  }
  return null;
}

function assignScales(out: BubbleRead, original: string, lower: string, focus: string | null): void {
  const painDigit = labeledNumber(lower, "pain");
  if (painDigit != null) out.pain = { value: painDigit, how: "digit" };
  else {
    const word = painWord(lower, original, focus === "pain");
    if (word) out.pain = word;
  }

  const sleepDigit = labeledScale(lower, "sleep");
  if (sleepDigit != null) out.sleep = { value: sleepDigit, how: "digit" };
  else {
    const word = sleepWord(lower);
    if (word) out.sleep = word;
  }

  const energyDigit = labeledScale(lower, "energy");
  if (energyDigit != null) out.energy = { value: energyDigit, how: "digit" };
  else {
    const word = energyWord(lower);
    if (word) out.energy = word;
  }

  const stressDigit = labeledScale(lower, "stress");
  if (stressDigit != null) out.stress = { value: stressDigit, how: "digit" };
  else {
    const word = stressWord(lower);
    if (word) out.stress = word;
  }

  if (!out.pain && /worst/.test(lower) && (/\bpain\b/.test(lower) || focus === "pain")) {
    out.pain = { value: 10, how: "word" };
  }
}

function labeledNumber(lower: string, field: "pain"): number | null {
  const after = lower.match(new RegExp(`\\b${field}\\b[^0-9]{0,24}(\\d{1,2})\\b`));
  if (after) return clampPain(Number(after[1]));
  const before = lower.match(new RegExp(`\\b(\\d{1,2})\\b[^.]{0,16}\\b${field}\\b`));
  if (before) return clampPain(Number(before[1]));
  const outOf = lower.match(/\b(\d{1,2})\s*(?:\/|out of)\s*10\b/);
  if (outOf && (field === "pain" || /\bpain\b/.test(lower))) return clampPain(Number(outOf[1]));
  return null;
}

function labeledScale(lower: string, field: "sleep" | "energy" | "stress"): number | null {
  const after = lower.match(new RegExp(`\\b${field}\\b[^0-9]{0,16}(\\d)\\b`));
  if (after) return clamp5(Number(after[1]));
  return null;
}

function painWord(lower: string, original: string, focused: boolean): FieldScore | null {
  for (const [emoji, value] of Object.entries(PAIN_EMOJI)) {
    if (original.includes(emoji) && (focused || /\bpain\b|\bsore\b/.test(lower) || original.trim() === emoji)) {
      return { value, how: "emoji" };
    }
  }
  if (/\b(no pain|pain free|nothing hurting)\b/.test(lower)) return { value: 0, how: "word" };
  if (/\b(worst pain|pain is worst|as bad as it gets)\b/.test(lower)) return { value: 10, how: "word" };
  if (/\b(kak|hectic|terrible|awful|unbearable)\b/.test(lower) && /\b(pain|sore|knee|back|shoulder|hip|ankle)\b/.test(lower)) {
    return { value: 8, how: "word" };
  }
  if (focused && /^(kak|terrible|awful|hectic)[.!]*$/.test(lower)) return { value: 8, how: "word" };
  if (/\bpain\b/.test(lower) && /\b(fine|lekker|grand|not bad)\b/.test(lower)) return { value: 2, how: "word" };
  const spoken = wordNum(lower);
  if (spoken != null && /\bpain\b/.test(lower) && !/\d/.test(lower)) {
    const n = clampPain(spoken);
    if (n != null) return { value: n, how: "word" };
  }
  return null;
}

function sleepWord(lower: string): FieldScore | null {
  if (!/\b(sleep|slept|night)\b/.test(lower) && !/\b(baie sleg|sleg geslaap)\b/.test(lower)) return null;
  if (/\b(didn'?t sleep|no sleep|awake all night|baie sleg)\b/.test(lower)) return { value: 1, how: "word" };
  if (/\b(badly|terrible|awful|poorly|rough|kak|sleg|insomnia)\b/.test(lower)) return { value: 2, how: "word" };
  if (/\b(okay|ok|fine|average|meh|so so)\b/.test(lower)) return { value: 3, how: "word" };
  if (/\b(like a baby|very well|slept great|excellent)\b/.test(lower)) return { value: 5, how: "word" };
  if (/\b(well|good|lekker|great|goed)\b/.test(lower)) return { value: 4, how: "word" };
  return null;
}

function energyWord(lower: string): FieldScore | null {
  if (!/\b(energy|energ|tired|exhausted|flat|drained|moeg|moe)\b/.test(lower)) return null;
  if (/\b(no energy|dead|empty|very low)\b/.test(lower)) return { value: 1, how: "word" };
  if (/\b(low|flat|exhausted|drained|tired|kak|moeg|moe)\b/.test(lower)) return { value: 2, how: "word" };
  if (/\b(okay|ok|fine|average)\b/.test(lower)) return { value: 3, how: "word" };
  if (/\b(high|buzzing|wired|great energy)\b/.test(lower)) return { value: 5, how: "word" };
  if (/\b(good|lekker)\b/.test(lower)) return { value: 4, how: "word" };
  return null;
}

function stressWord(lower: string): FieldScore | null {
  if (!/\b(stress|stressed|calm|anxious|overwhelmed|chilled|relaxed)\b/.test(lower)) return null;
  if (/\b(very stressed|panic|overwhelmed)\b/.test(lower)) return { value: 5, how: "word" };
  if (/\b(stressed|anxious|hectic)\b/.test(lower)) return { value: 4, how: "word" };
  if (/\b(okay|ok|fine)\b/.test(lower)) return { value: 3, how: "word" };
  if (/\b(very calm|zen)\b/.test(lower)) return { value: 1, how: "word" };
  if (/\b(calm|chilled|relaxed)\b/.test(lower)) return { value: 2, how: "word" };
  return null;
}

function readAdherence(
  lower: string,
  replyId: string | null | undefined,
  focused: boolean,
): BubbleRead["adherence"] {
  if (replyId === "adh_all") return { value: "all", how: "digit" };
  if (replyId === "adh_most") return { value: "most", how: "digit" };
  if (replyId === "adh_some") return { value: "some", how: "digit" };
  if (replyId === "adh_none") return { value: "none", how: "digit" };
  if (/\b(did them all|all of them|the whole programme|every exercise|did everything)\b/.test(lower)) {
    return { value: "all", how: "word" };
  }
  if (/\b(most of|did most|majority)\b/.test(lower)) return { value: "most", how: "word" };
  if (/\b(some of|a few|did some|half of)\b/.test(lower)) return { value: "some", how: "word" };
  if (/\b(none of them|didn'?t do (any|them|the exercises)|skipped (them|all|the programme)|no exercises)\b/.test(lower)) {
    return { value: "none", how: "word" };
  }
  if (focused && /^(all|most|some|none)[.!]*$/.test(lower)) {
    return { value: lower.replace(/[.!]/g, "") as AdherenceValue, how: "digit" };
  }
  return null;
}

function noteFragments(original: string, read: BubbleRead): string[] {
  const parts = original
    .split(/,|\.|;|\n|\band\b|\bbut\b/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 3);
  const notes: string[] = [];
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (/^(hi|hello|hey|howzit|thanks|thank you|sharp|ja nee|eish|lekker)[.!]*$/i.test(lower)) continue;
    if (/\b(pain|sleep|slept|energy|stress|programme|exercises did|most of|remind me|book|appointment)\b/i.test(lower)) {
      continue;
    }
    if (/^\d{1,2}$/.test(lower)) continue;
    if (read.defer && /later|busy|tonight|just now|now now/.test(lower)) continue;
    notes.push(part.slice(0, 180));
  }
  return notes.slice(0, 3);
}

export function needsConfirm(read: BubbleRead): boolean {
  const scores = [read.pain, read.sleep, read.energy, read.stress].filter(Boolean) as FieldScore[];
  if (read.adherence?.how === "word") return true;
  if (scores.some((s) => s.how !== "digit")) return true;
  return scores.length > 1;
}

export function summaryLine(draft: {
  pain?: number;
  sleep?: number;
  energy?: number;
  stress?: number;
  adherence?: AdherenceValue;
  notes?: string[];
}): string {
  const bits: string[] = [];
  if (typeof draft.pain === "number") bits.push(`pain ${draft.pain}`);
  if (typeof draft.sleep === "number") bits.push(`sleep ${draft.sleep}`);
  if (typeof draft.energy === "number") bits.push(`energy ${draft.energy}`);
  if (typeof draft.stress === "number") bits.push(`stress ${draft.stress}`);
  if (draft.adherence) bits.push(`${draft.adherence} of the programme`);
  const note = draft.notes?.find((n) => n.trim());
  if (note) bits.push(`the note about ${note.slice(0, 80)}`);
  if (!bits.length) return "I don't have a score to save yet.";
  return `I'll save ${bits.join(", ")}. Anything else, or should I save that?`;
}
