// Beta "Body Forecast" engine: cross-checks Oura wearable data against symptom
// check-ins to produce a gentle, forward-looking outlook. Pure + testable.
// Designed to work from wearables alone (dense) and sharpen with each check-in
// (sparse) — never goes dark for lack of input.

export type WearableDay = {
  date: string; // YYYY-MM-DD
  sleep_score: number | null;
  readiness_score: number | null;
  resting_hr: number | null;
  hrv_avg: number | null;
};

export type CheckinDay = {
  date: string; // YYYY-MM-DD
  pain_level: number | null;
};

export type ForecastLevel = "strong" | "moderate" | "low" | "unknown";

export type ForecastResult = {
  hasWearable: boolean;
  level: ForecastLevel;
  headline: string;
  outlook: string;
  action: string;
  confidence: string; // "Early read" | "Personalizing" | "Your pattern" | ""
  snapshot: { label: string; value: string }[];
  personalNote: string | null;
  prompt: string | null;
};

const nums = (xs: (number | null | undefined)[]) =>
  xs.filter((x): x is number => typeof x === "number" && !Number.isNaN(x));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function computeForecast(wearables: WearableDay[], checkins: CheckinDay[]): ForecastResult {
  const w = [...wearables].sort((a, b) => (a.date < b.date ? 1 : -1));

  if (w.length === 0) {
    return {
      hasWearable: false,
      level: "unknown",
      headline: "Connect your Oura ring",
      outlook: "Once your ring is syncing, Buddy will start forecasting how your body is trending.",
      action: "",
      confidence: "",
      snapshot: [],
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

  const headline =
    level === "strong"
      ? "Recovery looks strong"
      : level === "low"
        ? "Recovery looks low"
        : "Recovery looks moderate";

  const outlook =
    level === "strong"
      ? "Your body looks well recovered. Tomorrow is set up to be a good day."
      : level === "low"
        ? "Your recovery is running low, and for most people that tends to track with more pain, stress or fatigue the next day."
        : "Your recovery is middling. A steady, moderate day is the safe bet.";

  const action =
    level === "strong"
      ? "A good day to make progress on your program."
      : level === "low"
        ? "Ease your pace tomorrow, and prioritise rest and sleep tonight."
        : "Keep things steady and listen to how you feel.";

  const snapshot: { label: string; value: string }[] = [];
  if (latest.sleep_score != null) snapshot.push({ label: "Sleep", value: String(Math.round(latest.sleep_score)) });
  if (latest.readiness_score != null)
    snapshot.push({ label: "Readiness", value: String(Math.round(latest.readiness_score)) });
  if (latest.resting_hr != null) snapshot.push({ label: "Rest HR", value: String(Math.round(latest.resting_hr)) });
  if (latest.hrv_avg != null) snapshot.push({ label: "HRV", value: String(Math.round(latest.hrv_avg)) });

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
      if (diff >= 1) {
        personalNote = `On nights your Oura sleep score dipped below 70, your reported pain has averaged about ${diff.toFixed(1)} points higher the next day.`;
      }
    }
  }

  const checkinCount = checkins.filter((c) => c.pain_level != null).length;
  const confidence = personalNote ? "Your pattern" : checkinCount >= 5 ? "Personalizing" : "Early read";

  const prompt =
    checkinCount < 8
      ? "Check in on how you feel to sharpen your forecast. Buddy learns your body from every check-in."
      : null;

  return { hasWearable: true, level, headline, outlook, action, confidence, snapshot, personalNote, prompt };
}
