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

export function computeForecast(
  wearables: WearableDay[],
  checkins: CheckinDay[],
  now: Date = new Date(),
): ForecastResult {
  const w = [...wearables].sort((a, b) => (a.date < b.date ? 1 : -1));

  if (w.length === 0) {
    return {
      hasWearable: false,
      level: "unknown",
      message: "Connect a wearable and Buddy will start reading how your body and your symptoms are trending together.",
      action: "",
      confidence: "",
      reasoning: "",
      factors: [],
      personalNote: null,
      prompt: null,
    };
  }

  const latest = w[0];

  const dayIndex = (d: string | Date) => {
    const t = typeof d === "string" ? new Date(`${d}T00:00:00`) : d;
    return Math.floor(new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() / 86_400_000);
  };

  // Staleness guard: never present old wearable data as "last night".
  const daysStale = dayIndex(now) - dayIndex(latest.date);
  if (daysStale > 2) {
    return {
      hasWearable: true,
      level: "unknown",
      message: `Your ring hasn't synced in ${daysStale} days, so your forecast is on hold. Open the Oura app to refresh it and Buddy will pick right back up.`,
      action: "",
      confidence: "",
      reasoning: "",
      factors: [],
      personalNote: null,
      prompt: null,
    };
  }

  // Recent symptoms (last ~8 days) so the forecast relates body data to how they feel.
  const nowIdx = dayIndex(now);
  const recentPain = nums(checkins.filter((c) => nowIdx - dayIndex(c.date) <= 8).map((c) => c.pain_level));
  const painAvg = avg(recentPain);
  const painHigh = !Number.isNaN(painAvg) && painAvg >= 6;
  const painSettled = !Number.isNaN(painAvg) && painAvg <= 3;

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

  // Build a specific, human line from the client's own numbers and trends —
  // not a generic per-level template.
  const s = latest.sleep_score;
  const sAvg = avg(nums(w.slice(1, 11).map((d) => d.sleep_score)));
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const joinNat = (xs: string[]) =>
    xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
  const sleepPhrase = (): string | null => {
    if (s == null) return null;
    const r = Math.round(s);
    if (!Number.isNaN(sAvg)) {
      if (s >= sAvg + 8) return `You slept well last night, ${r}, one of your better nights`;
      if (s <= sAvg - 8) return `Your sleep dipped to ${r} last night, below your usual`;
      return `You slept about your usual last night (${r})`;
    }
    return s >= 80
      ? `You slept well last night (${r})`
      : s >= 70
        ? `You had a decent night (${r})`
        : `Your sleep ran short last night (${r})`;
  };
  const trendBits: string[] = [];
  if (hrvFalling) trendBits.push("your HRV's been sliding the last few days");
  if (rhrRising) trendBits.push("your resting heart rate's crept up");

  let message: string;
  let action: string;
  if (level === "strong") {
    const lead = sleepPhrase() ?? "Your body's well recovered";
    if (painHigh) {
      message = `${lead}, and your body's recovered, though your pain's still been running higher than usual this week. Ease into today and see how it holds up.`;
      action = "Move, but keep an eye on how your symptoms respond.";
    } else if (painSettled) {
      message = `${lead}, and your body's bounced back with your symptoms settled too. Nothing's pointing to a flare, so it's a good day to push a little.`;
      action = "A good day to make progress on your program.";
    } else {
      message = `${lead}, and your body's bounced back. Nothing's pointing to a flare today, so it's a good one to push a little.`;
      action = "A good day to make progress on your program.";
    }
  } else if (level === "low") {
    const neg: string[] = [];
    if (s != null && (Number.isNaN(sAvg) ? s < 70 : s <= sAvg - 8)) neg.push(`your sleep's run short (${Math.round(s)})`);
    if (hrvFalling) neg.push("your HRV's been sliding");
    if (rhrRising) neg.push("your resting heart rate's up");
    const lead = neg.length ? cap(joinNat(neg)) : "Your body's a bit run down right now";
    if (painHigh) {
      message = `${lead}, and your pain's been up this week too, which is a classic flare setup. Go gentle today and protect your recovery.`;
    } else {
      message = `${lead}, and that's usually the setup for a flare. Take it easier today and you'll likely stay ahead of it.`;
    }
    action = "Go gentle, and aim for a solid night's sleep tonight.";
  } else {
    const lead = sleepPhrase() ?? "Your recovery's holding steady";
    const t = trendBits.length ? `, though ${trendBits.join(" and ")}` : "";
    if (painHigh) {
      message = `${lead}${t}. Your pain's been a touch higher this week, so keep things easy and steady.`;
    } else if (painSettled) {
      message = `${lead}${t}, and your symptoms have been quiet. Keep to your normal pace and see how you feel.`;
    } else {
      message = `${lead}${t}. Nothing's really flaring, so keep to your normal pace and see how you feel.`;
    }
    action = "Steady as you go today.";
  }

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
