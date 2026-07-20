// ============================================================================
// Rhythm / pattern detection — ported concepts from Predictiv's
// analyze-user-patterns (wearable-only rhythms), computed per client on view.
// Admin/testing only. Confidence-gated by sample size; nulls when insufficient.
// ============================================================================
import type { WearableDay } from "./load-metrics";
import { pickLoadMethod, loadForDay } from "./load-metrics";

export interface Trend { recent: number | null; older: number | null; direction: "up" | "down" | "flat" | "unknown"; }
export interface RhythmPatterns {
  sleepWeekday: number | null;
  sleepWeekend: number | null;
  hrvTrend: Trend;
  rhrTrend: Trend;
  trainingConsistency: { daysActivePerWeek: number | null; weekOverWeekChangePct: number | null };
  notes: string[];
}

const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (v: number | null, dp = 1) => (v === null ? null : Math.round(v * 10 ** dp) / 10 ** dp);

function latestPerDay(sessions: WearableDay[], field: keyof WearableDay): { key: string; v: number }[] {
  const m = new Map<string, number>();
  for (const s of sessions) { const k = dayKey(s.date); const v = s[field]; if (!m.has(k) && typeof v === "number") m.set(k, v); }
  return Array.from(m.entries()).map(([key, v]) => ({ key, v })).sort((a, b) => b.key.localeCompare(a.key));
}
function trend(vals: { key: string; v: number }[]): Trend {
  if (vals.length < 5) return { recent: null, older: null, direction: "unknown" };
  const recent = mean(vals.slice(0, 7).map((x) => x.v));
  const older = mean(vals.slice(7, 21).map((x) => x.v));
  if (recent === null || older === null) return { recent: round(recent), older: round(older), direction: "unknown" };
  const dir = recent > older * 1.02 ? "up" : recent < older * 0.98 ? "down" : "flat";
  return { recent: round(recent), older: round(older), direction: dir };
}

export function buildRhythms(sessions: WearableDay[]): RhythmPatterns {
  const notes: string[] = [];

  // Sleep by day type
  const sleep = latestPerDay(sessions, "sleep_score");
  const weekday: number[] = [], weekend: number[] = [];
  for (const s of sleep) { const dow = new Date(s.key + "T00:00:00Z").getUTCDay(); (dow === 0 || dow === 6 ? weekend : weekday).push(s.v); }
  const sleepWeekday = weekday.length >= 3 ? round(mean(weekday)) : null;
  const sleepWeekend = weekend.length >= 2 ? round(mean(weekend)) : null;
  if (sleepWeekday !== null && sleepWeekend !== null) {
    const diff = Math.round(sleepWeekday - sleepWeekend);
    if (Math.abs(diff) >= 5) notes.push(`Sleep score is ~${Math.abs(diff)} pts ${diff > 0 ? "lower on weekends" : "lower on weekdays"}.`);
  }

  const hrvTrend = trend(latestPerDay(sessions, "hrv_avg"));
  if (hrvTrend.direction === "down") notes.push("HRV is trending down over the last two weeks — reduced recovery.");
  if (hrvTrend.direction === "up") notes.push("HRV is trending up — improving recovery.");
  const rhrTrend = trend(latestPerDay(sessions, "resting_hr"));
  if (rhrTrend.direction === "up") notes.push("Resting heart rate is drifting up — possible accumulating fatigue.");

  // Training consistency
  const method = pickLoadMethod(sessions);
  const loadDays = new Map<string, number>();
  if (method) for (const s of sessions) { const k = dayKey(s.date); if (!loadDays.has(k)) { const l = loadForDay(s, method); if (l !== null && l > 0) loadDays.set(k, l); } }
  const keys = Array.from(loadDays.keys()).sort((a, b) => b.localeCompare(a));
  const cutoff28 = keys.slice(0, 28);
  const daysActivePerWeek = cutoff28.length >= 7 ? round((cutoff28.length / 28) * 7) : null;
  const last7 = keys.slice(0, 7).map((k) => loadDays.get(k)!);
  const prev7 = keys.slice(7, 14).map((k) => loadDays.get(k)!);
  const l7 = mean(last7), p7 = mean(prev7);
  const weekOverWeekChangePct = l7 !== null && p7 !== null && p7 > 0 ? Math.round(((l7 - p7) / p7) * 100) : null;
  if (weekOverWeekChangePct !== null && Math.abs(weekOverWeekChangePct) >= 30)
    notes.push(`Weekly training load ${weekOverWeekChangePct > 0 ? "up" : "down"} ${Math.abs(weekOverWeekChangePct)}% vs the week before.`);

  return { sleepWeekday, sleepWeekend, hrvTrend, rhrTrend, trainingConsistency: { daysActivePerWeek, weekOverWeekChangePct }, notes };
}
