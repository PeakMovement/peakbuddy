/**
 * A short look back for the patient, at most once a week, added to the end
 * of a check-in they've just finished (so it's always inside the WhatsApp
 * window). Seeing the number move is the best reason to keep checking in.
 *
 * Only good or steady news goes to the patient. A rising trend is for the
 * physio (trend signals), not something Buddy announces to the patient.
 * Facts only: the numbers they gave, never an interpretation.
 */
import { claimOnce } from "@/lib/job-claims.server";
import { toSast } from "./clinic-hours";

type Db = { from: (t: string) => any };

export const PROGRESS_JOB = "progress_note";
const DAY = 86_400_000;

export interface PainPoint {
  pain: number;
  at: string;
}

/** Monday of the South African week, as YYYY-MM-DD. */
export function weekKey(now: Date): string {
  const m = toSast(now);
  const d = new Date(`${m.date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (m.weekday - 1));
  return d.toISOString().slice(0, 10);
}

/** The line to send, or null. Pure. */
export function progressLine(points: PainPoint[], latest: number, now: Date): string | null {
  const recent = points
    .filter((p) => now.getTime() - new Date(p.at).getTime() <= 15 * DAY)
    .sort((a, b) => a.at.localeCompare(b.at));
  if (recent.length < 3) return null;
  const spanDays = (now.getTime() - new Date(recent[0].at).getTime()) / DAY;
  if (spanDays < 7) return null;
  const early = recent.slice(0, Math.min(2, recent.length));
  const start = Math.round(early.reduce((n, p) => n + p.pain, 0) / early.length);
  const weeks = spanDays >= 12 ? "two weeks" : "week";
  if (start - latest >= 2) {
    return `Quick look back: your pain has gone from about ${start} to ${latest} over the last ${weeks}. That's real progress. Keep going.`;
  }
  if (Math.abs(start - latest) <= 1 && latest <= 3) {
    return `Quick look back: your pain has stayed low, around ${latest}, for the last ${weeks}. Nice and steady.`;
  }
  return null;
}

export async function weeklyProgressLine(
  adminIn: unknown,
  clientId: string,
  latestPain: number | null,
  now: Date,
): Promise<string | null> {
  if (latestPain == null) return null;
  const admin = adminIn as Db;
  const { data } = await admin
    .from("check_ins")
    .select("pain_level, created_at")
    .eq("client_id", clientId)
    .gte("created_at", new Date(now.getTime() - 16 * DAY).toISOString())
    .order("created_at", { ascending: true })
    .limit(60);
  const points = ((data ?? []) as Array<{ pain_level: number | null; created_at: string }>)
    .filter((r) => typeof r.pain_level === "number")
    .map((r) => ({ pain: r.pain_level as number, at: r.created_at }));
  const line = progressLine(points, latestPain, now);
  if (!line) return null;
  if (!(await claimOnce(adminIn, PROGRESS_JOB, clientId, weekKey(now)))) return null;
  return line;
}
