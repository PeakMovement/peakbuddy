/**
 * Clinician-review scaffold for red-flag words in Afrikaans, isiXhosa, and
 * isiZulu.
 *
 * NOT live. RED_FLAG_LEXICON_LIVE is false, and red-flag-rules.ts does not
 * import this file. A clinician has to sign the lists off before anyone wires
 * them into the deterministic net. Shipping the buttons in translation first
 * would let a serious symptom through in the patient's own language.
 *
 * The phrases below are placeholders for that review, not a finished
 * translation and not a clinical sign-off.
 */

export const RED_FLAG_LEXICON_LIVE = false;

export type LexiconLanguage = "af" | "xh" | "zu";

export interface LexiconEntry {
  /** Stable id for the review sheet. Not a patient identifier. */
  id: string;
  language: LexiconLanguage;
  /** What the English net already calls this concern. */
  englishConcern: string;
  /** Placeholder terms. Empty until a clinician writes them. */
  terms: string[];
  status: "clinician_review_required";
}

export const RED_FLAG_LEXICON: LexiconEntry[] = [
  { id: "af-chest", language: "af", englishConcern: "chest pain", terms: [], status: "clinician_review_required" },
  { id: "af-breath", language: "af", englishConcern: "shortness of breath", terms: [], status: "clinician_review_required" },
  { id: "af-calf", language: "af", englishConcern: "calf swelling", terms: [], status: "clinician_review_required" },
  { id: "af-neuro", language: "af", englishConcern: "numbness or weakness", terms: [], status: "clinician_review_required" },
  { id: "xh-chest", language: "xh", englishConcern: "chest pain", terms: [], status: "clinician_review_required" },
  { id: "xh-breath", language: "xh", englishConcern: "shortness of breath", terms: [], status: "clinician_review_required" },
  { id: "xh-calf", language: "xh", englishConcern: "calf swelling", terms: [], status: "clinician_review_required" },
  { id: "xh-neuro", language: "xh", englishConcern: "numbness or weakness", terms: [], status: "clinician_review_required" },
  { id: "zu-chest", language: "zu", englishConcern: "chest pain", terms: [], status: "clinician_review_required" },
  { id: "zu-breath", language: "zu", englishConcern: "shortness of breath", terms: [], status: "clinician_review_required" },
  { id: "zu-calf", language: "zu", englishConcern: "calf swelling", terms: [], status: "clinician_review_required" },
  { id: "zu-neuro", language: "zu", englishConcern: "numbness or weakness", terms: [], status: "clinician_review_required" },
];

/** Live matching stays off until a clinician has filled and signed the lists. */
export function lexiconMatchesLive(_text: string): string[] {
  if (!RED_FLAG_LEXICON_LIVE) return [];
  return [];
}
