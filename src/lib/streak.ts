// Frequency-aware check-in streak logic for client gamification.
// Pure + dependency-free so it is unit-testable.

export type CheckInFrequency =
  | "daily"
  | "every_2_days"
  | "every_3_days"
  | "weekly"
  | "as_needed";

const INTERVAL_DAYS: Record<Exclude<CheckInFrequency, "as_needed">, number> = {
  daily: 1,
  every_2_days: 2,
  every_3_days: 3,
  weekly: 7,
};

export const STREAK_MILESTONES = [3, 7, 14, 30] as const;

export type StreakResult = {
  current: number;
  longest: number;
  total: number;
  isAsNeeded: boolean;
  unlockedMilestones: number[];
  nextMilestone: number | null;
};

// Local-midnight day number (days since epoch) for grouping by calendar day.
function dayIndex(value: string | Date): number {
  const d = typeof value === "string" ? new Date(value) : value;
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor(local.getTime() / 86_400_000);
}

/**
 * Frequency-aware streak.
 * A streak is maintained when consecutive check-ins are at most one full interval
 * of grace apart (gap <= 2 x the frequency interval, in days). The current streak
 * is only "alive" if the latest check-in is within that grace window of today.
 * "as_needed" clients have no schedule, so they get no streak; their total
 * check-ins are surfaced instead.
 */
export function computeStreak(
  timestamps: Array<string | Date>,
  frequency: CheckInFrequency,
  now: Date = new Date(),
): StreakResult {
  const total = timestamps.length;
  const isAsNeeded = frequency === "as_needed";

  const days = Array.from(new Set(timestamps.map(dayIndex))).sort((a, b) => b - a);

  if (isAsNeeded || days.length === 0) {
    return {
      current: 0,
      longest: 0,
      total,
      isAsNeeded,
      unlockedMilestones: [],
      nextMilestone: isAsNeeded ? null : STREAK_MILESTONES[0],
    };
  }

  const interval = INTERVAL_DAYS[frequency];
  const maxGap = interval * 2;

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    const gap = days[i - 1] - days[i];
    run = gap <= maxGap ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  const todayIdx = dayIndex(now);
  let current = 0;
  if (todayIdx - days[0] <= maxGap) {
    current = 1;
    for (let i = 1; i < days.length; i++) {
      const gap = days[i - 1] - days[i];
      if (gap <= maxGap) current += 1;
      else break;
    }
  }

  const unlockedMilestones = STREAK_MILESTONES.filter((m) => longest >= m);
  const nextMilestone = STREAK_MILESTONES.find((m) => m > current) ?? null;

  return { current, longest, total, isAsNeeded, unlockedMilestones, nextMilestone };
}
