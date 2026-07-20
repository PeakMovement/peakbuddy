// ============================================================================
// Per-client symptom <-> health cross-reference (accuracy-testing engine).
// For each wearable metric, finds the day-lag and Pearson correlation that best
// relates that metric to the client's reported pain, so a practitioner can see
// e.g. "higher training load tends to precede higher pain ~2 days later".
//
// Admin/testing only — computed on view, never fed to clients or alerts.
// Sparse-data discipline: variance-zero pairs return no correlation (never a
// fabricated 1.0), and results are gated behind a minimum number of paired days.
// ============================================================================
import { pickLoadMethod, loadForDay, type WearableDay, type CheckInDay } from "./load-metrics";

export interface MetricCorrelation {
  key: string;
  label: string;
  bestLag: number;      // pain measured `bestLag` days AFTER the metric
  r: number;            // Pearson correlation at bestLag (-1..1)
  n: number;            // paired days used
  confidence: number;   // 0..1 by sample size
  direction: "worse" | "better";
  sentence: string;
}
export interface CorrelationResult {
  available: boolean;
  reason: string | null;
  predictors: MetricCorrelation[];
  headline: string | null;
}

const LAGS = [0, 1, 2, 3];
const MIN_PAIRS = 6;
const MIN_ABS_R = 0.2;
const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const addDays = (key: string, d: number) => { const t = new Date(key + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };

export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return null;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  if (dx === 0 || dy === 0) return null; // no variance -> undefined, not a fake perfect correlation
  return num / Math.sqrt(dx * dy);
}

function bestLagCorrelation(metricByDate: Map<string, number>, painByDate: Map<string, number>) {
  let best: { r: number; n: number; lag: number } | null = null;
  for (const lag of LAGS) {
    const xs: number[] = [], ys: number[] = [];
    for (const [k, mv] of metricByDate) {
      const pv = painByDate.get(addDays(k, lag));
      if (pv !== undefined) { xs.push(mv); ys.push(pv); }
    }
    if (xs.length < MIN_PAIRS) continue;
    const r = pearson(xs, ys);
    if (r === null) continue;
    if (!best || Math.abs(r) > Math.abs(best.r)) best = { r, n: xs.length, lag };
  }
  return best;
}

function seriesByDate(sessions: WearableDay[], field: keyof WearableDay): Map<string, number> {
  const m = new Map<string, number>();
  // newest-first input; keep the first (latest) value seen per day
  for (const sfx of sessions) {
    const k = dayKey(sfx.date);
    const v = sfx[field];
    if (!m.has(k) && typeof v === "number") m.set(k, v);
  }
  return m;
}

export function buildCorrelation(sessions: WearableDay[], checkIns: CheckInDay[], hasWearableConnected: boolean): CorrelationResult {
  const none = (reason: string): CorrelationResult => ({ available: false, reason, predictors: [], headline: null });
  if (!hasWearableConnected) return none("No wearable connected.");

  const painByDate = new Map<string, number>();
  for (const c of checkIns) {
    const k = dayKey(c.created_at);
    if (typeof c.pain_level === "number" && !painByDate.has(k)) painByDate.set(k, c.pain_level);
  }
  if (painByDate.size < MIN_PAIRS) return none("Not enough check-ins with a pain score yet.");

  const method = pickLoadMethod(sessions);
  const loadByDate = new Map<string, number>();
  if (method) for (const sfx of sessions) { const k = dayKey(sfx.date); if (!loadByDate.has(k)) { const l = loadForDay(sfx, method); if (l !== null) loadByDate.set(k, l); } }

  const metricDefs: { key: string; label: string; byDate: Map<string, number> }[] = [
    { key: "load", label: "Training load", byDate: loadByDate },
    { key: "hrv", label: "HRV", byDate: seriesByDate(sessions, "hrv_avg") },
    { key: "resting_hr", label: "Resting HR", byDate: seriesByDate(sessions, "resting_hr") },
    { key: "sleep", label: "Sleep score", byDate: seriesByDate(sessions, "sleep_score") },
    { key: "steps", label: "Steps", byDate: seriesByDate(sessions, "total_steps") },
  ];

  const predictors: MetricCorrelation[] = [];
  for (const m of metricDefs) {
    if (m.byDate.size < MIN_PAIRS) continue;
    const best = bestLagCorrelation(m.byDate, painByDate);
    if (!best || Math.abs(best.r) < MIN_ABS_R) continue;
    const direction: "worse" | "better" = best.r > 0 ? "worse" : "better";
    const strength = Math.abs(best.r) >= 0.6 ? "a strong" : Math.abs(best.r) >= 0.4 ? "a moderate" : "a weak";
    const lagTxt = best.lag === 0 ? "the same day" : `~${best.lag} day${best.lag > 1 ? "s" : ""} later`;
    const sentence = `Higher ${m.label.toLowerCase()} shows ${strength} link with ${direction === "worse" ? "higher" : "lower"} pain ${lagTxt} (r=${best.r.toFixed(2)}, n=${best.n}).`;
    predictors.push({ key: m.key, label: m.label, bestLag: best.lag, r: Math.round(best.r * 100) / 100, n: best.n, confidence: Math.min(1, best.n / 14), direction, sentence });
  }
  predictors.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

  if (predictors.length === 0) return none("No clear symptom↔metric association yet — needs more overlapping wearable and check-in days.");
  return { available: true, reason: null, predictors, headline: predictors[0].sentence };
}
