/**
 * How often and when Buddy checks in, chosen by the patient during
 * onboarding (Justin, 9 Oct 2026). Pure: wording, choices and parsing.
 *
 * Days are 0 = Sunday ... 6 = Saturday, the same as checkin_reminders.
 */

export interface ScheduleChoice {
  id: string;
  title: string;
  /** How Buddy says it back: "every day", "on weekdays"... */
  phrase: string;
  days: number[];
  /** checkin_reminders.frequency, as the app's reminder screen reads it. */
  frequency: "daily" | "custom";
}

export const FREQUENCIES: ScheduleChoice[] = [
  {
    id: "sched_daily",
    title: "Every day",
    phrase: "every day",
    days: [0, 1, 2, 3, 4, 5, 6],
    frequency: "daily",
  },
  {
    id: "sched_weekdays",
    title: "Weekdays only",
    phrase: "on weekdays",
    days: [1, 2, 3, 4, 5],
    frequency: "custom",
  },
  {
    id: "sched_3x",
    title: "3 times a week",
    phrase: "on Mondays, Wednesdays and Fridays",
    days: [1, 3, 5],
    frequency: "custom",
  },
  {
    id: "sched_weekly",
    title: "Once a week",
    phrase: "every Monday",
    days: [1],
    frequency: "custom",
  },
];

export const TIMES: Array<{ id: string; title: string; time: string }> = [
  { id: "time_0800", title: "Morning (8am)", time: "08:00" },
  { id: "time_1200", title: "Midday (12pm)", time: "12:00" },
  { id: "time_1800", title: "Evening (6pm)", time: "18:00" },
  { id: "time_2000", title: "Night (8pm)", time: "20:00" },
];

export const DEFAULT_FREQUENCY = FREQUENCIES[0];
export const DEFAULT_TIME = "18:00";

/** "18:00" -> "6pm", "07:30" -> "7:30am", "12:00" -> "12pm". */
export function sayTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${suffix}`;
}

/** A frequency from a tapped row or typed words. Null when unclear. */
export function readFrequency(replyId: string | undefined, text: string): ScheduleChoice | null {
  const byId = FREQUENCIES.find((f) => f.id === replyId);
  if (byId) return byId;
  const t = text.toLowerCase().trim();
  if (!t) return null;
  if (/\b(every ?day|daily|each day|elke dag|daagliks)\b/.test(t)) return FREQUENCIES[0];
  if (/\b(week ?days|weekdays|mon(day)? to fri(day)?|work ?days)\b/.test(t)) return FREQUENCIES[1];
  if (/\b(3|three|drie)\s*(times|x)\b/.test(t)) return FREQUENCIES[2];
  if (/\b(once a week|weekly|1 ?x a week|one(ce)? per week|every week)\b/.test(t))
    return FREQUENCIES[3];
  return null;
}

export const SCHEDULE_MSG = {
  askFrequency: (firstName: string) =>
    `Thank you ${firstName}, your consent is signed and saved. One quick thing before we start: how often would you like me to check in with you?`,
  frequencyRetry: "Please pick how often from the list, so I know when to check in.",
  askTime: "And what time of day suits you best? Pick one, or type a time like 7:30am.",
  timeRetry: "Please pick a time from the list, or type one like 7:30am.",
  confirmed: (phrase: string, time: string) =>
    `Perfect, I'll check in ${phrase} at ${sayTime(time)}.\n\nIf you ever want to stop the check-ins, just reply STOP. To change how often or the time, just tell me, for example "check in at 7am" or "only weekdays".`,
  fallback: (phrase: string, time: string) =>
    `No problem, I'll check in ${phrase} at ${sayTime(time)} for now. You can change it any time, and reply STOP whenever you want the check-ins to end.`,
};
