/**
 * Buddy's voice in the fixed check-in messages (9 Oct 2026: "evolve the
 * language"). Pure, so every line is testable.
 *
 * Principles:
 *  - Vary, don't repeat: openers rotate by date, so the same patient doesn't
 *    get the same sentence every evening.
 *  - Short once they know the drill: after three check-ins the pain question
 *    drops its explanation.
 *  - Acknowledge before the next question, in a few words, folded into the
 *    same message so the chat doesn't fill up.
 *  - Facts, never meaning: "4, down from 6 last time" is fine; "you're
 *    healing well" is not. Big rises are the red-flag rules' job, not this.
 */

export interface VoiceContext {
  firstName: string;
  now: Date;
  /** Check-ins already on record (before this one). */
  checkinsDone?: number;
  /** Pain at the last check-in on record. */
  lastPain?: number | null;
  /** Days in a row with a check-in, counting today's when it is saved. */
  streak?: number;
  practitionerFirstName?: string | null;
  /** A goal they or their physio wrote. Repeated, never rewritten. */
  goal?: string | null;
  /** How many times the goal was already said this week. After two, leave it off. */
  goalMentions?: number;
  /** Salts the opener so two patients do not get the same line on the same evening. */
  clientId?: string | null;
}

const SAST_MS = 2 * 60 * 60 * 1000;
const sastHour = (d: Date) => new Date(d.getTime() + SAST_MS).getUTCHours();
const dayIndex = (d: Date) => Math.floor((d.getTime() + SAST_MS) / 86_400_000);
const pick = <T>(list: T[], d: Date, salt = 0): T => list.at((dayIndex(d) + salt) % list.length)!;

export function greeting(ctx: VoiceContext): string {
  const h = sastHour(ctx.now);
  const part = h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening";
  return `${part} ${ctx.firstName}`;
}

function saltOf(id?: string | null): number {
  if (!id) return 0;
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n + id.charCodeAt(i)) % 997;
  return n;
}

/** One fact only. A one point change is not announced as a trend. */
function personalFacts(ctx: VoiceContext): string {
  if ((ctx.streak ?? 0) >= 7) return `${ctx.streak} check-ins in a row.`;
  if ((ctx.streak ?? 0) >= 3) return `${ctx.streak} check-ins in a row.`;
  const goal = ctx.goal?.trim();
  if (goal && (ctx.goalMentions ?? 0) < 2) return `You're working towards: ${goal}.`;
  if (typeof ctx.lastPain === "number") return `Last time pain was ${ctx.lastPain}.`;
  if (ctx.practitionerFirstName) return `${ctx.practitionerFirstName} can see this.`;
  return "";
}

export function opener(ctx: VoiceContext): string {
  const facts = personalFacts(ctx);
  const withFacts = (line: string) => (facts ? `${line} ${facts}` : line);
  if (!ctx.checkinsDone)
    return withFacts(
      `Hi ${ctx.firstName}, time for your first check-in. It's a few quick questions.`,
    );
  const g = greeting(ctx);
  return withFacts(
    pick(
      [
        `${g}, time for a quick check-in.`,
        `${g}, ready for today's check-in? A few quick questions.`,
        `${g}, let's see how today's been.`,
        `${g}, quick check-in time.`,
      ],
      ctx.now,
      saltOf(ctx.clientId),
    ),
  );
}

export const PAIN_FULL =
  "How is your pain right now? Reply with a number from 0 (no pain) to 10 (worst pain imaginable).";
export const PAIN_SHORT = "How's your pain right now, 0 to 10?";

export function painQuestion(ctx: VoiceContext): string {
  return (ctx.checkinsDone ?? 0) >= 3 ? PAIN_SHORT : PAIN_FULL;
}

/** A few words on the pain answer, then the sleep question in the same message. */
export function afterPain(ctx: VoiceContext, pain: number): string {
  const last = ctx.lastPain;
  let ack = "Thanks.";
  if (typeof last === "number") {
    if (pain < last && last - pain === 1) ack = `Thanks, ${pain}.`;
    else if (pain < last) ack = `Thanks, ${pain} today, down from ${last} last time.`;
    else if (pain === last) ack = `Thanks, ${pain} again today.`;
    else ack = `Thanks for letting me know, ${pain} today.`;
  }
  return `${ack}\n\nHow did you sleep last night?`;
}

export function afterSleep(ctx: VoiceContext): string {
  return `${pick(["Got it.", "Noted.", "Thanks."], ctx.now, 1)} How is your energy today?`;
}

export function afterEnergy(ctx: VoiceContext): string {
  return `${pick(["Last one.", "Nearly done.", "Last question."], ctx.now, 2)} Anything else you'd like your physiotherapist to know? Type it here, or tap Nothing to add.`;
}

/**
 * The line a practitioner asks Buddy to send. `<name>` in the preview is the
 * patient's first name; the real send fills it in. The practice name is the
 * one on the account, so the sentence is never invented.
 */
const CHECKIN_OPENERS: Array<(who: string, practice: string) => string> = [
  (who, practice) => `Hi ${who}, it's Buddy from ${practice}, checking in on how you're doing.`,
  (who, practice) => `Hi ${who}, Buddy here from ${practice}. Quick check in when you have a moment.`,
  (who, practice) => `${who}, it's Buddy at ${practice}. How are you doing today?`,
  (who, practice) => `Hi ${who}, ${practice} asked me to check in.`,
];

export function practitionerCheckinText(
  firstName: string,
  practiceName: string,
  note?: string | null,
  vary?: { clientId?: string; now?: Date } | null,
): string {
  const practice = practiceName.trim() || "Peak Movement";
  const who = firstName.trim() || "there";
  const listIndex =
    vary?.now && vary.clientId
      ? (dayIndex(vary.now) + saltOf(vary.clientId)) % CHECKIN_OPENERS.length
      : 0;
  const base = CHECKIN_OPENERS[listIndex](who, practice);
  const extra = note?.trim();
  return extra ? `${base} ${extra}` : base;
}

/** The wording typed on Edit. `<name>` is the only substitution. */
export function verbatimCheckinText(firstName: string, text: string): string {
  const who = firstName.trim() || "there";
  return text.replace(/\s+/g, " ").trim().replace(/<name>/gi, who);
}

/** Confirmation the practitioner sees before anyone is messaged. */
export function practitionerConfirmSend(
  who: string,
  preview: string,
  notes?: string | null,
): string {
  const lead = `I'll message ${who}: "${preview}"`;
  const extra = notes?.trim();
  return extra ? `${lead}\n\n${extra}\n\nSend?` : `${lead} Send?`;
}

export function saved(ctx: VoiceContext): string {
  const who = ctx.practitionerFirstName ? ctx.practitionerFirstName : "your physiotherapist";
  const base = `Thanks ${ctx.firstName}, that's saved and ${who} can see it.`;
  const n = ctx.streak ?? 0;
  if (n === 7) return `${base} That's a full week of check-ins in a row, well done.`;
  if (n === 14) return `${base} Two weeks in a row now, that's great consistency.`;
  if (n === 30) return `${base} 30 days in a row. Seriously impressive.`;
  if (n >= 3) return `${base} That's ${n} days in a row.`;
  return base;
}
