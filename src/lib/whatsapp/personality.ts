/**
 * How Buddy sounds. Every tone replies in English.
 * Slang is understood elsewhere. It is not copied back as a second language.
 * None of these lines interpret a score.
 */

export type BuddyTone = "warm" | "concise" | "sa";

export function normaliseTone(value: unknown): BuddyTone {
  if (value === "concise" || value === "sa" || value === "warm") return value;
  return "warm";
}

export function shortAck(tone: BuddyTone, inboundWords: number): string {
  if (tone === "concise" || inboundWords < 4) return "Thanks.";
  if (tone === "sa") return "Sharp, thanks.";
  return "Thanks, got that.";
}

export function steerToCheckin(tone: BuddyTone, firstName: string): string {
  const who = firstName.trim() || "there";
  if (tone === "concise") return `${who}, ready for today's check in?`;
  if (tone === "sa") return `Hi ${who}. When you have a moment, we can do today's check in.`;
  return `Hi ${who}. Whenever you're ready, we can do a short check in.`;
}

export function alreadyDoneLine(tone: BuddyTone): string {
  if (tone === "concise") return "You're checked in for today.";
  if (tone === "sa") return "You're sorted for today. Message if something changes.";
  return "You're checked in for today. Message me if something changes.";
}

export function frustrationLine(): string {
  return "Sorry, that was clunky.";
}

export function celebrationLine(): string {
  return "Nice.";
}
