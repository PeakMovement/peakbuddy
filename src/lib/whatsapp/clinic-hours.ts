/**
 * When the practice is open, in one place.
 *
 * This exists because "after hours" has to mean something exact before any
 * safety message can promise a response time. Peak Movement is 08:30 to 18:00,
 * confirmed by Justin on 2 October 2026.
 *
 * South Africa does not observe daylight saving, so SAST is a fixed UTC+2 and
 * this needs no timezone library. If Buddy ever runs outside South Africa this
 * is the file that has to change rather than every caller.
 */

export const SAST_OFFSET_MINUTES = 120;

/** Minutes from midnight. 08:30 and 18:00. */
export const OPEN_MINUTE = 8 * 60 + 30;
export const CLOSE_MINUTE = 18 * 60;

/**
 * Days the practice is open, 1 = Monday through 7 = Sunday.
 *
 * Saturday is OUT until Justin confirms it. That is the safe direction: an
 * open day wrongly marked closed sends the patient to emergency services
 * instead of asking them to wait, and a closed day wrongly marked open leaves
 * someone waiting for a reply that is not coming.
 */
export const OPEN_WEEKDAYS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);

/**
 * Public holidays, as YYYY-MM-DD in South African local dates. Empty until
 * someone fills it in, and an empty list means holidays are treated as open,
 * which is the unsafe direction. Flagged rather than guessed: the South African
 * public holiday list moves (observed Mondays), and a wrong one is worse than
 * an obviously empty one.
 */
export const PUBLIC_HOLIDAYS: ReadonlySet<string> = new Set<string>();

export interface SastMoment {
  /** 1 = Monday ... 7 = Sunday, in South African local time. */
  weekday: number;
  /** Minutes from local midnight. */
  minuteOfDay: number;
  /** YYYY-MM-DD, South African local date. */
  date: string;
}

export function toSast(at: Date = new Date()): SastMoment {
  const shifted = new Date(at.getTime() + SAST_OFFSET_MINUTES * 60_000);
  const day = shifted.getUTCDay(); // 0 = Sunday
  return {
    weekday: day === 0 ? 7 : day,
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    date: shifted.toISOString().slice(0, 10),
  };
}

export function isOpen(at: Date = new Date()): boolean {
  const m = toSast(at);
  if (PUBLIC_HOLIDAYS.has(m.date)) return false;
  if (!OPEN_WEEKDAYS.has(m.weekday)) return false;
  return m.minuteOfDay >= OPEN_MINUTE && m.minuteOfDay < CLOSE_MINUTE;
}

/** The opposite, named the way the safety messages talk about it. */
export function isAfterHours(at: Date = new Date()): boolean {
  return !isOpen(at);
}

/**
 * When the practice next opens, for the "will see this at ..." line. Returns a
 * Date in UTC. Looks ahead at most 14 days so a misconfigured calendar cannot
 * spin forever.
 */
export function nextOpening(at: Date = new Date()): Date | null {
  for (let i = 0; i < 14; i += 1) {
    const probe = new Date(at.getTime() + i * 24 * 60 * 60_000);
    const m = toSast(probe);
    if (PUBLIC_HOLIDAYS.has(m.date) || !OPEN_WEEKDAYS.has(m.weekday)) continue;
    // Today, before opening: it opens later today.
    if (i === 0 && m.minuteOfDay < OPEN_MINUTE) {
      return new Date(probe.getTime() + (OPEN_MINUTE - m.minuteOfDay) * 60_000);
    }
    // Today, already open or past closing: only a later day counts.
    if (i === 0) continue;
    return new Date(probe.getTime() + (OPEN_MINUTE - m.minuteOfDay) * 60_000);
  }
  return null;
}

/** "08:30" style, for dropping into a patient message. */
export function openingTimeLabel(): string {
  const h = Math.floor(OPEN_MINUTE / 60);
  const m = OPEN_MINUTE % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
