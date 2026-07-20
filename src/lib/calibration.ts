// ============================================================================
// Continuous-learning calibration (pure). Turns practitioner outcome feedback
// on alerts (confirmed / false_alarm) into per-category precision and a
// bounded threshold suggestion. Conservative by design: needs a minimum sample
// before it suggests anything, and only nudges — never large swings.
// ============================================================================
export interface AlertOutcomeRow { category: string | null; outcome: string | null; }
export interface CategoryCalibration {
  category: string;
  n: number;
  confirmed: number;
  falseAlarm: number;
  precision: number;       // confirmed / (confirmed + falseAlarm)
  suggestion: "raise" | "lower" | "hold";
  rationale: string;
}
export interface CalibrationReport {
  generatedAt: string;
  minSample: number;
  categories: CategoryCalibration[];
}

const MIN_SAMPLE = 8;
const LOW_PRECISION = 0.5;   // > half are false alarms -> too sensitive
const HIGH_PRECISION = 0.9;  // almost all real -> can afford more sensitivity

export function computeCalibration(rows: AlertOutcomeRow[], now = new Date()): CalibrationReport {
  const byCat = new Map<string, { confirmed: number; falseAlarm: number }>();
  for (const r of rows) {
    const cat = (r.category ?? "general").trim() || "general";
    const o = (r.outcome ?? "").trim();
    if (o !== "confirmed" && o !== "false_alarm") continue; // ignore 'already_aware' / null
    const c = byCat.get(cat) ?? { confirmed: 0, falseAlarm: 0 };
    if (o === "confirmed") c.confirmed++; else c.falseAlarm++;
    byCat.set(cat, c);
  }
  const categories: CategoryCalibration[] = [];
  for (const [category, c] of byCat) {
    const n = c.confirmed + c.falseAlarm;
    const precision = n ? c.confirmed / n : 0;
    let suggestion: CategoryCalibration["suggestion"] = "hold";
    let rationale = `${n} graded alerts; precision ${(precision * 100).toFixed(0)}%.`;
    if (n >= MIN_SAMPLE && precision < LOW_PRECISION) {
      suggestion = "raise"; rationale = `Too many false alarms (${c.falseAlarm}/${n}) — raise the threshold to reduce noise.`;
    } else if (n >= MIN_SAMPLE && precision >= HIGH_PRECISION) {
      suggestion = "lower"; rationale = `High precision (${c.confirmed}/${n} real) — could safely lower the threshold to catch more.`;
    } else if (n < MIN_SAMPLE) {
      rationale = `Only ${n} graded alerts — need ${MIN_SAMPLE}+ before adjusting.`;
    }
    categories.push({ category, n, confirmed: c.confirmed, falseAlarm: c.falseAlarm, precision: Math.round(precision * 100) / 100, suggestion, rationale });
  }
  categories.sort((a, b) => b.n - a.n);
  return { generatedAt: now.toISOString(), minSample: MIN_SAMPLE, categories };
}

/** Bounded nudge applied to a threshold pair (elevated/critical) — max ±10%. */
export function nudgeThreshold(value: number, suggestion: "raise" | "lower" | "hold"): number {
  if (suggestion === "raise") return Math.round(value * 1.1 * 100) / 100;
  if (suggestion === "lower") return Math.round(value * 0.9 * 100) / 100;
  return value;
}
