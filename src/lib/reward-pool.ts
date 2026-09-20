// Pure helpers for picking a voucher from the rewards catalog.
// Restaurant-partner rows are preferred when they match the earn rule so
// Justin's check-in discounts surface first without a parallel engine.

export type EarnOn = "milestone" | "check_in_count" | "manual";

export type PoolReward = {
  id: string;
  partner_id: string | null;
  practice_id: string | null;
  min_streak: number | null;
  min_check_ins: number | null;
  earn_on: EarnOn | string;
  active: boolean;
};

export function scopedToPractice(
  pool: PoolReward[],
  clientPracticeId: string | null,
): PoolReward[] {
  return pool.filter(
    (r) => r.active && (r.practice_id == null || r.practice_id === clientPracticeId),
  );
}

function preferRestaurant(list: PoolReward[]): PoolReward[] {
  const rest = list.filter((r) => r.partner_id);
  return rest.length ? rest : list;
}

/** Manual approve: any active, practice-scoped reward; restaurant partners first. */
export function eligibleForManualApprove(
  pool: PoolReward[],
  clientPracticeId: string | null,
): PoolReward[] {
  return preferRestaurant(scopedToPractice(pool, clientPracticeId));
}

/** Streak milestone auto-issue. `min_streak` null matches any milestone. */
export function eligibleForMilestone(
  pool: PoolReward[],
  clientPracticeId: string | null,
  milestone: number,
): PoolReward[] {
  const scoped = scopedToPractice(pool, clientPracticeId).filter((r) => {
    if (r.earn_on === "check_in_count") return false;
    if (r.earn_on === "manual") return false;
    return r.min_streak == null || r.min_streak === milestone;
  });
  return preferRestaurant(scoped);
}

/** Lifetime check-in count auto-issue (once per reward via unique index). */
export function eligibleForCheckInCount(
  pool: PoolReward[],
  clientPracticeId: string | null,
  totalCheckIns: number,
  alreadyIssuedRewardIds: Iterable<string>,
): PoolReward[] {
  const done = new Set(alreadyIssuedRewardIds);
  return scopedToPractice(pool, clientPracticeId).filter(
    (r) =>
      r.earn_on === "check_in_count" &&
      r.min_check_ins != null &&
      totalCheckIns >= r.min_check_ins &&
      !done.has(r.id),
  );
}

export function pickRandom<T>(xs: T[], rng: () => number = Math.random): T | null {
  if (xs.length === 0) return null;
  return xs[Math.floor(rng() * xs.length)] ?? null;
}
