// System prompt + payload shaping for the Data Hub "Generate Insight" feature.
// Tweak this file to iterate on insight quality without touching route code.

export const INSIGHT_SYSTEM_PROMPT = `You are a senior clinical data analyst assisting a healthcare practitioner on the Buddy platform.

You are given a JSON snapshot of a single client's data: profile, baselines, recent daily check-ins (pain, sleep, stress, energy, mood, notes), wearable sessions (sleep score, HRV, resting HR, steps, calories, training load), alerts, detected patterns, and Yves triage history.

RULES
- Base every statement on the supplied JSON. Never invent numbers, symptoms, or diagnoses.
- Prefer specific figures over vague adjectives (e.g. "pain 6.2/10 average over the last 14 days, up from 4.1/10").
- Always cite the time window a claim is drawn from.
- If a metric is absent, say the connected wearable does not report it — do not guess.
- Flag data-quality issues (short history, gaps, single readings) explicitly.
- Never give a medical diagnosis. Frame recommendations as clinical considerations for the practitioner.
- Keep total length ~250–400 words. Use markdown headings.

STRUCTURE (use exactly these headings)
### Snapshot
One paragraph: who the client is (complaint, program status, wearable, days of data).

### What's changing
Concrete trends with numbers and windows. Compare recent 7 days to prior 14–30 days where possible.

### Risk signals
Anything concerning: high pain streaks, poor recovery (low HRV, elevated RHR), rising ACWR, alert history, symptom clusters from Yves.

### Wearable data quality
State what is and isn't available. If the wearable doesn't report HRV / sleep stages / stress etc., say so.

### Recommended next steps
Exactly 3 prioritised, actionable items for the practitioner (numbered).`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function mean(xs: number[]): number | null {
  const v = xs.filter((n) => typeof n === "number" && !isNaN(n));
  if (!v.length) return null;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
}

function windowAvg<T extends Row>(rows: T[], field: string, days: number, dateField = "created_at") {
  const cutoff = Date.now() - days * 86400_000;
  const xs: number[] = [];
  for (const r of rows) {
    const t = new Date(String(r[dateField])).getTime();
    if (!isFinite(t) || t < cutoff) continue;
    const v = r[field];
    if (typeof v === "number") xs.push(v);
  }
  return mean(xs);
}

// Shape the full admin bundle into a compact JSON payload for the model.
export function buildInsightPayload(bundle: {
  client: Row;
  wearables: Row[];
  wearableSessions: Row[];
  checkIns: Row[];
  symptomQueries: Row[];
  alerts: Row[];
  riskScores: Row[];
  baseline: Row | null;
  patterns: Row[];
  loadInsight?: Row;
}) {
  const c = bundle.client;
  const wearables = bundle.wearables.map((w) => ({
    provider: w.provider,
    connected: w.status === "active" || w.status === "connected",
    device: w.garmin_device_model ?? null,
  }));

  const checkIns = bundle.checkIns.slice(0, 60).map((r) => ({
    date: r.created_at,
    pain: r.pain_level,
    sleep: r.sleep_quality,
    stress: r.stress_level,
    energy: r.energy_level,
    mood: r.mood,
    flagged: r.flagged,
    note: r.notes ? String(r.notes).slice(0, 200) : null,
    condition: r.condition_context ?? null,
  }));

  const sessions = bundle.wearableSessions.slice(0, 60).map((r) => ({
    date: r.date,
    sleep_score: r.sleep_score,
    sleep_min: r.sleep_duration_minutes ?? r.sleep_minutes,
    hrv: r.hrv_avg,
    resting_hr: r.resting_hr,
    steps: r.total_steps,
    active_kcal: r.active_calories,
    training_load: r.training_load,
    session_type: r.session_type,
    duration_min: r.duration_minutes,
    source: r.source ?? r.provider,
  }));

  const alerts = bundle.alerts.slice(0, 20).map((a) => ({
    date: a.created_at,
    type: a.alert_type,
    urgency: a.urgency,
    message: a.message,
    resolved: a.resolved_at ? true : false,
  }));

  const yves = bundle.symptomQueries.slice(0, 15).map((q) => ({
    date: q.created_at,
    query: q.query ? String(q.query).slice(0, 200) : null,
    triage: q.triage_level,
    summary: q.summary ? String(q.summary).slice(0, 200) : null,
  }));

  const rollups = {
    pain_7d: windowAvg(bundle.checkIns, "pain_level", 7),
    pain_30d: windowAvg(bundle.checkIns, "pain_level", 30),
    sleep_q_7d: windowAvg(bundle.checkIns, "sleep_quality", 7),
    stress_7d: windowAvg(bundle.checkIns, "stress_level", 7),
    energy_7d: windowAvg(bundle.checkIns, "energy_level", 7),
    hrv_7d: windowAvg(bundle.wearableSessions, "hrv_avg", 7, "date"),
    hrv_30d: windowAvg(bundle.wearableSessions, "hrv_avg", 30, "date"),
    rhr_7d: windowAvg(bundle.wearableSessions, "resting_hr", 7, "date"),
    sleep_score_7d: windowAvg(bundle.wearableSessions, "sleep_score", 7, "date"),
    steps_7d: windowAvg(bundle.wearableSessions, "total_steps", 7, "date"),
    load_7d: windowAvg(bundle.wearableSessions, "training_load", 7, "date"),
  };

  return {
    client: {
      name: c.full_name,
      primary_complaint: c.primary_complaint,
      notes: c.notes,
      check_in_frequency: c.check_in_frequency,
      joined: c.created_at,
      yves_enabled: c.yves_enabled,
      passive_monitoring: c.passive_monitoring_enabled,
    },
    baseline: bundle.baseline,
    wearables,
    rollups,
    check_ins_recent: checkIns,
    wearable_sessions_recent: sessions,
    alerts_recent: alerts,
    yves_queries_recent: yves,
    detected_patterns: bundle.patterns.slice(0, 10),
    load_insight_summary: bundle.loadInsight
      ? {
          acwr: bundle.loadInsight.acwr,
          fatigue: bundle.loadInsight.fatigue,
          risk: bundle.loadInsight.risk,
        }
      : null,
    counts: {
      check_ins_total: bundle.checkIns.length,
      wearable_sessions_total: bundle.wearableSessions.length,
      alerts_total: bundle.alerts.length,
      yves_queries_total: bundle.symptomQueries.length,
    },
  };
}
