import { supabase } from './supabase';

export type UrgencyTier = 'emergency' | 'urgent' | 'soon' | 'monitor' | 'routine';

export interface TriageResult {
  urgency: UrgencyTier;
  severity: number;
  red_flag_detected: boolean;
  suggested_next_step: string;
  rationale: string;
  red_flags: string[];
  categories: string[];
  negation_detected: boolean;
  attribution_detected: boolean;
  should_notify_practitioner: boolean;
  confidence: number;
  source: 'hard_override' | 'ai_primary' | 'ai_keyword_escalated' | 'keyword_fallback';
}

export interface ClientRiskContext {
  avgPainLast3: number;
  painTrend: 'rising' | 'falling' | 'stable';
  flaggedCountLast7d: number;
  worseChangeRecent: boolean;
  checkInCount: number;
}

export interface RealTimeResult {
  detected: boolean;
  urgency: UrgencyTier;
  severity: number;
  source: 'hard_override' | 'keyword';
  matchedTerms: string[];
}

const URGENCY_RANK: Record<UrgencyTier, number> = {
  routine: 0, monitor: 1, soon: 2, urgent: 3, emergency: 4,
};

const HARD_OVERRIDE_PHRASES = [
  'chest pain', 'heart attack', 'myocardial', "can't breathe", 'cannot breathe',
  'not breathing', 'stopped breathing', 'difficulty breathing', 'stroke',
  'face drooping', 'arm weakness', 'speech difficulty', 'slurred speech',
  'sudden confusion', 'paralysis', 'paralyzed', 'collapsed', 'unconscious',
  'unresponsive', 'seizure', 'fitting', 'cauda equina', 'saddle anaesthesia',
  'loss of bowel control', 'loss of bladder control', 'suicidal',
  'want to kill myself', 'end my life', 'overdose', 'took too many pills',
  'anaphylaxis', 'throat closing', 'severe allergic reaction',
  'worst headache of my life', 'thunderclap headache', 'sudden vision loss',
  'sudden blindness', 'eyes bleeding', 'bleeding from eyes', 'bleeding out of my eyes',
  'bleeding from my eyes', 'bleeding from ears', 'bleeding from my ears',
  'bleeding out of my ears', 'bleeding from nose', 'bleeding from my nose',
  'bleeding from mouth', 'bleeding from my mouth',
  'coughing up blood', 'vomiting blood', 'stabbed', 'gunshot', 'major trauma',
];

const KEYWORD_FLOOR: Array<{
  term: string; minUrgency: UrgencyTier; minSeverity: number;
}> = [
  { term: 'numbness', minUrgency: 'soon', minSeverity: 5 },
  { term: 'tingling in face', minUrgency: 'urgent', minSeverity: 7 },
  { term: 'facial numbness', minUrgency: 'urgent', minSeverity: 7 },
  { term: 'weakness in legs', minUrgency: 'urgent', minSeverity: 7 },
  { term: 'bilateral leg weakness', minUrgency: 'urgent', minSeverity: 8 },
  { term: 'pins and needles', minUrgency: 'monitor', minSeverity: 4 },
  { term: 'radiating pain', minUrgency: 'soon', minSeverity: 5 },
  { term: 'shooting pain', minUrgency: 'soon', minSeverity: 5 },
  { term: 'palpitations', minUrgency: 'soon', minSeverity: 5 },
  { term: 'racing heart', minUrgency: 'soon', minSeverity: 5 },
  { term: 'irregular heartbeat', minUrgency: 'urgent', minSeverity: 7 },
  { term: 'chest tightness', minUrgency: 'urgent', minSeverity: 7 },
  { term: 'chest pressure', minUrgency: 'urgent', minSeverity: 8 },
  { term: 'left arm pain', minUrgency: 'urgent', minSeverity: 7 },
  { term: 'jaw pain', minUrgency: 'soon', minSeverity: 5 },
  { term: 'bowel control', minUrgency: 'emergency', minSeverity: 10 },
  { term: 'bladder control', minUrgency: 'emergency', minSeverity: 10 },
  { term: 'saddle area numbness', minUrgency: 'emergency', minSeverity: 10 },
  { term: 'self harm', minUrgency: 'urgent', minSeverity: 8 },
  { term: 'self-harm', minUrgency: 'urgent', minSeverity: 8 },
  { term: 'hurting myself', minUrgency: 'urgent', minSeverity: 8 },
  { term: 'shortness of breath', minUrgency: 'urgent', minSeverity: 7 },
  { term: 'wheezing', minUrgency: 'soon', minSeverity: 5 },
  { term: 'asthma attack', minUrgency: 'urgent', minSeverity: 8 },
  { term: 'severe pain', minUrgency: 'soon', minSeverity: 6 },
  { term: 'excruciating', minUrgency: 'urgent', minSeverity: 7 },
  { term: 'unbearable pain', minUrgency: 'urgent', minSeverity: 7 },
  { term: 'pain 8 out of 10', minUrgency: 'soon', minSeverity: 6 },
  { term: 'pain 9 out of 10', minUrgency: 'urgent', minSeverity: 7 },
  { term: 'pain 10 out of 10', minUrgency: 'urgent', minSeverity: 8 },
  { term: '8/10', minUrgency: 'soon', minSeverity: 6 },
  { term: '9/10', minUrgency: 'urgent', minSeverity: 7 },
  { term: '10/10', minUrgency: 'urgent', minSeverity: 8 },
  { term: 'cannot walk', minUrgency: 'urgent', minSeverity: 7 },
  { term: 'unable to walk', minUrgency: 'urgent', minSeverity: 7 },
  { term: 'rapidly worsening', minUrgency: 'urgent', minSeverity: 7 },
  { term: 'getting worse quickly', minUrgency: 'urgent', minSeverity: 7 },
  { term: 'night sweats', minUrgency: 'soon', minSeverity: 5 },
  { term: 'unexplained weight loss', minUrgency: 'soon', minSeverity: 5 },
  { term: 'fever', minUrgency: 'monitor', minSeverity: 4 },
  { term: 'blood in urine', minUrgency: 'urgent', minSeverity: 7 },
  { term: 'blood in stool', minUrgency: 'urgent', minSeverity: 7 },
];

const NEGATION_MARKERS = [
  "don't", "dont", "do not", "doesn't", "doesnt", "does not",
  "didn't", "didnt", "did not", "no ", "not ", "never ",
  "without ", "denies", "denied", "haven't", "hasnt",
  "hasn't", "have not", "had no",
];

const ATTRIBUTION_MARKERS = [
  "my friend", "my mother", "my mom", "my mum", "my dad",
  "my father", "my husband", "my wife", "my partner",
  "my sister", "my brother", "my son", "my daughter",
  "my colleague", "my neighbor", "my neighbour",
  "someone else", "another person", "a friend",
];

function isNegated(text: string, termIndex: number): boolean {
  const before = text.substring(Math.max(0, termIndex - 60), termIndex).toLowerCase();
  return NEGATION_MARKERS.some(n => before.includes(n));
}

function isAttributed(text: string, termIndex: number): boolean {
  const before = text.substring(Math.max(0, termIndex - 80), termIndex).toLowerCase();
  return ATTRIBUTION_MARKERS.some(a => before.includes(a));
}

export function checkHardOverride(text: string): { triggered: boolean; phrase: string | null } {
  const lower = text.toLowerCase();
  for (const phrase of HARD_OVERRIDE_PHRASES) {
    const index = lower.indexOf(phrase);
    if (index === -1) continue;
    if (isAttributed(text, index)) continue;
    return { triggered: true, phrase };
  }
  return { triggered: false, phrase: null };
}

export function applyKeywordFloor(
  text: string,
  currentUrgency: UrgencyTier,
  currentSeverity: number
): { urgency: UrgencyTier; severity: number; escalated: boolean; matchedTerms: string[] } {
  const lower = text.toLowerCase();
  let urgency = currentUrgency;
  let severity = currentSeverity;
  let escalated = false;
  const matchedTerms: string[] = [];

  for (const kf of KEYWORD_FLOOR) {
    const index = lower.indexOf(kf.term);
    if (index === -1) continue;
    if (isNegated(text, index)) continue;
    if (isAttributed(text, index)) continue;
    matchedTerms.push(kf.term);
    if (URGENCY_RANK[kf.minUrgency] > URGENCY_RANK[urgency]) {
      urgency = kf.minUrgency;
      escalated = true;
    }
    if (kf.minSeverity > severity) {
      severity = kf.minSeverity;
      escalated = true;
    }
  }

  return { urgency, severity, escalated, matchedTerms };
}

export function analyzeRealTime(text: string): RealTimeResult {
  if (!text.trim()) {
    return { detected: false, urgency: 'routine', severity: 0, source: 'keyword', matchedTerms: [] };
  }
  const override = checkHardOverride(text);
  if (override.triggered) {
    return {
      detected: true, urgency: 'emergency', severity: 10,
      source: 'hard_override', matchedTerms: [override.phrase!],
    };
  }
  const floor = applyKeywordFloor(text, 'routine', 0);
  return {
    detected: floor.matchedTerms.length > 0,
    urgency: floor.urgency,
    severity: floor.severity,
    source: 'keyword',
    matchedTerms: floor.matchedTerms,
  };
}

function buildNextStep(urgency: UrgencyTier, practitionerName: string): string {
  switch (urgency) {
    case 'emergency':
      return 'Call 112 or go to your nearest emergency department immediately. Do not wait.';
    case 'urgent':
      return `Contact ${practitionerName} today. These symptoms need prompt review — do not wait until your next appointment.`;
    case 'soon':
      return `Schedule an appointment with ${practitionerName} within the next 24 to 48 hours.`;
    case 'monitor':
      return `Monitor these symptoms closely. Contact ${practitionerName} if they worsen or do not improve within a few days.`;
    case 'routine':
      return `Continue your current plan and raise this at your next appointment with ${practitionerName}.`;
  }
}

export async function analyzeSymptom(
  text: string,
  clientContext?: ClientRiskContext,
  practitionerName?: string,
  clientId?: string,
): Promise<TriageResult> {
  const pName = practitionerName ?? 'your practitioner';

  // Layer 1 — hard override
  const override = checkHardOverride(text);
  if (override.triggered) {
    return {
      urgency: 'emergency', severity: 10, red_flag_detected: true,
      suggested_next_step: buildNextStep('emergency', pName),
      rationale: `Immediate emergency indicator detected: "${override.phrase}". This requires emergency attention now.`,
      red_flags: [override.phrase!], categories: ['emergency'],
      negation_detected: false, attribution_detected: false,
      should_notify_practitioner: true, confidence: 1,
      source: 'hard_override',
    };
  }

  // Layer 2 — Claude reasons first
  let aiResult: (Omit<TriageResult, 'source'>) | null = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch('/api/public/triage-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query_text: text, client_context: clientContext, client_id: clientId }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = res.ok ? await res.json() : null;
    if (data && typeof data.severity === 'number') {
      const urgency = data.urgency as UrgencyTier;
      aiResult = {
        urgency,
        severity: data.severity,
        red_flag_detected: data.severity >= 5 || urgency === 'urgent' || urgency === 'emergency',
        suggested_next_step: buildNextStep(urgency, pName),
        rationale: data.rationale ?? '',
        red_flags: data.red_flags ?? [],
        categories: data.categories ?? [],
        negation_detected: data.negation_detected ?? false,
        attribution_detected: data.attribution_detected ?? false,
        should_notify_practitioner: data.should_notify_practitioner ?? false,
        confidence: data.confidence ?? 0.8,
      };
    }
  } catch { /* fall through */ }

  // Layer 3 — keyword floor on top of AI
  if (aiResult) {
    if (aiResult.negation_detected || aiResult.attribution_detected) {
      return { ...aiResult, source: 'ai_primary' };
    }
    const floor = applyKeywordFloor(text, aiResult.urgency, aiResult.severity);
    if (floor.escalated) {
      return {
        ...aiResult,
        urgency: floor.urgency, severity: floor.severity,
        red_flag_detected: floor.severity >= 5,
        should_notify_practitioner: floor.severity >= 6,
        suggested_next_step: buildNextStep(floor.urgency, pName),
        source: 'ai_keyword_escalated',
      };
    }
    return { ...aiResult, source: 'ai_primary' };
  }

  // Keyword fallback — LLM unavailable
  const floor = applyKeywordFloor(text, 'routine', 0);
  return {
    urgency: floor.urgency, severity: floor.severity,
    red_flag_detected: floor.severity >= 5,
    suggested_next_step: buildNextStep(floor.urgency, pName),
    rationale: floor.matchedTerms.length > 0
      ? `Keyword detection identified: ${floor.matchedTerms.join(', ')}.`
      : 'No specific red flags detected. Monitor and contact your practitioner if symptoms worsen.',
    red_flags: floor.matchedTerms, categories: [],
    negation_detected: false, attribution_detected: false,
    should_notify_practitioner: floor.severity >= 6,
    confidence: 0.6, source: 'keyword_fallback',
  };
}
