/**
 * One stored fact, in English, with no reading of what the number means.
 * "Nice" is allowed only beside a drop of 2 or more. It is not a clinical claim.
 */

export function contextFact(input: {
  lastPain?: number | null;
  recentPain?: number | null;
  goal?: string | null;
  goalMentions?: number;
  appointmentAt?: string | null;
  streak?: number;
}): string | null {
  const last = input.lastPain;
  const now = input.recentPain;
  if (typeof last === "number" && typeof now === "number" && last - now >= 2) {
    return `Pain's down from ${last} last time. Nice.`;
  }
  if (typeof last === "number" && typeof now === "number" && now - last >= 2) {
    return `Last time pain was ${last}.`;
  }
  const when = input.appointmentAt?.trim();
  if (when) return `Your next visit on record is ${when}.`;
  if ((input.streak ?? 0) >= 3) return `${input.streak} check ins in a row.`;
  const goal = input.goal?.trim();
  if (goal && (input.goalMentions ?? 0) < 2) return `You're working towards: ${goal}.`;
  if (typeof last === "number") return `Last time pain was ${last}.`;
  return null;
}

export type OutreachKind = "day_after" | "flare" | "milestone" | "discharge_check";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a capped, opt in outreach is due.
 * Inside the 24 hour window the caller sends fixed free text.
 * Outside it, the caller sends the named template or skips.
 */
export function dueOutreach(input: {
  optIn: boolean;
  now: Date;
  lastOutreachAt: Date | null;
  sessionYesterday: boolean;
  flareYesterday: boolean;
  streak: number;
  dischargedAt: Date | null;
  alreadySent: OutreachKind[];
  windowOpen: boolean;
}): { kind: OutreachKind; useTemplate: boolean } | null {
  if (!input.optIn) return null;
  if (input.lastOutreachAt && input.now.getTime() - input.lastOutreachAt.getTime() < WEEK_MS) {
    return null;
  }
  const sent = new Set(input.alreadySent);
  let kind: OutreachKind | null = null;
  if (input.flareYesterday && !sent.has("flare")) kind = "flare";
  else if (input.sessionYesterday && !sent.has("day_after")) kind = "day_after";
  else if ([7, 14, 30].includes(input.streak) && !sent.has("milestone")) kind = "milestone";
  else if (input.dischargedAt && !sent.has("discharge_check")) {
    const age = input.now.getTime() - input.dischargedAt.getTime();
    if (age >= 13 * DAY_MS && age <= 16 * DAY_MS) kind = "discharge_check";
  }
  if (!kind) return null;
  return { kind, useTemplate: !input.windowOpen };
}

export const OUTREACH_TEMPLATES: Record<
  OutreachKind,
  { env: string; fallbackInWindow: (name: string, practice: string) => string }
> = {
  day_after: {
    env: "WHATSAPP_TEMPLATE_DAY_AFTER",
    fallbackInWindow: (name, practice) =>
      `Hi ${name}, it's Buddy from ${practice}. How is the area you worked on yesterday? Reply here and I'll pass it to your physio.`,
  },
  flare: {
    env: "WHATSAPP_TEMPLATE_FLARE",
    fallbackInWindow: (name, practice) =>
      `Hi ${name}, it's Buddy from ${practice}. You mentioned a harder day yesterday. Reply here if you want to log this morning. If it is urgent, phone the practice.`,
  },
  milestone: {
    env: "WHATSAPP_TEMPLATE_MILESTONE",
    fallbackInWindow: (name, practice) =>
      `Hi ${name}, it's Buddy from ${practice}. That's a run of check ins. Reply if you want to log today.`,
  },
  discharge_check: {
    env: "WHATSAPP_TEMPLATE_DISCHARGE_CHECK",
    fallbackInWindow: (name, practice) =>
      `Hi ${name}, it's Buddy from ${practice}. It has been two weeks since discharge. Reply if you want your physio to know how things are. This does not book a visit.`,
  },
};
