/**
 * Once-a-day claims (migration 0047_buddy_job_claims). Insert first, send
 * after: a duplicate key means another run already has it.
 *
 * Before the migration is applied the insert fails with "relation does not
 * exist"; the caller gets false and simply does not send, which is the safe
 * direction for every job that uses this.
 */
import { log } from "@/lib/log";

type Db = { from: (t: string) => any };

export async function claimOnce(
  adminIn: unknown,
  job: string,
  key: string,
  runOn: string,
): Promise<boolean> {
  const admin = adminIn as Db;
  try {
    const { error } = await admin.from("buddy_job_claims").insert({ job, key, run_on: runOn });
    if (!error) return true;
    if (error.code !== "23505") log.warn("job claim failed", { job, code: error.code });
    return false;
  } catch {
    return false;
  }
}

/** Give a claim back when the send failed, so a later run can try again. */
export async function releaseClaim(
  adminIn: unknown,
  job: string,
  key: string,
  runOn: string,
): Promise<void> {
  const admin = adminIn as Db;
  try {
    await admin.from("buddy_job_claims").delete().eq("job", job).eq("key", key).eq("run_on", runOn);
  } catch {
    /* the claim just stands for today */
  }
}

/** Was this already claimed (sent) on that day? */
export async function wasClaimed(
  adminIn: unknown,
  job: string,
  key: string,
  runOn: string,
): Promise<boolean> {
  const admin = adminIn as Db;
  try {
    const { data } = await admin
      .from("buddy_job_claims")
      .select("job")
      .eq("job", job)
      .eq("key", key)
      .eq("run_on", runOn)
      .limit(1);
    return Boolean((data ?? []).length);
  } catch {
    return false;
  }
}
