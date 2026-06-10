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
];

// ─────────────────────────────────────────────────────────────────────────────
// KEYWORD FLOOR — escalates urgency/severity if AI underrates. Categorised.
// ─────────────────────────────────────────────────────────────────────────────
const KEYWORD_FLOOR: Array<{
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
  { term: "saddle area numbness", minUrgency: "emergency", minSeverity: 10, category: "cauda_equina" },

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
  { term: "pain 8 out of 10", minUrgency: "soon", minSeverity: 6, category: "general" },
  { term: "pain 9 out of 10", minUrgency: "urgent", minSeverity: 7, category: "general" },
  { term: "pain 10 out of 10", minUrgency: "urgent", minSeverity: 8, category: "general" },
  { term: "8/10", minUrgency: "soon", minSeverity: 6, category: "general" },
  { term: "9/10", minUrgency: "urgent", minSeverity: 7, category: "general" },
  { term: "10/10", minUrgency: "urgent", minSeverity: 8, category: "general" },

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
];

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
  let urgency = currentUrgency;
  let severity = currentSeverity;
  let escalated = false;
  const matchedTerms: string[] = [];
  let topCategory: RedFlagCategory | null = null;
  let topSeverity = -1;

  for (const kf of KEYWORD_FLOOR) {
    const index = lower.indexOf(kf.term);
    if (index === -1) continue;
    if (isNegated(text, index)) continue;
    if (isAttributed(text, index)) continue;
    matchedTerms.push(kf.term);
    if (kf.minSeverity > topSeverity) {
      topSeverity = kf.minSeverity;
      topCategory = kf.category;
    }
    if (URGENCY_RANK[kf.minUrgency] > URGENCY_RANK[urgency]) {
      urgency = kf.minUrgency;
      escalated = true;
    }
    if (kf.minSeverity > severity) {
      severity = kf.minSeverity;
      escalated = true;
    }
  }

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
    detected: floor.matchedTerms.length > 0,
    urgency: floor.urgency,
    severity: floor.severity,
    source: "keyword",
    matchedTerms: floor.matchedTerms,
    category: floor.topCategory,
  };
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
