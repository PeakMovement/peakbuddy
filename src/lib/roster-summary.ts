/**
 * Pure helpers for the practitioner roster. The roster reads a bounded recent
 * window of check-ins (not a client's whole history), so compliance is scored
 * over that same window rather than against the full programme.
 */

export const ROSTER_WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;

export interface CheckInSummary {
  /** ISO timestamp of the newest check-in we know of, or null if none. */
  last: string | null;
  /** Check-ins inside the roster window. */
  windowCount: number;
}

/** Rows must be ordered newest first (as the roster query returns them). */
export function summarizeCheckIns(
  rows: { client_id: string; created_at: string }[],
): Record<string, CheckInSummary> {
  const out: Record<string, CheckInSummary> = {};
  for (const r of rows) {
    const s = out[r.client_id];
    if (!s) out[r.client_id] = { last: r.created_at, windowCount: 1 };
    else {
      s.windowCount += 1;
      if (r.created_at > (s.last ?? "")) s.last = r.created_at;
    }
  }
  return out;
}

/** Days between expected check-ins, or 0 when there is no fixed schedule. */
export function cadenceDays(freq: string | null | undefined): number {
  switch (freq) {
    case "every_2_days":
      return 2;
    case "every_3_days":
      return 3;
    case "weekly":
      return 7;
    case "as_needed":
      return 0;
    default:
      return 1;
  }
}

const SAST_MS = 2 * 60 * 60 * 1000;

/** Weekdays stored on checkin_reminders: 0 = Sunday … 6 = Saturday. */
export function normalizeWeekdays(days: readonly number[] | null | undefined): number[] {
  return [...new Set((days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
    (a, b) => a - b,
  );
}

/**
 * The clients.check_in_frequency label that matches a saved weekday set.
 * Seven days is daily, one day is weekly, none is as-needed, anything else
 * is custom (Mon/Wed/Fri is not "daily").
 */
export function frequencyFromDays(days: readonly number[] | null | undefined): string {
  const unique = normalizeWeekdays(days);
  if (unique.length === 0) return "as_needed";
  if (unique.length >= 7) return "daily";
  if (unique.length === 1) return "weekly";
  return "custom";
}

function sastDateKey(ms: number): string {
  return new Date(ms + SAST_MS).toISOString().slice(0, 10);
}

/**
 * How many of `daysOfWeek` fall on SAST calendar dates from `startMs` through
 * `endMs`, both inclusive. A full week is not special-cased: callers that want
 * the old "one per elapsed day" score should skip this.
 */
export function countScheduledDays(
  startMs: number,
  endMs: number,
  daysOfWeek: readonly number[],
): number {
  if (!(endMs >= startMs)) return 0;
  const set = new Set(normalizeWeekdays(daysOfWeek));
  if (set.size === 0) return 0;
  const endKey = sastDateKey(endMs);
  const cursor = new Date(`${sastDateKey(startMs)}T12:00:00Z`);
  let count = 0;
  for (let i = 0; i < 800; i += 1) {
    const key = cursor.toISOString().slice(0, 10);
    if (key > endKey) break;
    if (set.has(cursor.getUTCDay())) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function partialWeek(days: readonly number[] | null | undefined): number[] | null {
  const unique = normalizeWeekdays(days);
  if (unique.length === 0 || unique.length >= 7) return null;
  return unique;
}

/**
 * Compliance % over the part of the client's tracking period that falls inside
 * the roster window. Null when the period and the window don't overlap (the
 * programme ended before the window started), so the UI can show a dash.
 */
export function windowCompliance(
  client: {
    created_at: string;
    tracking_duration_weeks?: number | null;
    check_in_frequency?: string | null;
    /** checkin_reminders.days_of_week. A partial week replaces the frequency interval. */
    days_of_week?: number[] | null;
  },
  windowCount: number,
  now: number = Date.now(),
  windowDays: number = ROSTER_WINDOW_DAYS,
): number | null {
  const start = new Date(client.created_at).getTime();
  const weeks = client.tracking_duration_weeks ?? 8;
  const periodStart = Math.max(start, now - windowDays * DAY_MS);
  const periodEnd = Math.min(now, start + weeks * 7 * DAY_MS);
  if (periodEnd <= periodStart) return null;
  const scheduled = partialWeek(client.days_of_week);
  if (scheduled) {
    const expected = countScheduledDays(periodStart, periodEnd, scheduled);
    if (expected <= 0) return 100;
    return Math.min(100, Math.round((windowCount / expected) * 100));
  }
  const interval = cadenceDays(client.check_in_frequency);
  if (interval === 0) return 100;
  const days = Math.max(1, Math.ceil((periodEnd - periodStart) / DAY_MS));
  const expected = Math.max(1, Math.ceil(days / interval));
  return Math.min(100, Math.round((windowCount / expected) * 100));
}

/**
 * Compliance across the programme so far (client detail, admin list, progress).
 * A partial weekday schedule is counted in SAST. A full week, or no reminder
 * row, keeps the frequency interval. as_needed stays 100.
 */
export function programmeCompliance(
  client: {
    created_at: string;
    tracking_duration_weeks?: number | null;
    check_in_frequency?: string | null;
    days_of_week?: number[] | null;
  },
  checkInCount: number,
  now: number = Date.now(),
): number {
  const start = new Date(client.created_at).getTime();
  if (!Number.isFinite(start)) return 0;
  const weeks = client.tracking_duration_weeks ?? 8;
  const end = Math.min(now, start + weeks * 7 * DAY_MS);
  const scheduled = partialWeek(client.days_of_week);
  if (scheduled) {
    if (end < start) return checkInCount > 0 ? 100 : 0;
    const expected = countScheduledDays(start, end, scheduled);
    if (expected <= 0) return 100;
    return Math.min(100, Math.round((checkInCount / expected) * 100));
  }
  const interval = cadenceDays(client.check_in_frequency);
  if (interval === 0) return 100;
  const elapsed = Math.max(1, Math.ceil((now - start) / DAY_MS));
  const expectedSoFar = Math.min(
    Math.ceil(elapsed / interval),
    Math.max(1, Math.ceil((weeks * 7) / interval)),
  );
  return Math.min(100, Math.round((checkInCount / expectedSoFar) * 100));
}
