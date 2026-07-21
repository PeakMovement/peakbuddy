import { supabase } from "./supabase";

export type UrgencyTier = "emergency" | "urgent" | "soon" | "monitor" | "routine";

export type RedFlagCategory =
  | "cardiac"
  | "neuro"
  | "cauda_equina"
  | "systemic"
  | "mental_health"
  | "infection"
  | "msk_alarm"
  | "respiratory"
  | "general";

export interface TriageResult {
  urgency: UrgencyTier;
  severity: number;
  red_flag_detected: boolean;
  suggested_next_step: string;
  rationale: string;
  red_flags: string[];
  categories: string[];
  red_flag_category: RedFlagCategory | null;
  differential: Array<{ explanation: string; likelihood: "high" | "medium" | "low" }>;
  recommended_questions: string[];
  escalation_reason: "context" | "current_text" | "both" | "none";
  negation_detected: boolean;
  attribution_detected: boolean;
  should_notify_practitioner: boolean;
  confidence: number;
  source: "hard_override" | "ai_primary" | "ai_keyword_escalated" | "keyword_fallback";
}

export interface ClientRiskContext {
  avgPainLast3: number;
  painTrend: "rising" | "falling" | "stable";
  flaggedCountLast7d: number;
  worseChangeRecent: boolean;
  checkInCount: number;
  // Extended context (built server-side when clientId is provided to the API)
  assignedProgram?: string | null;
  knownConditions?: string | null;
  recentSymptoms?: Array<{ note: string; pain: number | null; flagged: boolean; days_ago: number }>;
  previousRedFlags?: Array<{ category: string; days_ago: number }>;
  daysSinceLastCheckIn?: number | null;
  painChange7d?: number | null;
}

export interface RealTimeResult {
  detected: boolean;
  urgency: UrgencyTier;
  severity: number;
  source: "hard_override" | "keyword";
  matchedTerms: string[];
  category: RedFlagCategory | null;
}

const URGENCY_RANK: Record<UrgencyTier, number> = {
  routine: 0,
  monitor: 1,
  soon: 2,
  urgent: 3,
  emergency: 4,
};

// ─────────────────────────────────────────────────────────────────────────────
// HARD OVERRIDES — immediate emergency phrases (English + a few SA / lay terms)
// ─────────────────────────────────────────────────────────────────────────────
const HARD_OVERRIDE_PHRASES: Array<{ term: string; category: RedFlagCategory }> = [
  // Cardiac
  { term: "chest pain", category: "cardiac" },
  { term: "heart attack", category: "cardiac" },
  { term: "myocardial", category: "cardiac" },
  { term: "borspyn", category: "cardiac" }, // Afrikaans: chest pain
  // Respiratory
  { term: "can't breathe", category: "respiratory" },
  { term: "cant breathe", category: "respiratory" },
  { term: "cannot breathe", category: "respiratory" },
  { term: "not breathing", category: "respiratory" },
  { term: "stopped breathing", category: "respiratory" },
  { term: "difficulty breathing", category: "respiratory" },
  { term: "kortasem", category: "respiratory" }, // Afrikaans: short of breath
  { term: "throat closing", category: "respiratory" },
  { term: "anaphylaxis", category: "respiratory" },
  { term: "severe allergic reaction", category: "respiratory" },
  // Neuro / stroke
  { term: "stroke", category: "neuro" },
  { term: "face drooping", category: "neuro" },
  { term: "arm weakness", category: "neuro" },
  { term: "speech difficulty", category: "neuro" },
  { term: "slurred speech", category: "neuro" },
  { term: "sudden confusion", category: "neuro" },
  { term: "paralysis", category: "neuro" },
  { term: "paralyzed", category: "neuro" },
  { term: "paralysed", category: "neuro" },
  { term: "worst headache of my life", category: "neuro" },
  { term: "thunderclap headache", category: "neuro" },
  { term: "sudden vision loss", category: "neuro" },
  { term: "sudden blindness", category: "neuro" },
  { term: "seizure", category: "neuro" },
  { term: "fitting", category: "neuro" },
  // Cauda equina
  { term: "cauda equina", category: "cauda_equina" },
  { term: "saddle anaesthesia", category: "cauda_equina" },
  { term: "saddle anesthesia", category: "cauda_equina" },
  { term: "loss of bowel control", category: "cauda_equina" },
  { term: "loss of bladder control", category: "cauda_equina" },
  // Collapse / trauma
  { term: "collapsed", category: "general" },
  { term: "unconscious", category: "general" },
  { term: "unresponsive", category: "general" },
  { term: "stabbed", category: "general" },
  { term: "gunshot", category: "general" },
  { term: "major trauma", category: "general" },
  // Mental health
  { term: "suicidal", category: "mental_health" },
  { term: "want to kill myself", category: "mental_health" },
  { term: "end my life", category: "mental_health" },
  { term: "no reason to live", category: "mental_health" },
  { term: "overdose", category: "mental_health" },
  { term: "took too many pills", category: "mental_health" },
  // Bleeding
  { term: "eyes bleeding", category: "general" },
  { term: "bleeding from eyes", category: "general" },
  { term: "bleeding out of my eyes", category: "general" },
  { term: "bleeding from my eyes", category: "general" },
  { term: "bleeding from ears", category: "general" },
  { term: "bleeding from my ears", category: "general" },
  { term: "bleeding out of my ears", category: "general" },
  { term: "bleeding from nose", category: "general" },
  { term: "bleeding from my nose", category: "general" },
  { term: "bleeding from mouth", category: "general" },
  { term: "bleeding from my mouth", category: "general" },
  { term: "coughing up blood", category: "respiratory" },
  { term: "vomiting blood", category: "general" },
  { term: "puked blood", category: "general" },
  // ── Afrikaans emergencies (SA market). Only unambiguous, multi-syllable
  //    terms — short/ambiguous words are left to the keyword floor because
  //    matching here is substring-based.
  { term: "hartaanval", category: "cardiac" }, // heart attack
  { term: "beroerte", category: "neuro" }, // stroke
  { term: "stuiptrekking", category: "neuro" }, // seizure/convulsion
  { term: "verlamming", category: "neuro" }, // paralysis
  { term: "verlam", category: "neuro" }, // paralysed
  { term: "bewusteloos", category: "general" }, // unconscious
  { term: "kan nie asemhaal", category: "respiratory" }, // cannot breathe
  { term: "nie asemhaal nie", category: "respiratory" },
  { term: "selfmoord", category: "mental_health" }, // suicide
  { term: "myself doodmaak", category: "mental_health" }, // kill myself
  { term: "bloed opgooi", category: "general" }, // vomiting blood
  { term: "pyn op die bors", category: "cardiac" }, // pain on the chest
];

// ─────────────────────────────────────────────────────────────────────────────
// KEYWORD FLOOR — escalates urgency/severity if AI underrates. Categorised.
// ─────────────────────────────────────────────────────────────────────────────
const KEYWORD_FLOOR_RAW: Array<{
  term: string;
  minUrgency: UrgencyTier;
  minSeverity: number;
  category: RedFlagCategory;
}> = [
  // Neuro
  { term: "numbness", minUrgency: "soon", minSeverity: 5, category: "neuro" },
  { term: "tingling in face", minUrgency: "urgent", minSeverity: 7, category: "neuro" },
  { term: "facial numbness", minUrgency: "urgent", minSeverity: 7, category: "neuro" },
  { term: "weakness in legs", minUrgency: "urgent", minSeverity: 7, category: "neuro" },
  { term: "bilateral leg weakness", minUrgency: "urgent", minSeverity: 8, category: "neuro" },
  { term: "couldnt feel my legs", minUrgency: "urgent", minSeverity: 8, category: "neuro" },
  { term: "couldn't feel my legs", minUrgency: "urgent", minSeverity: 8, category: "neuro" },
  { term: "pins and needles", minUrgency: "monitor", minSeverity: 4, category: "neuro" },
  { term: "pins n needles", minUrgency: "monitor", minSeverity: 4, category: "neuro" },
  { term: "radiating pain", minUrgency: "soon", minSeverity: 5, category: "neuro" },
  // Neuro red flags for radiculopathy / cauda-equina concern in the legs.
  { term: "burning pain", minUrgency: "soon", minSeverity: 6, category: "neuro" },
  { term: "burning sensation", minUrgency: "soon", minSeverity: 6, category: "neuro" },
  { term: "burning in my leg", minUrgency: "soon", minSeverity: 6, category: "neuro" },
  { term: "burning in my legs", minUrgency: "soon", minSeverity: 6, category: "neuro" },
  { term: "burning legs", minUrgency: "soon", minSeverity: 6, category: "neuro" },
  { term: "burning down my leg", minUrgency: "urgent", minSeverity: 7, category: "neuro" },
  { term: "burning down my legs", minUrgency: "urgent", minSeverity: 7, category: "neuro" },
  { term: "pain down my legs", minUrgency: "soon", minSeverity: 6, category: "neuro" },
  { term: "pain down both legs", minUrgency: "urgent", minSeverity: 7, category: "neuro" },
  { term: "radiating down", minUrgency: "soon", minSeverity: 6, category: "neuro" },
  { term: "sciatica", minUrgency: "soon", minSeverity: 6, category: "neuro" },
  { term: "sciatic", minUrgency: "soon", minSeverity: 6, category: "neuro" },
  { term: "gone numb", minUrgency: "soon", minSeverity: 6, category: "neuro" },
  { term: "shooting pain", minUrgency: "soon", minSeverity: 5, category: "neuro" },
  { term: "head splitting", minUrgency: "soon", minSeverity: 6, category: "neuro" },
  { term: "blacking out", minUrgency: "urgent", minSeverity: 7, category: "neuro" },
  { term: "passed out", minUrgency: "urgent", minSeverity: 7, category: "neuro" },
  { term: "fainted", minUrgency: "urgent", minSeverity: 7, category: "neuro" },
  { term: "vision went black", minUrgency: "urgent", minSeverity: 7, category: "neuro" },
  { term: "world spinning", minUrgency: "soon", minSeverity: 5, category: "neuro" },
  { term: "duiselig", minUrgency: "monitor", minSeverity: 4, category: "neuro" }, // dizzy

  // Cardiac
  { term: "palpitations", minUrgency: "soon", minSeverity: 5, category: "cardiac" },
  { term: "racing heart", minUrgency: "soon", minSeverity: 5, category: "cardiac" },
  { term: "irregular heartbeat", minUrgency: "urgent", minSeverity: 7, category: "cardiac" },
  { term: "chest tightness", minUrgency: "urgent", minSeverity: 7, category: "cardiac" },
  { term: "chest pressure", minUrgency: "urgent", minSeverity: 8, category: "cardiac" },
  { term: "left arm pain", minUrgency: "urgent", minSeverity: 7, category: "cardiac" },
  { term: "jaw pain", minUrgency: "soon", minSeverity: 5, category: "cardiac" },

  // Cauda equina
  { term: "bowel control", minUrgency: "emergency", minSeverity: 10, category: "cauda_equina" },
  { term: "bladder control", minUrgency: "emergency", minSeverity: 10, category: "cauda_equina" },
  {
    term: "saddle area numbness",
    minUrgency: "emergency",
    minSeverity: 10,
    category: "cauda_equina",
  },

  // Mental health
  { term: "self harm", minUrgency: "urgent", minSeverity: 8, category: "mental_health" },
  { term: "self-harm", minUrgency: "urgent", minSeverity: 8, category: "mental_health" },
  { term: "hurting myself", minUrgency: "urgent", minSeverity: 8, category: "mental_health" },
  { term: "panic attack", minUrgency: "soon", minSeverity: 6, category: "mental_health" },
  { term: "can't stop crying", minUrgency: "soon", minSeverity: 6, category: "mental_health" },
  { term: "cant stop crying", minUrgency: "soon", minSeverity: 6, category: "mental_health" },
  { term: "hopeless", minUrgency: "soon", minSeverity: 6, category: "mental_health" },
  { term: "hearing voices", minUrgency: "urgent", minSeverity: 8, category: "mental_health" },
  { term: "intrusive thoughts", minUrgency: "soon", minSeverity: 5, category: "mental_health" },

  // Respiratory
  { term: "shortness of breath", minUrgency: "urgent", minSeverity: 7, category: "respiratory" },
  { term: "wheezing", minUrgency: "soon", minSeverity: 5, category: "respiratory" },
  { term: "asthma attack", minUrgency: "urgent", minSeverity: 8, category: "respiratory" },

  // Pain intensity
  { term: "severe pain", minUrgency: "soon", minSeverity: 6, category: "general" },
  { term: "excruciating", minUrgency: "urgent", minSeverity: 7, category: "general" },
  { term: "unbearable pain", minUrgency: "urgent", minSeverity: 7, category: "general" },

  // MSK alarms
  { term: "cannot walk", minUrgency: "urgent", minSeverity: 7, category: "msk_alarm" },
  { term: "unable to walk", minUrgency: "urgent", minSeverity: 7, category: "msk_alarm" },
  { term: "rapidly worsening", minUrgency: "urgent", minSeverity: 7, category: "general" },
  { term: "getting worse quickly", minUrgency: "urgent", minSeverity: 7, category: "general" },
  { term: "frozen shoulder", minUrgency: "soon", minSeverity: 5, category: "msk_alarm" },
  { term: "can't lift arm", minUrgency: "soon", minSeverity: 5, category: "msk_alarm" },
  { term: "cant lift arm", minUrgency: "soon", minSeverity: 5, category: "msk_alarm" },
  { term: "locked neck", minUrgency: "soon", minSeverity: 5, category: "msk_alarm" },
  { term: "knee locked", minUrgency: "soon", minSeverity: 6, category: "msk_alarm" },
  { term: "knee buckled", minUrgency: "soon", minSeverity: 6, category: "msk_alarm" },
  { term: "knee gave out", minUrgency: "soon", minSeverity: 6, category: "msk_alarm" },
  { term: "hip giving way", minUrgency: "soon", minSeverity: 6, category: "msk_alarm" },
  { term: "foot drop", minUrgency: "urgent", minSeverity: 7, category: "neuro" },
  { term: "ankle won't hold", minUrgency: "soon", minSeverity: 5, category: "msk_alarm" },
  { term: "dropping things", minUrgency: "soon", minSeverity: 6, category: "neuro" },
  { term: "grip weakness", minUrgency: "soon", minSeverity: 6, category: "neuro" },

  // Systemic / oncological
  { term: "night sweats", minUrgency: "soon", minSeverity: 5, category: "systemic" },
  { term: "unexplained weight loss", minUrgency: "soon", minSeverity: 5, category: "systemic" },
  { term: "lump", minUrgency: "soon", minSeverity: 5, category: "systemic" },
  { term: "swollen lymph", minUrgency: "soon", minSeverity: 5, category: "systemic" },
  { term: "blood in urine", minUrgency: "urgent", minSeverity: 7, category: "systemic" },
  { term: "blood in stool", minUrgency: "urgent", minSeverity: 7, category: "systemic" },
  { term: "passing blood", minUrgency: "urgent", minSeverity: 7, category: "systemic" },
  { term: "black stool", minUrgency: "urgent", minSeverity: 7, category: "systemic" },
  { term: "tarry stool", minUrgency: "urgent", minSeverity: 7, category: "systemic" },
  { term: "blood in spit", minUrgency: "urgent", minSeverity: 7, category: "respiratory" },

  // Infection
  { term: "fever", minUrgency: "monitor", minSeverity: 4, category: "infection" },
  { term: "neck stiffness", minUrgency: "urgent", minSeverity: 7, category: "infection" },
  { term: "naar", minUrgency: "monitor", minSeverity: 3, category: "general" }, // Afrikaans: nauseous

  // ── Afrikaans / SA lay red-flag terms (substring-matched, so kept distinctive)
  { term: "hartkloppings", minUrgency: "soon", minSeverity: 5, category: "cardiac" }, // palpitations
  { term: "brandende pyn", minUrgency: "soon", minSeverity: 6, category: "neuro" }, // burning pain
  { term: "skietende pyn", minUrgency: "soon", minSeverity: 5, category: "neuro" }, // shooting pain
  { term: "gevoelloos", minUrgency: "soon", minSeverity: 5, category: "neuro" }, // numb
  { term: "verdowing", minUrgency: "soon", minSeverity: 5, category: "neuro" }, // numbness
  { term: "flou word", minUrgency: "urgent", minSeverity: 7, category: "neuro" }, // fainting
  { term: "stywe nek", minUrgency: "urgent", minSeverity: 7, category: "infection" }, // stiff neck
  { term: "hoë koors", minUrgency: "urgent", minSeverity: 7, category: "infection" }, // high fever
  { term: "hoe koors", minUrgency: "urgent", minSeverity: 7, category: "infection" }, // (no diacritic)
  { term: "koors", minUrgency: "monitor", minSeverity: 4, category: "infection" }, // fever
  { term: "bloed in my urine", minUrgency: "urgent", minSeverity: 7, category: "systemic" },
  { term: "bloed in my stoel", minUrgency: "urgent", minSeverity: 7, category: "systemic" }, // blood in stool
  { term: "gewigsverlies", minUrgency: "soon", minSeverity: 5, category: "systemic" }, // weight loss
  { term: "nagsweet", minUrgency: "soon", minSeverity: 5, category: "systemic" }, // night sweats

  // ── Merged upward from the precursor engine — clinically-meaningful terms
  //    Buddy's floor was missing. Deduped against existing terms at build time.
  // Cardiac
  { term: "chest discomfort", minUrgency: "soon", minSeverity: 6, category: "cardiac" },
  { term: "chest heaviness", minUrgency: "soon", minSeverity: 6, category: "cardiac" },
  { term: "cold sweats", minUrgency: "soon", minSeverity: 5, category: "cardiac" },
  { term: "heart pounding", minUrgency: "soon", minSeverity: 5, category: "cardiac" },
  { term: "heart skipping", minUrgency: "soon", minSeverity: 5, category: "cardiac" },
  // Neuro
  { term: "vertigo", minUrgency: "soon", minSeverity: 5, category: "neuro" },
  { term: "double vision", minUrgency: "urgent", minSeverity: 7, category: "neuro" },
  { term: "blurred vision", minUrgency: "soon", minSeverity: 6, category: "neuro" },
  { term: "loss of balance", minUrgency: "urgent", minSeverity: 7, category: "neuro" },
  { term: "loss of coordination", minUrgency: "urgent", minSeverity: 7, category: "neuro" },
  { term: "pinched nerve", minUrgency: "soon", minSeverity: 6, category: "neuro" },
  { term: "trapped nerve", minUrgency: "soon", minSeverity: 6, category: "neuro" },
  { term: "carpal tunnel", minUrgency: "monitor", minSeverity: 4, category: "neuro" },
  // Respiratory
  { term: "shallow breathing", minUrgency: "soon", minSeverity: 5, category: "respiratory" },
  { term: "rapid breathing", minUrgency: "soon", minSeverity: 5, category: "respiratory" },
  { term: "chest congestion", minUrgency: "monitor", minSeverity: 4, category: "respiratory" },
  // Infection
  { term: "high fever", minUrgency: "urgent", minSeverity: 7, category: "infection" },
  { term: "persistent fever", minUrgency: "soon", minSeverity: 6, category: "infection" },
  { term: "spreading rash", minUrgency: "soon", minSeverity: 6, category: "infection" },
  { term: "chills", minUrgency: "monitor", minSeverity: 3, category: "infection" },
  // Systemic / oncological
  { term: "suspicious mole", minUrgency: "soon", minSeverity: 6, category: "systemic" },
  { term: "changing mole", minUrgency: "soon", minSeverity: 6, category: "systemic" },
  { term: "persistent fatigue", minUrgency: "monitor", minSeverity: 4, category: "systemic" },
  // MSK alarms / named injuries
  { term: "acl tear", minUrgency: "soon", minSeverity: 6, category: "msk_alarm" },
  { term: "acl injury", minUrgency: "soon", minSeverity: 6, category: "msk_alarm" },
  { term: "meniscus tear", minUrgency: "soon", minSeverity: 6, category: "msk_alarm" },
  { term: "torn meniscus", minUrgency: "soon", minSeverity: 6, category: "msk_alarm" },
  { term: "torn ligament", minUrgency: "soon", minSeverity: 6, category: "msk_alarm" },
  { term: "ligament tear", minUrgency: "soon", minSeverity: 6, category: "msk_alarm" },
  { term: "rotator cuff tear", minUrgency: "soon", minSeverity: 6, category: "msk_alarm" },
  { term: "rotator cuff", minUrgency: "monitor", minSeverity: 4, category: "msk_alarm" },
  { term: "torn achilles", minUrgency: "urgent", minSeverity: 7, category: "msk_alarm" },
  { term: "achilles rupture", minUrgency: "urgent", minSeverity: 7, category: "msk_alarm" },
  { term: "dislocated", minUrgency: "urgent", minSeverity: 7, category: "msk_alarm" },
  { term: "dislocation", minUrgency: "urgent", minSeverity: 7, category: "msk_alarm" },
  { term: "whiplash", minUrgency: "soon", minSeverity: 6, category: "msk_alarm" },
  { term: "herniated disc", minUrgency: "soon", minSeverity: 6, category: "msk_alarm" },
  { term: "slipped disc", minUrgency: "soon", minSeverity: 6, category: "msk_alarm" },
  { term: "bulging disc", minUrgency: "soon", minSeverity: 5, category: "msk_alarm" },
  { term: "disc herniation", minUrgency: "soon", minSeverity: 5, category: "msk_alarm" },
  { term: "stress fracture", minUrgency: "urgent", minSeverity: 7, category: "msk_alarm" },
  { term: "plantar fasciitis", minUrgency: "monitor", minSeverity: 3, category: "msk_alarm" },
  { term: "tennis elbow", minUrgency: "monitor", minSeverity: 3, category: "msk_alarm" },
  // Mental health
  { term: "depressed", minUrgency: "soon", minSeverity: 5, category: "mental_health" },
  { term: "depression", minUrgency: "soon", minSeverity: 5, category: "mental_health" },
];

// ─────────────────────────────────────────────────────────────────────────────
// COMBINATION FLOOR — pairs of moderate terms that together escalate. Runs
// AFTER the single-term keyword floor and can only escalate (never downgrade).
// Each entry: if ALL `terms` appear (non-negated, non-attributed) → apply
// `minUrgency` / `minSeverity`. Ordered high-to-low; first match wins.
// ─────────────────────────────────────────────────────────────────────────────
export const COMBINATION_FLOOR: Array<{
  id: string;
  terms: string[];
  minUrgency: UrgencyTier;
  minSeverity: number;
  category: RedFlagCategory;
}> = [
  // Meningitis triad
  { id: "meningitis_triad", terms: ["fever", "neck stiffness"], minUrgency: "urgent", minSeverity: 9, category: "infection" },
  { id: "meningitis_stiff", terms: ["fever", "stiff neck"], minUrgency: "urgent", minSeverity: 9, category: "infection" },
  { id: "meningitis_af", terms: ["koors", "stywe nek"], minUrgency: "urgent", minSeverity: 9, category: "infection" },
  // Classic cardiac cluster
  { id: "cardiac_cluster_arm", terms: ["chest", "left arm"], minUrgency: "urgent", minSeverity: 9, category: "cardiac" },
  { id: "cardiac_cluster_jaw", terms: ["chest", "jaw pain"], minUrgency: "urgent", minSeverity: 8, category: "cardiac" },
  { id: "cardiac_cluster_sweat", terms: ["chest", "cold sweats"], minUrgency: "urgent", minSeverity: 8, category: "cardiac" },
  { id: "cardiac_cluster_breath", terms: ["chest tightness", "shortness of breath"], minUrgency: "urgent", minSeverity: 8, category: "cardiac" },
  // Cauda equina cluster
  { id: "cauda_cluster", terms: ["numbness", "bladder"], minUrgency: "emergency", minSeverity: 10, category: "cauda_equina" },
  { id: "cauda_cluster_bowel", terms: ["numbness", "bowel"], minUrgency: "emergency", minSeverity: 10, category: "cauda_equina" },
  { id: "cauda_bilateral", terms: ["both legs", "weakness"], minUrgency: "urgent", minSeverity: 9, category: "cauda_equina" },
  // Systemic / oncological cluster
  { id: "systemic_weight_sweat", terms: ["weight loss", "night sweats"], minUrgency: "urgent", minSeverity: 7, category: "systemic" },
  { id: "systemic_weight_fatigue", terms: ["weight loss", "fatigue"], minUrgency: "soon", minSeverity: 6, category: "systemic" },
  // Stroke FAST cluster
  { id: "stroke_fast", terms: ["face", "arm weakness"], minUrgency: "urgent", minSeverity: 9, category: "neuro" },
  { id: "stroke_speech_weak", terms: ["slurred speech", "weakness"], minUrgency: "urgent", minSeverity: 9, category: "neuro" },
  // Respiratory infection alarm
  { id: "resp_infection", terms: ["fever", "cough", "shortness of breath"], minUrgency: "urgent", minSeverity: 8, category: "respiratory" },
];

export function applyCombinationFloor(
  text: string,
  currentUrgency: UrgencyTier,
  currentSeverity: number,
): {
  urgency: UrgencyTier;
  severity: number;
  escalated: boolean;
  matched: string[];
  topCategory: RedFlagCategory | null;
} {
  const lower = text.toLowerCase();
  const matched: string[] = [];
  let urgency = currentUrgency;
  let severity = currentSeverity;
  let topCategory: RedFlagCategory | null = null;

  for (const combo of COMBINATION_FLOOR) {
    const allPresent = combo.terms.every((t) => {
      const idx = lower.indexOf(t);
      if (idx === -1) return false;
      if (isNegated(text, idx)) return false;
      if (isAttributed(text, idx)) return false;
      return true;
    });
    if (!allPresent) continue;
    matched.push(combo.id);
    if (URGENCY_RANK[combo.minUrgency] > URGENCY_RANK[urgency]) {
      urgency = combo.minUrgency;
      topCategory = combo.category;
    }
    if (combo.minSeverity > severity) {
      severity = combo.minSeverity;
      if (!topCategory) topCategory = combo.category;
    }
  }

  const escalated =
    severity > currentSeverity || URGENCY_RANK[urgency] > URGENCY_RANK[currentUrgency];
  return { urgency, severity, escalated, matched, topCategory };
}

// Deduped, clash-free floor: drop any exact-duplicate term and any term that
// collides with a hard-override phrase (hard overrides win — they short-circuit).
const _HARD_TERMS = new Set(HARD_OVERRIDE_PHRASES.map((h) => h.term));
const KEYWORD_FLOOR: typeof KEYWORD_FLOOR_RAW = (() => {
  const seen = new Set<string>();
  const out: typeof KEYWORD_FLOOR_RAW = [];
  for (const kf of KEYWORD_FLOOR_RAW) {
    if (seen.has(kf.term) || _HARD_TERMS.has(kf.term)) continue;
    seen.add(kf.term);
    out.push(kf);
  }
  return out;
})();

const NEGATION_MARKERS = [
  "don't",
  "dont",
  "do not",
  "doesn't",
  "doesnt",
  "does not",
  "didn't",
  "didnt",
  "did not",
  "no ",
  "not ",
  "never ",
  "without ",
  "denies",
  "denied",
  "haven't",
  "hasnt",
  "hasn't",
  "have not",
  "had no",
];

const ATTRIBUTION_MARKERS = [
  "my friend",
  "my mother",
  "my mom",
  "my mum",
  "my dad",
  "my father",
  "my husband",
  "my wife",
  "my partner",
  "my sister",
  "my brother",
  "my son",
  "my daughter",
  "my colleague",
  "my neighbor",
  "my neighbour",
  "someone else",
  "another person",
  "a friend",
];

function isNegated(text: string, termIndex: number): boolean {
  const before = text.substring(Math.max(0, termIndex - 60), termIndex).toLowerCase();
  return NEGATION_MARKERS.some((n) => before.includes(n));
}

function isAttributed(text: string, termIndex: number): boolean {
  const before = text.substring(Math.max(0, termIndex - 80), termIndex).toLowerCase();
  return ATTRIBUTION_MARKERS.some((a) => before.includes(a));
}

// ─────────────────────────────────────────────────────────────────────────────
// Merged scoring mechanics (folded upward from the precursor engine):
// numeric-pain parsing, compositional severity/onset modifiers, category
// clustering, and a sharper token-window attribution guard for the floor.
// ─────────────────────────────────────────────────────────────────────────────
const FORCE_URGENT_CATEGORIES = new Set<RedFlagCategory>([
  "cardiac",
  "neuro",
  "cauda_equina",
  "mental_health",
  "respiratory",
]);

// Intensity words that BOOST a detected symptom. Words already present as
// standalone floor terms (severe / excruciating / unbearable) are deliberately
// excluded to avoid double-counting.
const SEVERITY_MODIFIERS: Record<string, number> = {
  intense: 1,
  extreme: 1,
  terrible: 1,
  horrible: 1,
  agonizing: 2,
  agonising: 2,
  crushing: 2,
  worst: 2,
};

const ONSET_MODIFIERS: Array<[string, number]> = [
  ["out of nowhere", 2],
  ["all of a sudden", 1],
  ["just started", 1],
  ["came on suddenly", 1],
  ["suddenly", 1],
  ["sudden", 1],
];

// Parse an explicit pain rating from free text: "7/10", "8 out of 10",
// "pain is at a 9". Returns 0 when none found.
function extractNumericPain(text: string): number {
  let max = 0;
  const patterns = [
    /(?:pain|hurt(?:ing)?|severity|ache|sore)[^0-9]{0,20}?(\d{1,2})\s*(?:\/|out\s*of)\s*10/gi,
    /\b(\d{1,2})\s*(?:\/|out\s*of)\s*10\b/gi,
    // "pain is at a 9", "pain around 7" — lazy fill, but reject durations
    // like "pain for 3 weeks" via the trailing unit guard.
    /\bpain\b[^0-9]{0,15}?(\d{1,2})(?!\s*(?:\/|out\b|days?|weeks?|months?|hours?|hrs?|years?|yrs?|times?|x\b|%|kg|cm|mm|ml|mg))/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const n = parseInt(m[1], 10);
      if (n >= 0 && n <= 10 && n > max) max = n;
    }
  }
  return max;
}

// Highest single applicable intensity/onset boost (max, not summed — conservative).
function modifierBoost(lower: string): number {
  let boost = 0;
  for (const [mod, b] of Object.entries(SEVERITY_MODIFIERS)) {
    if (new RegExp(`\\b${mod}\\b`, "i").test(lower)) boost = Math.max(boost, b);
  }
  for (const [mod, b] of ONSET_MODIFIERS) {
    const re = mod.includes(" ") ? new RegExp(mod, "i") : new RegExp(`\\b${mod}\\b`, "i");
    if (re.test(lower)) boost = Math.max(boost, b);
  }
  return boost;
}

const ATTRIBUTION_TOKENS = new Set([
  "friend", "friends", "mother", "mom", "mum", "father", "dad",
  "husband", "wife", "partner", "spouse", "sister", "brother", "sibling",
  "colleague", "coworker", "neighbor", "neighbour", "son", "daughter",
  "child", "kid", "uncle", "aunt", "cousin", "grandparent", "grandma",
  "grandpa", "someone", "somebody",
]);

const SELF_PRONOUNS = new Set(["i", "me", "my", "ive", "im", "mine", "i've", "i'm"]);

// Sharper attribution check for the keyword floor: an attribution token in the
// preceding window marks the symptom as someone else's UNLESS a self-pronoun
// appears after it ("my brother is fine but I have chest pain" -> kept).
function isAttributedRefined(text: string, index: number): boolean {
  const window = text.substring(Math.max(0, index - 60), index).toLowerCase();
  const tokens = window
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z']/g, ""))
    .filter(Boolean);
  const recent = tokens.slice(-6);
  for (let i = 0; i < recent.length; i++) {
    if (ATTRIBUTION_TOKENS.has(recent[i])) {
      const after = recent.slice(i + 1);
      if (!after.some((t) => SELF_PRONOUNS.has(t))) return true;
    }
  }
  return false;
}

export function checkHardOverride(text: string): {
  triggered: boolean;
  phrase: string | null;
  category: RedFlagCategory | null;
} {
  const lower = text.toLowerCase();
  for (const item of HARD_OVERRIDE_PHRASES) {
    const index = lower.indexOf(item.term);
    if (index === -1) continue;
    if (isAttributed(text, index)) continue;
    return { triggered: true, phrase: item.term, category: item.category };
  }
  return { triggered: false, phrase: null, category: null };
}

export function applyKeywordFloor(
  text: string,
  currentUrgency: UrgencyTier,
  currentSeverity: number,
): {
  urgency: UrgencyTier;
  severity: number;
  escalated: boolean;
  matchedTerms: string[];
  topCategory: RedFlagCategory | null;
} {
  const lower = text.toLowerCase();

  // Pass 1 — collect non-negated, non-attributed matches.
  const raw: Array<{
    term: string;
    minUrgency: UrgencyTier;
    minSeverity: number;
    category: RedFlagCategory;
  }> = [];
  for (const kf of KEYWORD_FLOOR) {
    const index = lower.indexOf(kf.term);
    if (index === -1) continue;
    if (isNegated(text, index)) continue;
    if (isAttributedRefined(text, index)) continue;
    raw.push(kf);
  }

  // Drop shorter terms that are substrings of a longer matched term (e.g. drop
  // "fever" when "high fever" also matched) so clustering/scoring isn't inflated
  // by overlapping phrasings of the same underlying concept.
  const hits = raw.filter(
    (a) => !raw.some((b) => b.term !== a.term && b.term.includes(a.term)),
  );

  let urgency = currentUrgency;
  let termSeverity = currentSeverity;
  let topCategory: RedFlagCategory | null = null;
  let topSeverity = -1;
  const matchedTerms: string[] = [];
  const categoryHits: Partial<Record<RedFlagCategory, number>> = {};

  for (const kf of hits) {
    matchedTerms.push(kf.term);
    categoryHits[kf.category] = (categoryHits[kf.category] ?? 0) + 1;
    if (kf.minSeverity > topSeverity) {
      topSeverity = kf.minSeverity;
      topCategory = kf.category;
    }
    if (URGENCY_RANK[kf.minUrgency] > URGENCY_RANK[urgency]) urgency = kf.minUrgency;
    if (kf.minSeverity > termSeverity) termSeverity = kf.minSeverity;
  }

  // Numeric pain rating ("7 out of 10", "pain is at a 9").
  const numericPain = extractNumericPain(lower);
  if (numericPain >= 9) {
    if (URGENCY_RANK.urgent > URGENCY_RANK[urgency]) urgency = "urgent";
    termSeverity = Math.max(termSeverity, numericPain === 10 ? 8 : 7);
  } else if (numericPain >= 7) {
    if (URGENCY_RANK.soon > URGENCY_RANK[urgency]) urgency = "soon";
    termSeverity = Math.max(termSeverity, 6);
  }

  const hasSignal = matchedTerms.length > 0 || numericPain > 0;

  // Category clustering: 2+ distinct terms in one body system escalates.
  let clusterBonus = 0;
  let forcedByCluster = false;
  for (const key of Object.keys(categoryHits) as RedFlagCategory[]) {
    const count = categoryHits[key] ?? 0;
    if (count >= 2) {
      clusterBonus = Math.max(clusterBonus, count >= 3 ? 3 : 2);
      if (FORCE_URGENT_CATEGORIES.has(key)) forcedByCluster = true;
    }
  }

  // Compositional intensity/onset modifiers — only when a real symptom is present.
  const modifierBonus = hasSignal ? modifierBoost(lower) : 0;

  let severity = Math.min(10, termSeverity + clusterBonus + modifierBonus);

  // A cluster in a critical system escalates to at least urgent (never emergency
  // — that tier is reserved for hard overrides).
  if (forcedByCluster) {
    severity = Math.max(severity, 8);
    if (URGENCY_RANK.urgent > URGENCY_RANK[urgency]) urgency = "urgent";
  }

  const escalated =
    severity > currentSeverity || URGENCY_RANK[urgency] > URGENCY_RANK[currentUrgency];

  return { urgency, severity, escalated, matchedTerms, topCategory };
}
export function analyzeRealTime(text: string): RealTimeResult {
  if (!text.trim()) {
    return {
      detected: false,
      urgency: "routine",
      severity: 0,
      source: "keyword",
      matchedTerms: [],
      category: null,
    };
  }
  const override = checkHardOverride(text);
  if (override.triggered) {
    return {
      detected: true,
      urgency: "emergency",
      severity: 10,
      source: "hard_override",
      matchedTerms: [override.phrase!],
      category: override.category,
    };
  }
  const floor = applyKeywordFloor(text, "routine", 0);
  return {
    detected: floor.matchedTerms.length > 0 || floor.severity > 0,
    urgency: floor.urgency,
    severity: floor.severity,
    source: "keyword",
    matchedTerms: floor.matchedTerms,
    category: floor.topCategory,
  };
}

export interface CheckInEvaluation {
  /** Real-time keyword/override scan of the free-text notes. */
  realtime: RealTimeResult;
  /** Whether this check-in should be flagged for practitioner review. */
  flagged: boolean;
  /** Highest urgency implied by the pain score OR the notes. An emergency term
   *  in the notes is never downgraded to "urgent". */
  urgency: UrgencyTier;
}

/**
 * Single source of truth for triaging a daily check-in. Used by the live
 * check-in screen and by the offline queue when a check-in syncs late, so both
 * paths always agree on flagging and urgency.
 */
export function evaluateCheckIn(painLevel: number, notes: string): CheckInEvaluation {
  const realtime = analyzeRealTime(notes ?? "");
  const notesFlagged = realtime.detected && realtime.severity >= 6;
  const flagged = painLevel >= 7 || notesFlagged;
  const painUrgency: UrgencyTier = painLevel >= 7 ? "urgent" : "routine";
  const noteUrgency: UrgencyTier = notesFlagged ? realtime.urgency : "routine";
  const urgency =
    URGENCY_RANK[noteUrgency] >= URGENCY_RANK[painUrgency] ? noteUrgency : painUrgency;
  return { realtime, flagged, urgency };
}

function buildNextStep(urgency: UrgencyTier, practitionerName: string): string {
  switch (urgency) {
    case "emergency":
      return "Call 112 or go to your nearest emergency department immediately. Do not wait.";
    case "urgent":
      return `Contact ${practitionerName} today. These symptoms need prompt review — do not wait until your next appointment.`;
    case "soon":
      return `Schedule an appointment with ${practitionerName} within the next 24 to 48 hours.`;
    case "monitor":
      return `Monitor these symptoms closely. Contact ${practitionerName} if they worsen or do not improve within a few days.`;
    case "routine":
      return `Continue your current plan and raise this at your next appointment with ${practitionerName}.`;
  }
}

export async function analyzeSymptom(
  text: string,
  clientContext?: ClientRiskContext,
  practitionerName?: string,
  clientId?: string,
): Promise<TriageResult> {
  const pName = practitionerName ?? "your practitioner";

  // Layer 1 — hard override
  const override = checkHardOverride(text);
  if (override.triggered) {
    return {
      urgency: "emergency",
      severity: 10,
      red_flag_detected: true,
      suggested_next_step: buildNextStep("emergency", pName),
      rationale: `Immediate emergency indicator detected: "${override.phrase}". This requires emergency attention now.`,
      red_flags: [override.phrase!],
      categories: ["emergency"],
      red_flag_category: override.category,
      differential: [],
      recommended_questions: [],
      escalation_reason: "current_text",
      negation_detected: false,
      attribution_detected: false,
      should_notify_practitioner: true,
      confidence: 1,
      source: "hard_override",
    };
  }

  // Layer 2 — Claude reasons first (with server-built context when clientId provided)
  let aiResult: Omit<TriageResult, "source"> | null = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error("no session");
    const res = await fetch("/api/public/triage-query", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        query_text: text,
        client_context: clientContext,
        client_id: clientId,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = res.ok ? await res.json() : null;
    if (data && typeof data.severity === "number") {
      const urgency = data.urgency as UrgencyTier;
      aiResult = {
        urgency,
        severity: data.severity,
        red_flag_detected: data.severity >= 5 || urgency === "urgent" || urgency === "emergency",
        suggested_next_step: buildNextStep(urgency, pName),
        rationale: data.rationale ?? "",
        red_flags: data.red_flags ?? [],
        categories: data.categories ?? [],
        red_flag_category: (data.red_flag_category as RedFlagCategory | null) ?? null,
        differential: Array.isArray(data.differential) ? data.differential : [],
        recommended_questions: Array.isArray(data.recommended_questions)
          ? data.recommended_questions
          : [],
        escalation_reason: (data.escalation_reason as TriageResult["escalation_reason"]) ?? "none",
        negation_detected: data.negation_detected ?? false,
        attribution_detected: data.attribution_detected ?? false,
        should_notify_practitioner: data.should_notify_practitioner ?? false,
        confidence: data.confidence ?? 0.8,
      };
    }
  } catch {
    /* fall through */
  }

  // Layer 3 — keyword floor on top of AI
  if (aiResult) {
    if (aiResult.negation_detected || aiResult.attribution_detected) {
      return { ...aiResult, source: "ai_primary" };
    }
    const floor = applyKeywordFloor(text, aiResult.urgency, aiResult.severity);
    if (floor.escalated) {
      return {
        ...aiResult,
        urgency: floor.urgency,
        severity: floor.severity,
        red_flag_detected: floor.severity >= 5,
        red_flag_category: aiResult.red_flag_category ?? floor.topCategory,
        should_notify_practitioner: floor.severity >= 6,
        suggested_next_step: buildNextStep(floor.urgency, pName),
        source: "ai_keyword_escalated",
      };
    }
    return { ...aiResult, source: "ai_primary" };
  }

  // Keyword fallback — LLM unavailable
  const floor = applyKeywordFloor(text, "routine", 0);
  return {
    urgency: floor.urgency,
    severity: floor.severity,
    red_flag_detected: floor.severity >= 5,
    suggested_next_step: buildNextStep(floor.urgency, pName),
    rationale:
      floor.matchedTerms.length > 0
        ? `Keyword detection identified: ${floor.matchedTerms.join(", ")}.`
        : "No specific red flags detected. Monitor and contact your practitioner if symptoms worsen.",
    red_flags: floor.matchedTerms,
    categories: [],
    red_flag_category: floor.topCategory,
    differential: [],
    recommended_questions: [],
    escalation_reason: floor.escalated ? "current_text" : "none",
    negation_detected: false,
    attribution_detected: false,
    should_notify_practitioner: floor.severity >= 6,
    confidence: 0.6,
    source: "keyword_fallback",
  };
}
