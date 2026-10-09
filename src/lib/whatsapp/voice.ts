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

export function opener(ctx: VoiceContext): string {
  if (!ctx.checkinsDone)
    return `Hi ${ctx.firstName}, time for your first check-in. It's four quick questions.`;
  const g = greeting(ctx);
  return pick(
    [
      `${g}, time for a quick check-in.`,
      `${g}, ready for today's check-in? Four quick questions.`,
      `${g}, let's see how today's been.`,
      `${g}, quick check-in time.`,
    ],
    ctx.now,
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
    if (pain < last) ack = `Thanks, ${pain} today, down from ${last} last time.`;
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
