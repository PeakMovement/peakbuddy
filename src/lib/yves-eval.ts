// ============================================================================
// Yves triage evaluation harness.
//
// A labelled case set + scorers so any change to the triage prompt or the
// keyword layers can be MEASURED instead of guessed. Two scorers:
//   1. scoreSafetyNet()  — runs the deterministic layers (hard override +
//      keyword floor) offline; proves the safety net catches clear emergencies
//      and does not over-flag clear benign text. Runs anywhere, no API key.
//   2. The live AI runner (scripts/run-yves-eval.mjs) POSTs each case to the
//      deployed triage endpoint and scores full urgency/category accuracy.
// ============================================================================
import { checkHardOverride, evaluateCheckIn, analyzeRealTime, applyCombinationFloor, type UrgencyTier } from "./yves";

export interface EvalCase {
  id: string;
  text: string;
  /** Lowest urgency tier that is clinically acceptable for this case. */
  minUrgency: UrgencyTier;
  /** Whether the deterministic safety net MUST catch this (emergency phrases). */
  mustHardOverride?: boolean;
  /** Clearly benign — must NOT be flagged by the safety net. */
  benign?: boolean;
  category?: string;
  lang?: "en" | "af" | "zu" | "xh";
  note?: string;
}

export const EVAL_CASES: EvalCase[] = [
  // ── Emergencies (hard override expected) ──
  { id: "e1", text: "I have crushing chest pain and can't catch my breath", minUrgency: "emergency", mustHardOverride: true, category: "cardiac" },
  { id: "e2", text: "my face is drooping and my speech is slurred", minUrgency: "emergency", mustHardOverride: true, category: "neuro" },
  { id: "e3", text: "I've lost control of my bladder and my inner thighs are numb", minUrgency: "emergency", mustHardOverride: true, category: "cauda_equina" },
  { id: "e4", text: "I want to kill myself", minUrgency: "emergency", mustHardOverride: true, category: "mental_health" },
  { id: "e5", text: "my throat is closing and my lips are swelling", minUrgency: "emergency", mustHardOverride: true, category: "respiratory" },
  { id: "e6", text: "ek dink ek het n hartaanval", minUrgency: "emergency", mustHardOverride: true, category: "cardiac", lang: "af" },
  { id: "e7", text: "coughing up blood since this morning", minUrgency: "urgent", mustHardOverride: true, category: "respiratory" },
  { id: "e8", text: "worst headache of my life came on suddenly", minUrgency: "emergency", mustHardOverride: true, category: "neuro" },

  // ── Red flags (should reach at least urgent/soon) ──
  { id: "r1", text: "burning pain shooting down my left leg and my foot has gone numb", minUrgency: "urgent", category: "neuro" },
  { id: "r2", text: "high fever with a stiff neck and a bad headache", minUrgency: "urgent", category: "infection" },
  { id: "r3", text: "losing weight without trying and drenching night sweats", minUrgency: "soon", category: "systemic" },
  { id: "r4", text: "blood in my urine for two days", minUrgency: "urgent", category: "systemic" },
  { id: "r5", text: "my knee locked and gave way on the stairs", minUrgency: "soon", category: "msk_alarm" },
  { id: "r6", text: "chest tightness with palpitations and jaw pain", minUrgency: "urgent", category: "cardiac", note: "cluster" },
  { id: "r7", text: "brandende pyn in my been en dit voel gevoelloos", minUrgency: "soon", category: "neuro", lang: "af" },
  { id: "r8", text: "pain is 9 out of 10 and getting worse fast", minUrgency: "urgent", category: "general" },

  // ── Benign (must not be flagged by the safety net) ──
  { id: "b1", text: "a bit of stiffness in my lower back after gardening, feels mild", minUrgency: "routine", benign: true },
  { id: "b2", text: "sore quads two days after leg day, nothing unusual", minUrgency: "routine", benign: true },
  { id: "b3", text: "slept well, feeling good, just checking in", minUrgency: "routine", benign: true },
  { id: "b4", text: "mild neck tightness from sitting at my desk", minUrgency: "routine", benign: true },
  { id: "b5", text: "pain has been about a 2, manageable", minUrgency: "routine", benign: true },

  // ── Negation / attribution (must NOT hard-override) ──
  { id: "n1", text: "I do not have any chest pain, just wanted to check", minUrgency: "routine", note: "negation" },
  { id: "n2", text: "my friend had a stroke last year, I'm fine though", minUrgency: "routine", benign: true, note: "attribution" },
  { id: "n3", text: "no numbness or weakness anywhere, back feels ok", minUrgency: "routine", benign: true, note: "negation" },

  // ── Moderate (monitor/soon) ──
  { id: "m1", text: "dizzy every time I stand up quickly", minUrgency: "soon", category: "neuro" },
  { id: "m2", text: "headache most mornings this week", minUrgency: "soon", category: "neuro" },
  { id: "m3", text: "tingling in my fingers on and off", minUrgency: "monitor", category: "neuro" },
];

export interface SafetyNetResult {
  total: number;
  emergenciesCaught: number;
  emergenciesTotal: number;
  benignFalsePositives: { id: string; why: string }[];
  overrideMisfires: { id: string; why: string }[];
}

/** Offline scorer for the deterministic safety net. */
export function scoreSafetyNet(cases: EvalCase[] = EVAL_CASES): SafetyNetResult {
  let emergenciesCaught = 0, emergenciesTotal = 0;
  const benignFalsePositives: { id: string; why: string }[] = [];
  const overrideMisfires: { id: string; why: string }[] = [];

  for (const c of cases) {
    const override = checkHardOverride(c.text);
    const rt = analyzeRealTime(c.text);
    const evalr = evaluateCheckIn(3, c.text); // pain 3 so only notes drive the flag

    if (c.mustHardOverride) {
      emergenciesTotal++;
      // Caught if the hard override fires, the keyword floor already escalates
      // to urgent+, OR Lovable's combination floor escalates it — i.e. anything
      // the instant safety net can catch before the AI layer runs.
      const combo = applyCombinationFloor(c.text, "routine", 0);
      const comboUrgent = combo.urgency === "urgent" || combo.urgency === "emergency";
      if (override.triggered || rt.severity >= 7 || comboUrgent) emergenciesCaught++;
    }
    if (c.benign) {
      if (override.triggered) benignFalsePositives.push({ id: c.id, why: `hard override on "${override.phrase}"` });
      else if (evalr.flagged) benignFalsePositives.push({ id: c.id, why: `flagged (sev ${rt.severity})` });
    }
    // Attribution ("my friend has X") MUST be guarded out of the hard override.
    // Negation is intentionally NOT — a missed emergency beats a false alarm, and
    // the AI layer downgrades negated phrasing.
    if (c.note === "attribution" && override.triggered) {
      overrideMisfires.push({ id: c.id, why: `attributed symptom still hard-overrode on "${override.phrase}"` });
    }
  }
  return { total: cases.length, emergenciesCaught, emergenciesTotal, benignFalsePositives, overrideMisfires };
}
