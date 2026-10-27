/**
 * Switches for behaviour that can change what a patient is sent.
 * Off until the env var is exactly "1". Reading a flag never logs the value
 * of any other secret.
 */
export function patientFlag(name: string): boolean {
  return process.env[name] === "1";
}

export const BUDDY_FLAGS = {
  /** Release a failed reminder claim, and do not send the check-in template on stale consent. */
  reminderRelease: "BUDDY_REMINDER_RELEASE",
  /** Store a reception time on the client only after the physio confirms. */
  appointmentWrite: "BUDDY_APPOINTMENT_WRITE",
  /** Requeue a failed inbound message a few times. */
  inboundRetry: "BUDDY_INBOUND_RETRY",
  /** Number reading and routing use the practitioner Flash model. Conversation stays capped. */
  cheapAi: "BUDDY_CHEAP_AI",
  /** Two profiles on one cellphone: stop, tell the owner, one fixed line to the patient. */
  phoneAmbiguous: "BUDDY_PHONE_AMBIGUOUS",
  /** Discharge and reopen. Reminders stop only after a confirmed discharge. */
  discharge: "BUDDY_DISCHARGE",
  /** A confirmed copy can be sent to the patient. Preparing the file does not send. */
  dataExportSend: "BUDDY_DATA_EXPORT_SEND",
  /**
   * Patient WhatsApp uses the dialogue manager (one bubble, asides, corrections).
   * Off until this is exactly "1". The practitioner chat does not use this flag.
   */
  conversationalPatient: "BUDDY_CONVERSATIONAL_PATIENT",
  /**
   * Template outreach that can reopen the 24 hour window. Off until "1".
   * Each send still needs the patient's own opt-in and the weekly cap.
   */
  proactiveOutreach: "BUDDY_PROACTIVE_OUTREACH",
} as const;

/** Open conversation calls per patient per South African day, when cheap AI is on. */
export function converseDailyCap(): number {
  const raw = Number(process.env.BUDDY_CONVERSE_DAILY_CAP ?? "8");
  if (!Number.isInteger(raw) || raw < 1) return 8;
  return Math.min(raw, 50);
}
