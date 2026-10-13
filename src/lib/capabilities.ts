/**
 * Pure decisions for the capability review. No database, no send, no clock
 * the caller did not pass in.
 *
 * Patient messages are never implied by these functions. A "send" result
 * still has to be confirmed by the practitioner before anything goes out,
 * except where the caller is only formatting text the patient already asked
 * for inside an open chat.
 */

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const ADHERENCE = ["all", "most", "some", "none"] as const;
export type AdherenceValue = (typeof ADHERENCE)[number];

/** Change from this patient's own baseline. Not shown on the patient app. */
export function riskBaselineLabel(input: {
  score: number;
  previous: number | null;
  trend?: string | null;
}): { headline: string; detail: string } {
  const score = clamp(Math.round(input.score), 0, 100);
  const prev = input.previous;
  const delta = prev == null ? null : score - prev;
  const moved =
    delta == null
      ? "No earlier score to compare."
      : delta === 0
        ? "Same as the previous score."
        : delta > 0
          ? `Up ${delta} from the previous score.`
          : `Down ${Math.abs(delta)} from the previous score.`;
  return {
    headline: `Risk ${score}/100, measured against this patient's own 30-day baseline.`,
    detail: [moved, input.trend ? `Trend: ${input.trend}.` : ""].filter(Boolean).join(" "),
  };
}

export function patternInsightDraft(input: {
  clientName: string;
  dayOfWeek: number;
  metric: "pain" | "energy" | "stress" | "sleep";
  direction: "high" | "low";
}): { title: string; body: string } {
  const day = DAY_NAMES[input.dayOfWeek] ?? "That day";
  const what =
    input.metric === "pain"
      ? "pain runs higher"
      : input.metric === "stress"
        ? "stress runs higher"
        : input.metric === "sleep"
          ? "sleep runs lower"
          : "energy runs lower";
  return {
    title: `${day} pattern`,
    body: `${input.clientName}: over the last 90 days, ${what} on ${day}s. This is a pattern in their own check-ins, not a prediction. A patient message is not sent from this draft.`,
  };
}

/**
 * A pattern draft always goes to the physio. A patient nudge needs the
 * client's own opt-in, the feature flag, and a separate practitioner confirm.
 */
export function patternPatientNudge(input: {
  predictiveNudgesEnabled: boolean;
  featureEnabled: boolean;
  practitionerConfirmed: boolean;
}): "draft_only" | "await_confirm" | "send" {
  if (!input.featureEnabled || !input.predictiveNudgesEnabled) return "draft_only";
  if (!input.practitionerConfirmed) return "await_confirm";
  return "send";
}

/** Association, not a cause. Null when there is nothing to say. */
export function wearableAssociationSentence(input: {
  acuteChronicRatio: number | null;
  sleepScore: number | null;
  painNow: number | null;
  painPrev: number | null;
}): string | null {
  const painUp =
    input.painNow != null && input.painPrev != null && input.painNow - input.painPrev >= 2;
  const highLoad = input.acuteChronicRatio != null && input.acuteChronicRatio >= 1.3;
  const poorSleep = input.sleepScore != null && input.sleepScore < 60;
  if (!painUp && !highLoad && !poorSleep) return null;
  const bits: string[] = [];
  if (highLoad && input.acuteChronicRatio != null) {
    bits.push(`acute-to-chronic load is ${input.acuteChronicRatio.toFixed(2)}`);
  }
  if (poorSleep && input.sleepScore != null) bits.push(`sleep score is ${input.sleepScore}`);
  if (painUp && input.painNow != null && input.painPrev != null) {
    bits.push(`pain is ${input.painNow}, up from ${input.painPrev}`);
  }
  return `Association only, not a cause: ${bits.join("; ")}.`;
}

export function recoveryComparison(input: {
  complaint: string;
  daysSinceStart: number;
  painDrop: number;
  peers: Array<{ complaint: string; days: number; painDrop: number }>;
}): { n: number; low: number; high: number; sentence: string } | null {
  const label = input.complaint.trim();
  if (!label) return null;
  const same = input.peers.filter(
    (p) => p.complaint.trim().toLowerCase() === label.toLowerCase() && p.days > 0,
  );
  if (same.length < 3) return null;
  const drops = same.map((p) => p.painDrop);
  const low = Math.min(...drops);
  const high = Math.max(...drops);
  return {
    n: same.length,
    low,
    high,
    sentence: `Among ${same.length} other patients at this practice with "${label}", the change in pain over a similar stretch ranged from ${low} to ${high}. This patient's change so far is ${input.painDrop} over ${input.daysSinceStart} days. This is this practice's history, not a target.`,
  };
}

export interface ScorecardRow {
  initials: string;
  complaint: string;
  daysSinceCheckIn: number | null;
}

export function ownerScorecard(rows: ScorecardRow[]): {
  byPractitioner: Array<{ initials: string; active: number; quiet: number }>;
  byComplaint: Array<{ complaint: string; count: number }>;
  dropOff: { within7: number; days8to30: number; over30: number; never: number };
} {
  const prac = new Map<string, { active: number; quiet: number }>();
  const complaints = new Map<string, number>();
  const dropOff = { within7: 0, days8to30: 0, over30: 0, never: 0 };
  for (const row of rows) {
    const bucket = prac.get(row.initials) ?? { active: 0, quiet: 0 };
    const quiet = row.daysSinceCheckIn == null || row.daysSinceCheckIn >= 4;
    if (quiet) bucket.quiet += 1;
    else bucket.active += 1;
    prac.set(row.initials, bucket);
    const complaint = row.complaint.trim() || "Unlabelled";
    complaints.set(complaint, (complaints.get(complaint) ?? 0) + 1);
    if (row.daysSinceCheckIn == null) dropOff.never += 1;
    else if (row.daysSinceCheckIn <= 7) dropOff.within7 += 1;
    else if (row.daysSinceCheckIn <= 30) dropOff.days8to30 += 1;
    else dropOff.over30 += 1;
  }
  return {
    byPractitioner: [...prac.entries()].map(([initials, v]) => ({ initials, ...v })),
    byComplaint: [...complaints.entries()]
      .map(([complaint, count]) => ({ complaint, count }))
      .sort((a, b) => b.count - a.count),
    dropOff,
  };
}

export function formatOwnerScorecard(
  card: ReturnType<typeof ownerScorecard>,
): string {
  const lines = [
    "Outcomes and retention. Counts, initials, and complaint labels only.",
    `Checked in within 7 days: ${card.dropOff.within7}. 8 to 30 days: ${card.dropOff.days8to30}. Over 30 days: ${card.dropOff.over30}. Never: ${card.dropOff.never}.`,
  ];
  for (const p of card.byPractitioner) {
    lines.push(`${p.initials}: ${p.active} current, ${p.quiet} quiet.`);
  }
  for (const c of card.byComplaint.slice(0, 8)) {
    lines.push(`${c.complaint}: ${c.count}.`);
  }
  return lines.join("\n");
}

/** Practitioner only. Does not write Heidi text anywhere else. */
export function caseBrief(input: {
  clientName: string;
  heidiNote: string | null;
  heidiDate: string | null;
  checkins: Array<{
    at: string;
    pain: number | null;
    sleep: number | null;
    energy: number | null;
    stress: number | null;
  }>;
  wearable: { sleepScore: number | null; loadRatio: number | null } | null;
  goal: string | null;
}): { text: string; storedInPatientMemory: false; sentToModel: false } {
  const recent = input.checkins.slice(0, 7);
  const pains = recent.map((c) => c.pain).filter((n): n is number => n != null);
  const painLine =
    pains.length >= 2
      ? `Check-ins: pain ${pains[pains.length - 1]} to ${pains[0]} across ${recent.length} recent entries.`
      : pains.length === 1
        ? `Check-ins: latest pain ${pains[0]}.`
        : "Check-ins: none in this window.";
  const watch = input.wearable
    ? `Watch: sleep ${input.wearable.sleepScore ?? "n/a"}, load ratio ${input.wearable.loadRatio ?? "n/a"}.`
    : "Watch: not connected.";
  const note = input.heidiNote?.trim()
    ? `Session note (${input.heidiDate ?? "date not stored"}): ${input.heidiNote.trim()}`
    : "Session note: none stored in heidi_records.";
  const goal = input.goal?.trim() ? `Goal they set: ${input.goal.trim()}` : "Goal: none set.";
  return {
    text: [`Case brief for ${input.clientName}. Practitioner only.`, painLine, watch, goal, note].join(
      "\n",
    ),
    storedInPatientMemory: false,
    sentToModel: false,
  };
}

export function movementLines(input: {
  name: string;
  painThen: number | null;
  painNow: number | null;
  sleepThen: number | null;
  sleepNow: number | null;
  pattern: string | null;
}): string[] {
  const lines: string[] = [];
  if (input.painThen != null && input.painNow != null && input.painNow !== input.painThen) {
    const verb = input.painNow < input.painThen ? "fell" : "rose";
    lines.push(`${input.name}: pain ${verb} from ${input.painThen} to ${input.painNow}.`);
  }
  if (input.sleepThen != null && input.sleepNow != null && input.sleepNow <= 2 && input.sleepNow < input.sleepThen) {
    lines.push(`${input.name}: sleep dropped from ${input.sleepThen} to ${input.sleepNow}.`);
  }
  if (input.pattern) lines.push(`${input.name}: ${input.pattern}`);
  return lines;
}

export function adherenceVersusCompliance(input: {
  expectedCheckins: number;
  answered: number;
  adherence: Array<AdherenceValue | null>;
}): { compliancePct: number | null; adherenceLabel: string; caveat: string } {
  const caveat = "Self-reported. A missed answer is not counted as did not exercise.";
  const compliancePct =
    input.expectedCheckins > 0
      ? Math.round((input.answered / input.expectedCheckins) * 100)
      : null;
  const answered = input.adherence.filter((a): a is AdherenceValue => a != null);
  if (!answered.length) {
    return { compliancePct, adherenceLabel: "No exercise answers yet.", caveat };
  }
  const counts = { all: 0, most: 0, some: 0, none: 0 };
  for (const a of answered) counts[a] += 1;
  const top = (Object.entries(counts) as Array<[AdherenceValue, number]>).sort(
    (a, b) => b[1] - a[1],
  )[0];
  return {
    compliancePct,
    adherenceLabel: `Home programme, self-reported: mostly "${top[0]}" (${answered.length} answers).`,
    caveat,
  };
}

/** Warmth from facts already on the record. No complaint, no session note. */
export function deterministicTone(input: {
  firstName: string;
  practitionerFirstName: string | null;
  lastPain: number | null;
  streak: number;
  goal: string | null;
}): string {
  const who = input.practitionerFirstName ?? "your physiotherapist";
  const pain =
    input.lastPain == null ? "" : ` Last time pain was ${input.lastPain}.`;
  const streak = input.streak >= 3 ? ` ${input.streak} check-ins in a row.` : "";
  const goal = input.goal?.trim() ? ` You're working towards: ${input.goal.trim()}.` : "";
  return `Hi ${input.firstName}. ${who} can see this check-in.${pain}${streak}${goal}`;
}

/** Move the stored reminder toward the hour they actually reply. One step, max 60 minutes. */
export function shiftedReminderTime(input: {
  current: string;
  replyHour: number;
  replyMinute: number;
  samplesAtThisHour: number;
}): string | null {
  if (input.samplesAtThisHour < 3) return null;
  const [h, m] = input.current.split(":").map((n) => Number(n));
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  const current = h * 60 + m;
  const target = clamp(input.replyHour, 0, 23) * 60 + clamp(input.replyMinute, 0, 59);
  const delta = target - current;
  if (Math.abs(delta) < 45) return null;
  const step = Math.sign(delta) * Math.min(60, Math.abs(delta));
  const next = (current + step + 1440) % 1440;
  return `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
}

export function quietNudgeDecision(input: {
  quietDays: number;
  lastPhysioNotifiedOn: string | null;
  lastPatientSentOn: string | null;
  nudgesInWindow: number;
  today: string;
  featureEnabled: boolean;
  practitionerConfirmed: boolean;
  windowOpen: boolean;
  reminderTemplateSet: boolean;
}): { tellPhysio: boolean; sendPatient: boolean; skipReason: string | null } {
  if (!input.featureEnabled) return { tellPhysio: false, sendPatient: false, skipReason: "flag_off" };
  if (input.quietDays < 4) return { tellPhysio: false, sendPatient: false, skipReason: "not_quiet" };
  if (input.nudgesInWindow >= 3) {
    return { tellPhysio: false, sendPatient: false, skipReason: "monthly_cap" };
  }
  const weekAgo = daysBefore(input.today, 7);
  if (input.lastPatientSentOn && input.lastPatientSentOn > weekAgo) {
    return { tellPhysio: false, sendPatient: false, skipReason: "sent_this_week" };
  }
  if (!input.practitionerConfirmed) {
    const tell = input.lastPhysioNotifiedOn !== input.today;
    return { tellPhysio: tell, sendPatient: false, skipReason: tell ? null : "already_asked_today" };
  }
  if (!input.windowOpen && !input.reminderTemplateSet) {
    return { tellPhysio: false, sendPatient: false, skipReason: "no_template" };
  }
  return { tellPhysio: false, sendPatient: true, skipReason: null };
}

export function programmeReminderDecision(input: {
  featureEnabled: boolean;
  optedIn: boolean;
  days: number[];
  weekday: number;
  lastSentOn: string | null;
  today: string;
  windowOpen: boolean;
  templateSet: boolean;
}): "send_text" | "send_template" | "skip" {
  if (!input.featureEnabled || !input.optedIn) return "skip";
  if (!input.days.includes(input.weekday)) return "skip";
  if (input.lastSentOn === input.today) return "skip";
  if (input.windowOpen) return "send_text";
  return input.templateSet ? "send_template" : "skip";
}

export function programmeReminderBody(input: {
  firstName: string;
  libraryLive: boolean;
  exerciseName: string | null;
  appLink: string;
}): string {
  const exercise =
    input.libraryLive && input.exerciseName?.trim()
      ? ` Today's exercise: ${input.exerciseName.trim()}.`
      : "";
  return `Hi ${input.firstName}. Time for the programme your physio gave you.${exercise} ${input.appLink}`;
}

export function digestTeaser(input: { firstName: string; attention: number; names: string[] }): {
  variables: [string, string];
  freeform: string;
} {
  const names = input.names.length ? input.names.join(", ") : "Nobody new to flag.";
  return {
    variables: [input.firstName, String(input.attention)],
    freeform: `Your week: ${input.attention} to look at. ${names}`,
  };
}

export function programmeAnswer(input: {
  assigned: string | null;
  libraryLive: boolean;
  libraryUrl: string;
}): string {
  if (input.assigned?.trim()) {
    const where = input.libraryLive
      ? `It is in the app: ${input.libraryUrl}`
      : `The exercise library is not fully open in the app yet. Library: ${input.libraryUrl}`;
    return `Your physio gave you: ${input.assigned.trim()}. ${where}`;
  }
  return `Your exercise programme is in the Buddy app under Library: ${input.libraryUrl}`;
}

export function appointmentAnswer(when: string | null): string {
  if (when?.trim()) {
    return `Your next appointment on record is ${when.trim()}. Reception keeps the diary, so I can't move it from here.`;
  }
  return "I don't have an appointment time on your record. Reception keeps the diary.";
}

export function bookingTask(patientName: string, text: string): string {
  const words = text.replace(/\s+/g, " ").trim().slice(0, 400);
  return `${patientName} asked: ${words}. Please arrange it. Do not assume a free slot.`;
}

export function bookingAsk(task: string): string {
  return `I'll ask reception to handle this: ${task} Reply YES to pass that on, or NO to cancel.`;
}

export function bookingSent(bookUrl: string): string {
  return `I've asked reception. They will confirm a time with you. You can also book online: ${bookUrl}`;
}

/** Outside the 24 hour window the confirmation uses this template, or it is skipped. */
export function bookingTemplate(input: {
  windowOpen: boolean;
  templateSet: boolean;
}): "text" | "template" | "skip" {
  if (input.windowOpen) return "text";
  return input.templateSet ? "template" : "skip";
}

export function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function whoImproved(
  rows: Array<{ name: string; painThen: number | null; painNow: number | null }>,
): string {
  const improved = rows.filter(
    (r) => r.painThen != null && r.painNow != null && r.painNow < r.painThen,
  );
  if (!improved.length) return "Nobody's pain is lower than it was at the start of this week.";
  return improved
    .map((r) => `${r.name}: pain ${r.painThen} to ${r.painNow}.`)
    .join("\n");
}

export function checkinFlowDefinition(): {
  live: false;
  screens: string[];
} {
  return {
    live: false,
    screens: ["pain", "sleep", "energy", "stress", "exercise_adherence", "notes"],
  };
}

const DAY_WORD: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

/** Days the physio named. Sunday is 0, matching JavaScript's weekday. */
export function parseProgrammeDays(text: string): number[] {
  const found = new Set<number>();
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const word of words) {
    const day = DAY_WORD[word];
    if (day != null) found.add(day);
  }
  return [...found].sort((a, b) => a - b);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function daysBefore(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
