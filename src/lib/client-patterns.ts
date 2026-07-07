// #5 Predictive nudges — pattern detection (Phase 2 foundation).
// Pure + dependency-free so it is unit-testable, exactly like streak.ts and
// body-forecast.ts. Detects day-of-week tendencies in a client's own
// check-ins ("your pain tends to run higher on Mondays"). No side effects,
// no I/O, no user-facing behaviour — the nightly job persists what this
// returns, and surfacing/nudging is layered on top separately.

export type PatternMetric = "pain" | "energy" | "stress" | "sleep";

export type CheckInInput = {
  /** ISO timestamp of the check-in. */
  created_at: string;
  pain_level: number | null;
  energy_level: number | null;
  stress_level: number | null;
  sleep_quality: number | null;
};

export type DetectedPattern = {
  pattern_type: "weekday_elevated" | "weekday_low";
  day_of_week: number; // 0 = Sunday … 6 = Saturday
  metric: PatternMetric;
  avg_value: number; // that weekday's mean for the metric
  confidence: number; // 0..1
  sample_size: number; // observations for that weekday+metric
};

const METRICS: PatternMetric[] = ["pain", "energy", "stress", "sleep"];

// For pain and stress, higher = worse → "elevated" is the concerning direction.
// For energy and sleep, lower = worse → "low" is the concerning direction.
const HIGHER_IS_WORSE: Record<PatternMetric, boolean> = {
  pain: true,
  stress: true,
  energy: false,
  sleep: false,
};

function valueFor(c: CheckInInput, m: PatternMetric): number | null {
  const v =
    m === "pain" ? c.pain_level
    : m === "energy" ? c.energy_level
    : m === "stress" ? c.stress_level
    : c.sleep_quality;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function std(xs: number[], mu: number): number {
  if (xs.length < 2) return 0;
  const v = xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export type DetectOptions = {
  /** Minimum observations on a given weekday before a pattern is credible. */
  minPerWeekday?: number;
  /** Minimum total observations for the metric overall. */
  minTotal?: number;
  /** How far (in overall std devs) a weekday mean must deviate to count. */
  minZ?: number;
};

const DEFAULTS: Required<DetectOptions> = {
  minPerWeekday: 3,
  minTotal: 10,
  minZ: 0.8,
};

/**
 * Detect day-of-week patterns per metric. Returns only the strongest,
 * confidence-gated patterns so the caller never over-reads a thin signal.
 * Deterministic: same input → same output.
 */
export function detectWeekdayPatterns(
  checkins: CheckInInput[],
  options: DetectOptions = {},
): DetectedPattern[] {
  const opts = { ...DEFAULTS, ...options };
  const out: DetectedPattern[] = [];

  for (const metric of METRICS) {
    // Collect values, bucketed by weekday.
    const all: number[] = [];
    const byDay: number[][] = Array.from({ length: 7 }, () => []);
    for (const c of checkins) {
      const v = valueFor(c, metric);
      if (v === null) continue;
      const d = new Date(c.created_at);
      if (Number.isNaN(d.getTime())) continue;
      const dow = d.getUTCDay();
      all.push(v);
      byDay[dow].push(v);
    }
    if (all.length < opts.minTotal) continue;
    const overallMean = mean(all);
    const overallStd = std(all, overallMean);
    if (overallStd < 0.1) continue; // no variation → nothing to detect

    // Find the single most-deviant qualifying weekday in the concerning direction.
    let best: DetectedPattern | null = null;
    for (let dow = 0; dow < 7; dow++) {
      const vals = byDay[dow];
      if (vals.length < opts.minPerWeekday) continue;
      const dayMean = mean(vals);
      const z = (dayMean - overallMean) / overallStd;
      const worseDirection = HIGHER_IS_WORSE[metric] ? z > 0 : z < 0;
      const absZ = Math.abs(z);
      if (!worseDirection || absZ < opts.minZ) continue;

      // Confidence blends deviation strength with sample size (both capped).
      const zComponent = Math.min(1, absZ / 2); // z of 2+ → full marks
      const nComponent = Math.min(1, vals.length / 8); // 8+ obs → full marks
      const confidence = Number((0.6 * zComponent + 0.4 * nComponent).toFixed(3));

      const candidate: DetectedPattern = {
        pattern_type: HIGHER_IS_WORSE[metric] ? "weekday_elevated" : "weekday_low",
        day_of_week: dow,
        metric,
        avg_value: Number(dayMean.toFixed(2)),
        confidence,
        sample_size: vals.length,
      };
      if (!best || candidate.confidence > best.confidence) best = candidate;
    }
    if (best) out.push(best);
  }

  // Strongest first.
  return out.sort((a, b) => b.confidence - a.confidence);
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const METRIC_NOUN: Record<PatternMetric, string> = {
  pain: "pain",
  energy: "energy",
  stress: "stress",
  sleep: "sleep quality",
};

/** Plain-language, non-alarming summary for a detected pattern. */
export function describePattern(p: DetectedPattern): string {
  const day = WEEKDAY_NAMES[p.day_of_week] ?? "a certain day";
  const noun = METRIC_NOUN[p.metric];
  if (p.pattern_type === "weekday_elevated") {
    return `Your ${noun} tends to run higher on ${day}s. Worth easing your pace and leaning on your routine that day.`;
  }
  return `Your ${noun} tends to dip on ${day}s. A little extra recovery around then may help.`;
}
