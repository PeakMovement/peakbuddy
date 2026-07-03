// Beta "Body Forecast" engine: reads Oura wearable data against symptom check-ins
// and speaks to the client in symptom terms (flare risk, setbacks), not raw metrics.
// The underlying numbers are exposed only via the "how was this decided" reveal.
// Works from wearables alone; sharpens with check-ins; sparse-input aware.

export type WearableDay = {
  date: string;
  sleep_score: number | null;
  readiness_score: number | null;
  resting_hr: number | null;
  hrv_avg: number | null;
};

export type CheckinDay = { date: string; pain_level: number | null };

export type ForecastLevel = "strong" | "moderate" | "low" | "unknown";
export type Factor = { label: string; value: string; read: string };

export type ForecastResult = {
  hasWearable: boolean;
  level: ForecastLevel;
  message: string; // the hero, symptom-relatable line
  action: string; // one gentle next step
  confidence: string; // "Early read" | "Personalizing" | "Your pattern" | ""
  reasoning: string; // one-line summary of what was weighed
  factors: Factor[]; // the underlying data, for the reveal
  personalNote: string | null;
  prompt: string | null;
};

const nums = (xs: (number | null | undefined)[]) =>
  xs.filter((x): x is number => typeof x === "number" && !Number.isNaN(x));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

const sleepRead = (s: number) => (s >= 80 ? "well rested" : s >= 70 ? "decent sleep" : "short sleep");
const readinessRead = (r: number) => (r >= 72 ? "recovered" : r >= 58 ? "moderate" : "under-recovered");

export function computeForecast(wearables: WearableDay[], checkins: CheckinDay[]): ForecastResult {
  const w = [...wearables].sort((a, b) => (a.date < b.date ? 1 : -1));

  if (w.length === 0) {
    return {
      hasWearable: false,
      level: "unknown",
      message: "Connect your Oura ring and Buddy will start reading how your body and your symptoms are trending together.",
      action: "",
      confidence: "",
      reasoning: "",
      factors: [],
      personalNote: null,
      prompt: null,
    };
  }

  const latest = w[0];
  const recent = w.slice(0, 3);
  const prior = w.slice(3, 14);

  const hrvRecent = avg(nums(recent.map((d) => d.hrv_avg)));
  const hrvPrior = avg(nums(prior.map((d) => d.hrv_avg)));
  const hrvFalling = !Number.isNaN(hrvRecent) && !Number.isNaN(hrvPrior) && hrvRecent < hrvPrior * 0.92;

  const rhrRecent = avg(nums(recent.map((d) => d.resting_hr)));
  const rhrPrior = avg(nums(prior.map((d) => d.resting_hr)));
  const rhrRising = !Number.isNaN(rhrRecent) && !Number.isNaN(rhrPrior) && rhrRecent > rhrPrior * 1.05;

  const readiness = latest.readiness_score ?? latest.sleep_score ?? null;

  let level: ForecastLevel;
  if (readiness != null && readiness >= 72 && !hrvFalling && !rhrRising) level = "strong";
  else if ((readiness != null && readiness <= 58) || hrvFalling || rhrRising) level = "low";
  else level = "moderate";

  const message =
    level === "strong"
      ? "Your body and activity are looking good, with low risk of a flare or setback today."
      : level === "low"
        ? "Your recovery is down, and this is often when symptoms flare. Take it easier today to stay ahead of a setback."
        : "You're in a steady zone. Your recovery and symptoms look balanced, so keep to your usual pace.";

  const action =
    level === "strong"
      ? "A good day to make progress on your program."
      : level === "low"
        ? "Prioritise rest and good sleep tonight, and ease off any hard sessions."
        : "Keep things steady and listen to how you feel.";

  const factors: Factor[] = [];
  if (latest.sleep_score != null)
    factors.push({ label: "Sleep", value: String(Math.round(latest.sleep_score)), read: sleepRead(latest.sleep_score) });
  if (latest.readiness_score != null)
    factors.push({
      label: "Readiness",
      value: String(Math.round(latest.readiness_score)),
      read: readinessRead(latest.readiness_score),
    });
  if (latest.hrv_avg != null)
    factors.push({ label: "HRV", value: String(Math.round(latest.hrv_avg)), read: hrvFalling ? "trending down" : "stable" });
  if (latest.resting_hr != null)
    factors.push({
      label: "Resting HR",
      value: String(Math.round(latest.resting_hr)),
      read: rhrRising ? "elevated" : "normal",
    });

  // Personal cross-check: pair wearable + check-in by the same date.
  let personalNote: string | null = null;
  const byDate = new Map(w.map((d) => [d.date, d]));
  const pairs: { sleep: number; pain: number }[] = [];
  for (const c of checkins) {
    const wd = byDate.get(c.date);
    if (wd?.sleep_score != null && c.pain_level != null) pairs.push({ sleep: wd.sleep_score, pain: c.pain_level });
  }
  if (pairs.length >= 5) {
    const lowPain = pairs.filter((p) => p.sleep < 70).map((p) => p.pain);
    const highPain = pairs.filter((p) => p.sleep >= 70).map((p) => p.pain);
    if (lowPain.length >= 2 && highPain.length >= 2) {
      const diff = avg(lowPain) - avg(highPain);
      if (diff >= 1)
        personalNote = `On nights your sleep score dips below 70, your reported pain has run about ${diff.toFixed(1)} points higher the next day.`;
    }
  }

  const checkinCount = checkins.filter((c) => c.pain_level != null).length;
  const confidence = personalNote ? "Your pattern" : checkinCount >= 5 ? "Personalizing" : "Early read";

  const reasoning = personalNote
    ? "Buddy weighed your recent sleep, recovery and heart-rate signals against your own check-in history."
    : "Buddy weighed your recent sleep, recovery, heart-rate variability and resting heart rate. It gets more personal as you check in.";

  const prompt =
    checkinCount < 8
      ? "Check in on how you feel to sharpen your forecast. Buddy learns your body from every check-in."
      : null;

  return { hasWearable: true, level, message, action, confidence, reasoning, factors, personalNote, prompt };
}
