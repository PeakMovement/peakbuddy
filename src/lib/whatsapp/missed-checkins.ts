/**
 * Consecutive scheduled check-ins with no response, counted in South African
 * time. Today is not a miss: the day is still open. A check-in on a scheduled
 * day ends the streak.
 */

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

export function sastDayKey(instant: Date): string {
  return new Date(instant.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 10);
}

export function sastWeekday(dayKey: string): number {
  return new Date(`${dayKey}T00:00:00Z`).getUTCDay();
}

/**
 * `daysOfWeek` uses JavaScript's Sunday = 0. `checkInDayKeys` are SAST dates
 * (YYYY-MM-DD) that have a check-in. Returns how many scheduled days in a row,
 * walking backward from yesterday, have none.
 */
export function consecutiveMissedCheckins(
  daysOfWeek: number[],
  checkInDayKeys: string[],
  now: Date,
  lookback = 14,
): number {
  if (daysOfWeek.length === 0) return 0;
  const have = new Set(checkInDayKeys);
  const today = sastDayKey(now);
  let missed = 0;
  const cursor = new Date(`${today}T00:00:00Z`);
  for (let i = 0; i < lookback; i++) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const key = cursor.toISOString().slice(0, 10);
    if (!daysOfWeek.includes(sastWeekday(key))) continue;
    if (have.has(key)) break;
    missed++;
  }
  return missed;
}
