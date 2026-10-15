/**
 * The five-minute job claims last_sent_on before the send. A failed send
 * must give the claim back. A deliberate skip keeps it.
 */
export type ReminderFollowUp = "keep" | "release" | "push";

export function reminderFollowUp(
  result: string,
  hasAppLogin: boolean,
  releaseOnFailed: boolean,
): ReminderFollowUp {
  if (result === "sent" || result === "busy") return "keep";
  // A closed WhatsApp window still gets the app push when they have a login.
  if (result === "window_closed") return hasAppLogin ? "push" : "keep";
  if (result === "failed") {
    if (!releaseOnFailed) return hasAppLogin ? "push" : "keep";
    return hasAppLogin ? "push" : "release";
  }
  return hasAppLogin ? "push" : "keep";
}
