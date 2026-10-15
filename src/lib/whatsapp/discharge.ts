/** Discharge copy. Fixed. No clinical claim. */

export const DISCHARGE_PATIENT =
  "Your check-ins are paused. Your physio can start them again when you're ready to come back.";

export function dischargeConfirm(name: string): string {
  return `Stop check-in reminders, programme reminders and quiet nudges for ${name}? Their chart and old check-ins stay. They come off the quiet list.`;
}

export function reopenConfirm(name: string): string {
  return `Open the episode again for ${name}? Check-in messages can resume. I will not send them anything from this yes.`;
}

export function dischargePhysioResult(name: string, told: "sent" | "quiet" | "failed"): string {
  if (told === "sent") {
    return `Done. Reminders are off for ${name}. I told them check-ins are paused.`;
  }
  if (told === "quiet") {
    return `Done. Reminders are off for ${name}. I did not message them, because their WhatsApp window is closed.`;
  }
  return `Reminders are off for ${name}. I could not send the pause note just now.`;
}

export function reopenPhysioResult(name: string): string {
  return `Done. ${name} is back on the list. Check-in messages can resume. I did not send them anything.`;
}
