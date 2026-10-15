/**
 * Weekday morning check-in for practitioners. Pure: no database, no send.
 *
 * Around 08:00 Africa/Johannesburg (the minute job, from 08:00 until 10:00
 * SAST) Buddy asks each practitioner with a current patient whether they
 * want a patient update or reception to check in with someone. Weekends and
 * dates in PUBLIC_HOLIDAYS are skipped. Saturday is already closed
 * (clinic-hours). The practice opens at 08:30, so this does not use isOpen():
 * 08:00 is before the doors, and the note should still go out.
 *
 * Buttons, in order: Patient update, Reception check-in, Not today.
 * Outside the 24 hour window the same three buttons are the quick replies on
 * the template named by WHATSAPP_MORNING_CHECKIN_TEMPLATE. The spec is in
 * docs/OPERATIONS.md. This file does not submit that template.
 */
import { OPEN_WEEKDAYS, PUBLIC_HOLIDAYS, toSast } from "./clinic-hours";
import { normalizePractitionerText } from "./practitioner-understand";

/** 08:00 SAST, inclusive. */
export const MORNING_CHECKIN_FROM_MINUTE = 8 * 60;
/** 10:00 SAST, exclusive. Two hours of catch-up if the minute job was late. */
export const MORNING_CHECKIN_UNTIL_MINUTE = 10 * 60;

export const MORNING_BUTTONS: Array<{ id: string; title: string }> = [
  { id: "prac_morn_update", title: "Patient update" },
  { id: "prac_morn_reception", title: "Reception check-in" },
  { id: "prac_morn_skip", title: "Not today" },
];

export const MORNING_MSG = {
  ask: (name: string) =>
    `Good morning ${name}. Would you like an update on your patients, or should reception check in with anyone?`,
  skipped: "No problem. I'll ask again on the next working morning.",
  who: "Who should reception check in with? Name one or more patients.",
  notFound: (name: string) =>
    `I couldn't find ${name} on your list. Reply with first and last names, or say cancel.`,
  which: (name: string) => `There's more than one match for ${name}. Reply with the full name.`,
  confirm: (names: string) => `Ask reception to check in with ${names}?`,
  task: (names: string) => `Please check in with ${names}.`,
  optedOut:
    'Done. I won\'t send the morning check-in. Say "start morning check-ins" if you want them again.',
  optedIn: "Done. I'll ask on working mornings around 8am whether you want a patient update.",
  failed: "Sorry, I couldn't save that just now. Please try again in a minute.",
  receptionCancelled: "Okay, I won't ask reception to check in with anyone.",
};

export type MorningPhrase = "update" | "reception" | "skip" | "off" | "on";

/**
 * Whole-message phrases for the three buttons, plus opt-out / opt-in.
 * "Update me every morning" is a scheduled client update, not this note,
 * so it does not match.
 */
export function morningPhrase(text: string): MorningPhrase | null {
  const n = normalizePractitionerText(text);
  if (!n) return null;
  if (
    /^(?:please\s+)?(?:stop|pause|cancel|turn off|switch off|no more|unsubscribe|opt out)(?:\s+\w+){0,4}\s+morning check in$/.test(
      n,
    ) ||
    /\bno morning (?:check in|messages|prompts)\b/.test(n)
  )
    return "off";
  if (/^(?:please\s+)?(?:start|turn on|resume|opt in)(?:\s+\w+){0,3}\s+morning check in$/.test(n))
    return "on";
  if (/^(?:reception|secretary|front desk) check in$/.test(n)) return "reception";
  if (/^(?:not today|skip today|no thanks today|not now)$/.test(n)) return "skip";
  if (/^patient update$/.test(n)) return "update";
  return null;
}

/** Names from "Sam and Lee" or "check in with Sam Kruger, Lee Adams". */
export function morningNameParts(text: string): string[] {
  let t = String(text ?? "")
    .trim()
    .replace(/[.?!]+$/g, "");
  t = t.replace(
    /^(?:please\s+)?(?:can you\s+)?(?:ask\s+)?(?:the\s+)?(?:reception|secretary|front desk)?\s*(?:to\s+)?(?:check in with|check on)\s+/i,
    "",
  );
  return t
    .split(/\s*(?:,|&|\band\b)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
}

export function morningCheckinDate(now: Date): string {
  return toSast(now).date;
}

/** True during the send window on a day the practice is open. */
export function morningCheckinDue(
  now: Date,
  holidays: ReadonlySet<string> = PUBLIC_HOLIDAYS,
): boolean {
  const m = toSast(now);
  if (holidays.has(m.date)) return false;
  if (!OPEN_WEEKDAYS.has(m.weekday)) return false;
  return (
    m.minuteOfDay >= MORNING_CHECKIN_FROM_MINUTE && m.minuteOfDay < MORNING_CHECKIN_UNTIL_MINUTE
  );
}
