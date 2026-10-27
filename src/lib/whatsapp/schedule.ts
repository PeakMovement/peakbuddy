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
    id: "sched_2x",
    title: "Twice a week",
    phrase: "on Mondays and Thursdays",
    days: [1, 4],
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

const DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Days used when someone names a count but not the days. Spread across the
 * week, and identical to the menu rows for 1, 2, 3, 5 and 7.
 */
const SPREAD: Record<number, number[]> = {
  1: [1],
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
  6: [1, 2, 3, 4, 5, 6],
  7: [0, 1, 2, 3, 4, 5, 6],
};

const COUNT_WORD =
  "once|twice|thrice|one|two|three|four|five|six|seven|een|twee|drie|vier|vyf|ses|sewe|\\d+";

const DAY_PATTERN =
  "(?:sundays?|suns?|sondae?s?|mondays?|mons?|maandae?s?|tuesdays?|tues?|wednesdays?|weds?|thursdays?|thurs?|fridays?|fris?|saturdays?|sats?)";

const WORD_COUNT: Record<string, number> = {
  once: 1,
  one: 1,
  een: 1,
  twice: 2,
  two: 2,
  twee: 2,
  thrice: 3,
  three: 3,
  drie: 3,
  four: 4,
  vier: 4,
  five: 5,
  vyf: 5,
  six: 6,
  ses: 6,
  seven: 7,
  sewe: 7,
};

function byId(id: string): ScheduleChoice {
  const found = FREQUENCIES.find((f) => f.id === id);
  if (!found) throw new Error(`missing schedule ${id}`);
  return found;
}

function sameDays(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((d, i) => d === right[i]);
}

function wordToCount(word: string): number | null {
  const n = WORD_COUNT[word.toLowerCase()];
  if (n) return n;
  const num = Number(word);
  if (Number.isInteger(num) && num >= 1 && num <= 7) return num;
  return null;
}

/** "Monday and Thursday" → [1, 4]. "thu" is not read out of "thursday" twice. */
function namedDays(text: string): number[] {
  const found = new Set<number>();
  const re = new RegExp(`\\b(${DAY_PATTERN})\\b`, "gi");
  for (const match of text.matchAll(re)) {
    const w = match[1].toLowerCase();
    if (/^sun|^son/.test(w)) found.add(0);
    else if (/^mon|^maan/.test(w)) found.add(1);
    else if (/^tue/.test(w)) found.add(2);
    else if (/^wed/.test(w)) found.add(3);
    else if (/^thu/.test(w)) found.add(4);
    else if (/^fri/.test(w)) found.add(5);
    else if (/^sat/.test(w)) found.add(6);
  }
  return [...found].sort((a, b) => a - b);
}

function phraseForDays(days: readonly number[]): string {
  const preset = FREQUENCIES.find((f) => sameDays(f.days, days));
  if (preset) return preset.phrase;
  const sorted = [...days].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
  const names = sorted.map((d) => DAY_NAME[d] ?? "");
  if (names.length === 1) return `every ${names[0]}`;
  const plural = names.map((n) => `${n}s`);
  if (plural.length === 2) return `on ${plural[0]} and ${plural[1]}`;
  return `on ${plural.slice(0, -1).join(", ")} and ${plural[plural.length - 1]}`;
}

function choiceForDays(days: number[]): ScheduleChoice | null {
  const unique = [...new Set(days.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
  if (!unique.length) return null;
  const preset = FREQUENCIES.find((f) => sameDays(f.days, unique));
  if (preset) return preset;
  return {
    id: "sched_custom",
    title: phraseForDays(unique),
    phrase: phraseForDays(unique),
    days: unique,
    frequency: unique.length === 7 ? "daily" : "custom",
  };
}

function withoutClock(text: string): string {
  return text
    .replace(/\b(?:at|om)\s*\d{1,2}(?:[:h.]\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?/gi, " ")
    .replace(
      /\b(?:time\s+)?(?:at|to|for)\s*\d{1,2}(?:[:h.]\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?/gi,
      " ",
    );
}

/**
 * Phrases that mean once a week but don't sit in "once a week" order.
 * "every once in a week", "once in a week", "once every week".
 */
function normaliseCadence(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bevery\s+once\s+in\s+(?:a|the)\s+weeks?\b/g, "once a week")
    .replace(/\bonce\s+in\s+(?:a|the)\s+weeks?\b/g, "once a week")
    .replace(/\bonce\s+every\s+weeks?\b/g, "once a week");
}

/** "not every day" with no other count must not be stored as daily. */
function rejectsDaily(text: string): boolean {
  return /\b(?:not|never|don'?t|do not|stop)\b[\s\S]{0,40}\b(?:every ?day|each day|daily)\b/i.test(
    text,
  );
}

/** How many times a week, or null when they didn't say a count. */
function timesPerWeek(text: string): number | null {
  const t = normaliseCadence(text);
  const explicit = t.match(
    new RegExp(
      `\\b(${COUNT_WORD})\\s*(?:x|times?|keer)?\\s*(?:a|per|each|'?n|\\/)?\\s*(?:weeks?|weekly|weekliks|wk)\\b`,
      "i",
    ),
  );
  if (explicit) return wordToCount(explicit[1]);
  if (/\b(weekly|weekliks|every week|each week)\b/.test(t)) return 1;
  // "only twice" / "check in 3 times" while we're already talking about check-ins.
  if (!/\b(check[\s-]?ins?|remind\w*|only|just)\b/.test(t)) return null;
  const implied = withoutClock(t).match(
    new RegExp(`\\b(${COUNT_WORD})\\s*(?:x|times?|keer)?\\b`, "i"),
  );
  return implied ? wordToCount(implied[1]) : null;
}

function daysMentioned(text: string): number[] {
  const named = namedDays(text);
  const days = [...named];
  if (/\bweekends?\b/i.test(text)) days.push(0, 6);
  if (/\b(week ?days|weekdays|weeksdae|mon(?:day)?s? to fri(?:day)?s?|work ?days)\b/i.test(text)) {
    days.push(1, 2, 3, 4, 5);
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

function parseFrequencyBody(text: string): ScheduleChoice | null {
  const t = normaliseCadence(text.trim());
  if (!t) return null;
  if (/\bevery\s*(?:other|second|2|two)\s*days?\b/.test(t)) return choiceForDays([0, 2, 4, 6]);
  if (/\bevery\s*(?:3|three)\s*days?\b/.test(t)) return choiceForDays([1, 4]);
  // A count beats "every day" in the same sentence: "not every day, once a week".
  const count = timesPerWeek(t);
  if (count) return choiceForDays(SPREAD[count]);
  const mentioned = daysMentioned(t);
  if (mentioned.length) return choiceForDays(mentioned);
  if (rejectsDaily(t)) return null;
  if (/\b(every ?day|each day|daily|elke dag|daagliks)\b/.test(t)) return byId("sched_daily");
  const loose = withoutClock(t).match(new RegExp(`\\b(${COUNT_WORD})\\s*(?:x|times|keer)\\b`, "i"));
  if (loose) {
    const n = wordToCount(loose[1]);
    if (n) return choiceForDays(SPREAD[n]);
  }
  const bare = t
    .replace(/[.!]+$/g, "")
    .match(
      /^(?:please\s+)?(once|twice|thrice|one|two|three|four|five|six|seven|een|twee|drie|vier|vyf|ses|sewe|\d+)(?:\s*x)?(?:\s*please)?$/,
    );
  if (bare) {
    const n = wordToCount(bare[1]);
    if (n) return choiceForDays(SPREAD[n]);
  }
  return null;
}

/**
 * A frequency from a tapped row or typed words. Null when unclear.
 * Used while Buddy has just asked how often, so a bare "2" or "twice" counts.
 */
export function readFrequency(replyId: string | undefined, text: string): ScheduleChoice | null {
  const picked = FREQUENCIES.find((f) => f.id === replyId);
  if (picked) return picked;
  const raw = text.trim();
  if (!raw) return null;
  const except = raw.split(/\b(?:except|excluding|but not|not on)\b/i);
  if (except.length === 2) {
    const base = parseFrequencyBody(except[0]) ?? byId("sched_daily");
    const drop = daysMentioned(except[1]);
    if (!drop.length) return base;
    const days = base.days.filter((d) => !drop.includes(d));
    return days.length ? choiceForDays(days) : null;
  }
  return parseFrequencyBody(raw);
}

const BARE_CADENCE = new RegExp(
  `^(?:please\\s+)?(?:only\\s+|just\\s+)?(?:on\\s+)?(?:every\\s+|each\\s+)?(?:` +
    `every\\s*day|each\\s*day|daily|elke\\s*dag|daagliks|` +
    `week\\s*days|weekdays|weeksdae|weekends?|work\\s*days|` +
    `(?:${COUNT_WORD})\\s*(?:x|times?|keer)?\\s*(?:a|per|each|'?n|\\/)?\\s*(?:weeks?|weekly|weekliks|wk)|` +
    `weekly|weekliks|every\\s+week|each\\s+week|` +
    `every\\s*(?:other|second|2|two|3|three)\\s*days?|` +
    `${DAY_PATTERN}(?:\\s*(?:,|&|and)\\s*${DAY_PATTERN})*` +
    `)(?:\\s+please)?[.!]*$`,
  "i",
);

/**
 * A later message that changes how often Buddy checks in. A pain score, a
 * parking question, or "training twice a week" is not a schedule change.
 * An explicit cadence ("once every week", "not every day, once a week") is
 * saved without a cue word such as "check in" or "only". Null when it isn't one.
 */
export function readScheduleChange(text: string): ScheduleChoice | null {
  const t = text.trim();
  if (!t) return null;
  if (/\?/.test(t) && !/\b(check[\s-]?ins?|remind\w*|message me|text me)\b/i.test(t)) return null;
  const choice = readFrequency(undefined, t);
  if (!choice) return null;
  const topic =
    /\b(pain|hurt|hurts|sore|swollen|parking|appointments?|training|train|gym|soccer|shift|class|meeting|sessions?|hospital|scan|knee|back|shoulder|neck)\b/i.test(
      t,
    ) && !/\b(check[\s-]?ins?|remind\w*)\b/i.test(t);
  if (topic) return null;
  const normalised = normaliseCadence(t);
  const explicitCount = timesPerWeek(normalised) !== null;
  const cue =
    /\b(check[\s-]?ins?|remind\w*|message me|text me|whatsapp me)\b/i.test(t) ||
    /^(?:hi[, ]+)?(?:please[, ]+)?(?:only|just)\b/i.test(t) ||
    /\b(?:from now on|make it|switch to|change (?:it|that|them|my))\b/i.test(t) ||
    /\b(?:can we|can you|let's|lets)\s+(?:please\s+)?(?:only\s+)?(?:do|make|check|switch|change)\b/i.test(
      t,
    ) ||
    (t.length <= 80 && /\b(?:except|not on)\b/i.test(t));
  if (cue || explicitCount || BARE_CADENCE.test(t) || BARE_CADENCE.test(normalised)) return choice;
  return null;
}

/** Sunday through Saturday, the row created before a patient has chosen. */
export function isFullWeek(days: unknown): boolean {
  return normalizeDays(days).length === 7;
}

/** Stable phrase. A sent copy of it means Buddy has already asked once. */
export const SCHEDULE_CONFIRM_MARKER = "If you'd rather fewer days";

/**
 * One question for someone still on the default daily row. Sent only on a
 * reply they already triggered, or on a check-in they were already due, and
 * only once. It does not change their days.
 */
export function scheduleConfirmText(): string {
  return `You're on a daily check-in. ${SCHEDULE_CONFIRM_MARKER}, tell me, for example "once a week" or "only Mondays". If every day is right, reply "every day".`;
}

/**
 * Whether today's weekday is one the patient asked for. The cron must use this
 * and not the frequency label: a daily label with a shorter day list still
 * means those days only. Empty or unreadable days never fire.
 */
export function reminderDueOnWeekday(daysOfWeek: unknown, weekday: number): boolean {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return false;
  return normalizeDays(daysOfWeek).includes(weekday);
}

/** Accepts a number array or a Postgres array string such as "{1,4}". */
export function normalizeDays(value: unknown): number[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? (value.match(/\d+/g) ?? [])
      : [];
  const days = raw.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return [...new Set(days)].sort((a, b) => a - b);
}

export const SCHEDULE_MSG = {
  askFrequency: (firstName: string) =>
    `Thank you ${firstName}, your consent is signed and saved. One quick thing before we start: how often would you like me to check in with you?`,
  frequencyRetry: "Please pick how often from the list, so I know when to check in.",
  askTime: "And what time of day suits you best? Pick one, or type a time like 7:30am.",
  timeRetry: "Please pick a time from the list, or type one like 7:30am.",
  confirmed: (phrase: string, time: string) =>
    `Perfect, I'll check in ${phrase} at ${sayTime(time)}.\n\nIf you ever want to stop the check-ins, just reply STOP. To change how often or the time, just tell me, for example "only twice a week", "only Tuesdays and Thursdays" or "check in at 7am".`,
  fallback: (phrase: string, time: string) =>
    `No problem, I'll check in ${phrase} at ${sayTime(time)} for now. You can change it any time, and reply STOP whenever you want the check-ins to end.`,
};
