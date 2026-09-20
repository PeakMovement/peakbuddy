// Overlay a client's check-in symptom scores on their training schedule.
// Pure + dependency-free so it is unit-testable, same as streak.ts / load-metrics.ts.
//
// Training schedule here means practitioner-entered sessions (hard / recovery /
// rest, etc.). Wearable load is an optional extra series — never required.

export const SESSION_TYPES = [
  "hard",
  "moderate",
  "recovery",
  "rest",
  "competition",
  "other",
] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export const SESSION_TYPE_LABEL: Record<SessionType, string> = {
  hard: "Hard",
  moderate: "Moderate",
  recovery: "Recovery",
  rest: "Rest",
  competition: "Competition",
  other: "Other",
};

/** Default intensity when the practitioner didn't set one (1–10 scale). */
export const SESSION_TYPE_INTENSITY: Record<SessionType, number> = {
  rest: 0,
  recovery: 2,
  other: 4,
  moderate: 5,
  hard: 8,
  competition: 10,
};

export type TrainingSessionInput = {
  session_date: string; // YYYY-MM-DD
  session_type: SessionType | string;
  intensity?: number | null;
  title?: string | null;
};

export type CheckInInput = {
  created_at: string;
  pain_level?: number | null;
  sleep_quality?: number | null;
  stress_level?: number | null;
  energy_level?: number | null;
  flagged?: boolean | null;
};

export type WearableLoadInput = {
  date: string;
  load: number | null;
};

export type ScheduleCrossCheckDay = {
  date: string;
  sessionType: SessionType | null;
  intensity: number | null;
  sessionTitle: string | null;
  pain: number | null;
  sleep: number | null;
  stress: number | null;
  energy: number | null;
  flagged: boolean;
  wearableLoad: number | null;
};

export type ScheduleCrossCheck = {
  days: ScheduleCrossCheckDay[];
  observations: string[];
  summary: {
    avgPainOnHard: number | null;
    avgPainOnRecovery: number | null;
    avgPainOnRest: number | null;
    hardThenSpikeCount: number;
    overlapDays: number;
  };
};

function ymdLocal(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) {
    // Already a date-only string from Postgres (`YYYY-MM-DD`).
    const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : String(value).slice(0, 10);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return ymdLocal(dt);
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
}

function asSessionType(v: string): SessionType | null {
  return (SESSION_TYPES as readonly string[]).includes(v) ? (v as SessionType) : null;
}

function lastNDates(n: number, now: Date): string[] {
  const today = ymdLocal(now);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(today, -i));
  return out;
}

export function intensityFor(session: TrainingSessionInput): number {
  if (typeof session.intensity === "number" && Number.isFinite(session.intensity)) {
    return session.intensity;
  }
  const t = asSessionType(session.session_type);
  return t ? SESSION_TYPE_INTENSITY[t] : 4;
}

/**
 * Align the last `windowDays` calendar days of check-ins with training sessions
 * (and optional wearable load). Observations are conservative: they need an
 * overlapping hard/competition day plus a later symptom rise — never invent a
 * diagnosis.
 */
export function buildScheduleCrossCheck(
  sessions: TrainingSessionInput[],
  checkIns: CheckInInput[],
  wearable: WearableLoadInput[] = [],
  windowDays = 21,
  now: Date = new Date(),
): ScheduleCrossCheck {
  const dates = lastNDates(windowDays, now);

  const sessionByDay = new Map<string, TrainingSessionInput>();
  for (const s of sessions) {
    const k = ymdLocal(s.session_date);
    const prev = sessionByDay.get(k);
    // Prefer the hardest session if more than one lands on a day.
    if (!prev || intensityFor(s) > intensityFor(prev)) sessionByDay.set(k, s);
  }

  const checkByDay = new Map<
    string,
    {
      pain: number | null;
      sleep: number | null;
      stress: number | null;
      energy: number | null;
      flagged: boolean;
    }
  >();
  for (const c of checkIns) {
    const k = ymdLocal(c.created_at);
    const prev = checkByDay.get(k);
    const pain = typeof c.pain_level === "number" ? c.pain_level : null;
    const sleep = typeof c.sleep_quality === "number" ? c.sleep_quality : null;
    const stress = typeof c.stress_level === "number" ? c.stress_level : null;
    const energy = typeof c.energy_level === "number" ? c.energy_level : null;
    checkByDay.set(k, {
      pain: prev?.pain ?? pain,
      sleep: prev?.sleep ?? sleep,
      stress: prev?.stress ?? stress,
      energy: prev?.energy ?? energy,
      flagged: !!(prev?.flagged || c.flagged),
    });
  }

  const loadByDay = new Map<string, number | null>();
  for (const w of wearable) {
    const k = ymdLocal(w.date);
    if (!loadByDay.has(k)) loadByDay.set(k, w.load);
  }

  const days: ScheduleCrossCheckDay[] = dates.map((date) => {
    const s = sessionByDay.get(date);
    const t = s ? asSessionType(s.session_type) : null;
    const c = checkByDay.get(date);
    return {
      date,
      sessionType: t,
      intensity: s ? intensityFor(s) : null,
      sessionTitle: s?.title?.trim() ? s.title.trim() : null,
      pain: c?.pain ?? null,
      sleep: c?.sleep ?? null,
      stress: c?.stress ?? null,
      energy: c?.energy ?? null,
      flagged: c?.flagged ?? false,
      wearableLoad: loadByDay.get(date) ?? null,
    };
  });

  const painOn = (types: SessionType[]) =>
    mean(
      days
        .filter((d) => d.sessionType && types.includes(d.sessionType) && d.pain !== null)
        .map((d) => d.pain as number),
    );

  const avgPainOnHard = painOn(["hard", "competition"]);
  const avgPainOnRecovery = painOn(["recovery"]);
  const avgPainOnRest = painOn(["rest"]);
  const overlapDays = days.filter((d) => d.sessionType && d.pain !== null).length;

  const observations: string[] = [];
  let hardThenSpikeCount = 0;

  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if (d.sessionType !== "hard" && d.sessionType !== "competition") continue;
    const sessionPain = d.pain;
    for (let j = 1; j <= 2; j++) {
      const later = days[i + j];
      if (!later) continue;
      const rose = later.pain !== null && sessionPain !== null && later.pain - sessionPain >= 2;
      if (later.flagged || rose) {
        hardThenSpikeCount += 1;
        const how = later.flagged ? "a flagged check-in" : "a rise in reported pain";
        observations.push(
          `A ${SESSION_TYPE_LABEL[d.sessionType].toLowerCase()} session on ${d.date} was followed within ${j} day${j === 1 ? "" : "s"} by ${how} on ${later.date}.`,
        );
        break;
      }
    }
  }

  if (
    avgPainOnHard !== null &&
    avgPainOnRecovery !== null &&
    avgPainOnHard - avgPainOnRecovery >= 1.5
  ) {
    observations.push(
      `Average pain on hard/competition days (${avgPainOnHard}) is higher than on recovery days (${avgPainOnRecovery}).`,
    );
  }
  if (avgPainOnHard !== null && avgPainOnRest !== null && avgPainOnHard - avgPainOnRest >= 1.5) {
    observations.push(
      `Average pain on hard/competition days (${avgPainOnHard}) is higher than on rest days (${avgPainOnRest}).`,
    );
  }

  // Wearable lag: a relative load spike, then pain/flag — only when schedule is thin.
  const loads = days.map((d) => d.wearableLoad).filter((v): v is number => v !== null);
  const loadMean = mean(loads);
  if (loadMean !== null && loadMean > 0) {
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (d.wearableLoad === null || d.wearableLoad < loadMean * 1.5) continue;
      for (let j = 1; j <= 2; j++) {
        const later = days[i + j];
        if (!later) continue;
        const rose = later.pain !== null && d.pain !== null && later.pain - d.pain >= 2;
        if (later.flagged || rose) {
          observations.push(
            `A wearable-load spike on ${d.date} was followed within ${j} day${j === 1 ? "" : "s"} by ${later.flagged ? "a flagged check-in" : "a rise in reported pain"} on ${later.date}.`,
          );
          break;
        }
      }
    }
  }

  if (overlapDays < 3 && observations.length === 0) {
    observations.push(
      overlapDays === 0
        ? "Add training sessions and keep checking in — the overlay needs both on the same days."
        : "Not enough overlapping session + check-in days yet for a confident read (need a few more).",
    );
  }

  return {
    days,
    observations,
    summary: {
      avgPainOnHard,
      avgPainOnRecovery,
      avgPainOnRest,
      hardThenSpikeCount,
      overlapDays,
    },
  };
}
