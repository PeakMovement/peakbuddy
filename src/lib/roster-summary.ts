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
  },
  windowCount: number,
  now: number = Date.now(),
  windowDays: number = ROSTER_WINDOW_DAYS,
): number | null {
  const interval = cadenceDays(client.check_in_frequency);
  if (interval === 0) return 100;
  const start = new Date(client.created_at).getTime();
  const weeks = client.tracking_duration_weeks ?? 8;
  const periodStart = Math.max(start, now - windowDays * DAY_MS);
  const periodEnd = Math.min(now, start + weeks * 7 * DAY_MS);
  if (periodEnd <= periodStart) return null;
  const days = Math.max(1, Math.ceil((periodEnd - periodStart) / DAY_MS));
  const expected = Math.max(1, Math.ceil(days / interval));
  return Math.min(100, Math.round((windowCount / expected) * 100));
}
