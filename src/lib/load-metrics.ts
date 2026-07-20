// ============================================================================
// Training-load & injury-risk metrics — ported (math only, "merge upward") from
// the Predictiv MVP. Turns a client's wearable sessions + check-ins into the
// established sports-science load markers, an explainable risk-driver read, and
// a symptom-vs-training cross-check.
//
// Design principle carried over from Predictiv's hard-won lesson: sparse,
// manually-synced data makes stddev collapse and monotony fabricate false
// "high monotony" alarms. So load-based drivers are GATED behind a 14-day data
// maturity tier, and missing days are treated as UNKNOWN (null), never zero.
// ============================================================================

export type MaturityLevel = "insufficient" | "emerging" | "established" | "mature";
export type RiskLevel = "low" | "moderate" | "high";

export interface WearableDay {
  date: string;
  training_load?: number | null;
  active_calories?: number | null;
  avg_heart_rate?: number | null;
  duration_minutes?: number | null;
  total_steps?: number | null;
  hrv_avg?: number | null;
  resting_hr?: number | null;
  sleep_score?: number | null;
}

export interface CheckInDay {
  created_at: string;
  pain_level?: number | null;
  flagged?: boolean | null;
}

export interface RiskDriver {
  id: "acwr" | "monotony" | "strain" | "fatigue" | "hrv" | "sleep";
  label: string;
  value: number;
  severity: number; // 0-100
  reason: string;
}

export interface CrossCheckDay {
  date: string;
  load: number | null;
  pain: number | null;
  flagged: boolean;
}

export interface LoadInsight {
  available: boolean;
  reason: string | null; // why unavailable, when available === false
  loadMethod: "training_load" | "hr_minutes" | "active_calories" | null;
  maturity: { level: MaturityLevel; dataDays: number };
  metrics: {
    acwr: number | null;
    acuteLoad: number | null;
    chronicLoad: number | null;
    monotony: number | null;
    strain: number | null;
    fatigueIndex: number | null;
    hrvDeviationPct: number | null;
    recentSleepScore: number | null;
  };
  drivers: { primary: RiskDriver | null; secondary: RiskDriver | null; riskLevel: RiskLevel; all: RiskDriver[] };
  crossCheck: { days: CrossCheckDay[]; observation: string | null };
}

// Clinically-grounded thresholds carried across from Predictiv's riskDrivers.ts.
const T = {
  acwr: { critical: 1.5, elevated: 1.3, optimalLow: 0.8 },
  monotony: { critical: 2.5, elevated: 2.0, moderate: 1.5 },
  strain: { critical: 3500, elevated: 2500, moderate: 1500 },
  fatigue: { critical: 80, elevated: 70, moderate: 50 },
  hrv: { critical: 30, elevated: 20, moderate: 10 }, // % below baseline
  sleep: { critical: 50, elevated: 60, moderate: 70 }, // inverted (lower worse)
};
const MIN_DAYS_FOR_LOAD_DRIVERS = 14;

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function stddev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/** Pick one consistent load method across the whole series so ACWR compares
 *  like with like. training_load (Polar) > HR×minutes > active calories. */
export function pickLoadMethod(days: WearableDay[]): LoadInsight["loadMethod"] {
  if (days.some((d) => typeof d.training_load === "number")) return "training_load";
  if (days.some((d) => typeof d.duration_minutes === "number" && typeof d.avg_heart_rate === "number"))
    return "hr_minutes";
  if (days.some((d) => typeof d.active_calories === "number")) return "active_calories";
  return null;
}

export function loadForDay(d: WearableDay, method: LoadInsight["loadMethod"]): number | null {
  switch (method) {
    case "training_load":
      return typeof d.training_load === "number" ? d.training_load : null;
    case "hr_minutes":
      return typeof d.duration_minutes === "number" && typeof d.avg_heart_rate === "number"
        ? Math.round((d.duration_minutes * d.avg_heart_rate) / 10)
        : null;
    case "active_calories":
      return typeof d.active_calories === "number" ? d.active_calories : null;
    default:
      return null;
  }
}

function maturity(dataDays: number): MaturityLevel {
  if (dataDays === 0) return "insufficient";
  if (dataDays < 5) return "emerging";
  if (dataDays < 14) return "established";
  return "mature";
}

function evalFactor(id: RiskDriver["id"], label: string, value: number | null,
  th: { critical: number; elevated: number; moderate?: number }, inverted = false): RiskDriver | null {
  if (value === null) return null;
  let severity = 0;
  if (inverted) {
    if (value <= th.critical) severity = 90;
    else if (value <= th.elevated) severity = 65;
    else if (th.moderate !== undefined && value <= th.moderate) severity = 35;
  } else {
    if (value >= th.critical) severity = 90;
    else if (value >= th.elevated) severity = 65;
    else if (th.moderate !== undefined && value >= th.moderate) severity = 35;
  }
  if (severity === 0) return null;
  const band = severity >= 90 ? "critical" : severity >= 65 ? "elevated" : "moderate";
  return { id, label, value: Math.round(value * 100) / 100, severity, reason: `${label} ${band} (${Math.round(value * 100) / 100})` };
}

export function fatigueIndex(strain: number | null, monotony: number | null): number | null {
  if (strain === null && monotony === null) return null;
  const s = strain !== null ? Math.min(strain, 2000) : 0;
  const m = monotony !== null ? Math.min(monotony, 2.5) : 0;
  return Math.min(Math.round((s / 2000) * 50 + (m / 2.5) * 50), 100);
}

export function buildLoadInsight(sessions: WearableDay[], checkIns: CheckInDay[], hasWearableConnected: boolean): LoadInsight {
  const empty = (reason: string, method: LoadInsight["loadMethod"] = null, dataDays = 0): LoadInsight => ({
    available: false, reason, loadMethod: method,
    maturity: { level: maturity(dataDays), dataDays },
    metrics: { acwr: null, acuteLoad: null, chronicLoad: null, monotony: null, strain: null, fatigueIndex: null, hrvDeviationPct: null, recentSleepScore: null },
    drivers: { primary: null, secondary: null, riskLevel: "low", all: [] },
    crossCheck: { days: [], observation: null },
  });

  if (!hasWearableConnected) return empty("No wearable connected.");

  // Distinct days (last 30) — data maturity.
  const cutoff = Date.now() - 30 * 86_400_000;
  const recentSessions = sessions.filter((s) => new Date(s.date).getTime() >= cutoff);
  const dataDays = new Set(recentSessions.map((s) => dayKey(s.date))).size;

  const method = pickLoadMethod(recentSessions);
  if (!method) return empty("Connected wearable does not provide training-load data (no load, HR-minutes or active-calorie data).", null, dataDays);

  // Load series, newest first, one value per day (null when that day lacks the field).
  const byDayNewestFirst = [...recentSessions].sort((a, b) => b.date.localeCompare(a.date));
  const loadByDay = new Map<string, number | null>();
  for (const s of byDayNewestFirst) {
    const k = dayKey(s.date);
    if (!loadByDay.has(k)) loadByDay.set(k, loadForDay(s, method));
  }
  const dayKeysDesc = Array.from(loadByDay.keys()).sort((a, b) => b.localeCompare(a));
  const loadsDesc = dayKeysDesc.map((k) => loadByDay.get(k) ?? null);
  const nonNull = (xs: (number | null)[]) => xs.filter((v): v is number => v !== null);

  const acute = nonNull(loadsDesc.slice(0, 7));
  const chronic = nonNull(loadsDesc.slice(0, 28));
  const acuteLoad = mean(acute);
  const chronicLoad = mean(chronic);

  // Gate load drivers behind 14 days of history (Predictiv's lesson).
  const stableHistory = dataDays >= MIN_DAYS_FOR_LOAD_DRIVERS;
  const acwr = stableHistory && acuteLoad !== null && chronicLoad && chronicLoad > 0
    ? Math.round((acuteLoad / chronicLoad) * 100) / 100 : null;

  const weekLoads = nonNull(loadsDesc.slice(0, 7));
  const weekMean = mean(weekLoads);
  const weekSd = stddev(weekLoads);
  const monotony = stableHistory && weekMean !== null && weekSd !== null && weekSd > 0
    ? Math.round((weekMean / weekSd) * 100) / 100 : null;
  const weekTotal = weekLoads.reduce((a, b) => a + b, 0);
  const strain = monotony !== null ? Math.round(weekTotal * monotony) : null;
  const fi = fatigueIndex(strain, monotony);

  // HRV deviation: recent (last 7) vs personal baseline (days 8-28).
  const hrvByDayDesc = dayKeysDesc.map((k) => {
    const s = byDayNewestFirst.find((x) => dayKey(x.date) === k);
    return typeof s?.hrv_avg === "number" ? s.hrv_avg : null;
  });
  const hrvRecent = mean(nonNull(hrvByDayDesc.slice(0, 7)));
  const hrvBase = mean(nonNull(hrvByDayDesc.slice(7, 28)));
  const hrvDeviationPct = hrvRecent !== null && hrvBase !== null && hrvBase > 0
    ? Math.round(((hrvBase - hrvRecent) / hrvBase) * 100) : null;

  const sleepDesc = dayKeysDesc.map((k) => {
    const s = byDayNewestFirst.find((x) => dayKey(x.date) === k);
    return typeof s?.sleep_score === "number" ? s.sleep_score : null;
  });
  const recentSleepScore = mean(nonNull(sleepDesc.slice(0, 7)));

  // Risk drivers.
  const all = [
    evalFactor("acwr", "Acute:chronic load ratio", acwr, T.acwr),
    evalFactor("monotony", "Training monotony", monotony, T.monotony),
    evalFactor("strain", "Weekly strain", strain, T.strain),
    evalFactor("fatigue", "Fatigue index", fi, T.fatigue),
    evalFactor("hrv", "HRV drop vs baseline", hrvDeviationPct, T.hrv),
    evalFactor("sleep", "Sleep score", recentSleepScore, T.sleep, true),
  ].filter((d): d is RiskDriver => d !== null).sort((a, b) => b.severity - a.severity);
  const topSeverity = all[0]?.severity ?? 0;
  const riskLevel: RiskLevel = topSeverity >= 90 ? "high" : topSeverity >= 65 ? "moderate" : "low";

  // Symptom-vs-training cross-check over the last 14 days.
  const painByDay = new Map<string, { pain: number | null; flagged: boolean }>();
  for (const c of checkIns) {
    const k = dayKey(c.created_at);
    const prev = painByDay.get(k);
    const pain = typeof c.pain_level === "number" ? c.pain_level : null;
    painByDay.set(k, { pain: prev?.pain ?? pain, flagged: prev?.flagged || !!c.flagged });
  }
  const last14 = dayKeysDesc.slice(0, 14);
  const days: CrossCheckDay[] = last14.map((k) => ({
    date: k, load: loadByDay.get(k) ?? null,
    pain: painByDay.get(k)?.pain ?? null, flagged: painByDay.get(k)?.flagged ?? false,
  }));

  // Simple lag observation: a load spike (>= chronic*1.5) followed within 2 days
  // by a pain rise (>= +2) or a flag.
  let observation: string | null = null;
  if (chronicLoad && chronicLoad > 0) {
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (d.load !== null && d.load >= chronicLoad * 1.5) {
        for (let j = Math.max(0, i - 2); j < i; j++) {
          const later = days[j]; // more recent
          const prPain = days[i].pain;
          if (later.flagged || (later.pain !== null && prPain !== null && later.pain - prPain >= 2)) {
            observation = `A load spike on ${d.date} was followed within 2 days by ${later.flagged ? "a flagged check-in" : "a rise in reported pain"} on ${later.date}.`;
            break;
          }
        }
      }
      if (observation) break;
    }
  }

  return {
    available: true, reason: null, loadMethod: method,
    maturity: { level: maturity(dataDays), dataDays },
    metrics: { acwr, acuteLoad: acuteLoad !== null ? Math.round(acuteLoad) : null, chronicLoad: chronicLoad !== null ? Math.round(chronicLoad) : null, monotony, strain, fatigueIndex: fi, hrvDeviationPct, recentSleepScore: recentSleepScore !== null ? Math.round(recentSleepScore) : null },
    drivers: { primary: all[0] ?? null, secondary: all[1] ?? null, riskLevel, all },
    crossCheck: { days, observation },
  };
}
