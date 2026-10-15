/**
 * One check-in row per client per South African day.
 * A later save fills blanks, keeps the later pain, appends the note, and
 * stays flagged if either side was flagged.
 */

export interface DayCheckIn {
  pain_level: number | null;
  sleep_quality: number | null;
  stress_level: number | null;
  energy_level: number | null;
  mood: string | number | null;
  notes: string | null;
  medication_taken: boolean | null;
  flagged: boolean;
  exercise_adherence?: string | null;
  condition_context?: string | null;
  condition_note?: string | null;
}

export interface DayCheckInInput {
  pain: number | null;
  sleep: number | null;
  stress: number | null;
  energy: number | null;
  mood: string | number | null;
  notes: string | null;
  medicationTaken: boolean | null;
  flagged: boolean;
  exerciseAdherence?: string | null;
  conditionContext?: string | null;
  conditionNote?: string | null;
}

function blank(value: string | null | undefined): boolean {
  return value == null || String(value).trim() === "";
}

/** Append the new note. Never drop a note that is already on the row. */
export function appendNote(existing: string | null, incoming: string | null): string | null {
  const next = incoming?.trim() ?? "";
  const prev = existing?.trim() ?? "";
  if (!next) return prev || null;
  if (!prev) return next;
  if (prev === next || prev.includes(next)) return prev;
  return `${prev}\n${next}`;
}

export function mergeDayCheckIn(existing: DayCheckIn, incoming: DayCheckInInput): DayCheckIn {
  return {
    pain_level: incoming.pain != null ? incoming.pain : existing.pain_level,
    sleep_quality: existing.sleep_quality != null ? existing.sleep_quality : incoming.sleep,
    stress_level: existing.stress_level != null ? existing.stress_level : incoming.stress,
    energy_level: existing.energy_level != null ? existing.energy_level : incoming.energy,
    mood: existing.mood != null && String(existing.mood).trim() !== "" ? existing.mood : incoming.mood,
    notes: appendNote(existing.notes, incoming.notes),
    medication_taken: existing.medication_taken != null ? existing.medication_taken : incoming.medicationTaken,
    flagged: Boolean(existing.flagged) || Boolean(incoming.flagged),
    exercise_adherence: blank(existing.exercise_adherence)
      ? (incoming.exerciseAdherence ?? null)
      : existing.exercise_adherence,
    condition_context: blank(existing.condition_context)
      ? (incoming.conditionContext ?? null)
      : existing.condition_context,
    condition_note: appendNote(existing.condition_note ?? null, incoming.conditionNote ?? null),
  };
}

/** Fields already on a half-finished WhatsApp draft. Unanswered fields stay empty. */
export function partialFromDraft(draft: {
  pain?: number;
  sleep?: number;
  energy?: number;
  stress?: number;
  notes?: string[];
  adherence?: string;
} | null): DayCheckInInput | null {
  if (!draft || draft.pain == null) return null;
  const notes = (draft.notes ?? []).map((n) => n.trim()).filter(Boolean);
  return {
    pain: draft.pain,
    sleep: draft.sleep ?? null,
    energy: draft.energy ?? null,
    stress: draft.stress ?? null,
    mood: null,
    notes: notes.length ? notes.join("\n") : null,
    medicationTaken: null,
    flagged: false,
    exerciseAdherence: draft.adherence ?? null,
  };
}
