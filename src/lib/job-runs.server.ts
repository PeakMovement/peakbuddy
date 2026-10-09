/**
 * Background job heartbeats (table public.job_runs, migration 0026) and the
 * daily health check that reads them.
 *
 * Every scheduled hook is wrapped in trackedJob(), which records one row per
 * run: ok when the hook answered below 400. A 401 is not recorded (that is
 * someone knocking without the key, not the job running).
 *
 * The health check flags a job when it has not succeeded within its expected
 * window, or its most recent run failed. Nothing patient related is stored.
 */
import { log } from "@/lib/log";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Each job, in plain words, and how long it may go without a success. */
export const EXPECTED_JOBS: Array<{ job: string; label: string; windowMs: number }> = [
  { job: "whatsapp-worker-tick", label: "WhatsApp backup responder (every minute)", windowMs: 30 * MIN },
  { job: "checkin-reminders-tick", label: "Check-in reminders (every 5 minutes)", windowMs: 30 * MIN },
  { job: "wearables-sync-daily", label: "Wearables sync (daily)", windowMs: 26 * HOUR },
  { job: "nightly-pattern-detection", label: "Pattern detection (nightly)", windowMs: 26 * HOUR },
  { job: "nightly-risk-analysis", label: "Risk analysis (nightly)", windowMs: 26 * HOUR },
  { job: "onboarding-library-nudge", label: "Onboarding nudge (daily)", windowMs: 26 * HOUR },
  { job: "weekly-practitioner-digest", label: "Practitioner digest (weekly)", windowMs: 8 * DAY },
  { job: "whatsapp-drive-backup-weekly", label: "WhatsApp Drive backup (weekly)", windowMs: 8 * DAY },
];

export async function recordJobRun(
  job: string,
  run: { ok: boolean; status: number; durationMs: number; detail?: string },
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("job_runs" as never).insert({
      job,
      ok: run.ok,
      status: run.status,
      duration_ms: run.durationMs,
      detail: run.detail?.slice(0, 500) ?? null,
    } as never);
  } catch {
    // A heartbeat must never break the job it describes.
  }
}

/** Wraps a hook's POST handler so every run leaves a heartbeat. */
export function trackedJob<C>(
  job: string,
  handler: (ctx: C) => Promise<Response>,
): (ctx: C) => Promise<Response> {
  return async (ctx: C) => {
    const started = Date.now();
    let res: Response;
    try {
      res = await handler(ctx);
    } catch (e) {
      await recordJobRun(job, {
        ok: false,
        status: 500,
        durationMs: Date.now() - started,
        detail: e instanceof Error ? e.message : "threw",
      });
      throw e;
    }
    if (res.status !== 401) {
      await recordJobRun(job, {
        ok: res.status < 400,
        status: res.status,
        durationMs: Date.now() - started,
      });
    }
    return res;
  };
}

export interface JobRunRow {
  job: string;
  ran_at: string;
  ok: boolean;
  status: number | null;
}

export interface JobProblem {
  job: string;
  label: string;
  problem: string;
}

/**
 * Pure: given recent runs, what is wrong. `trackingSince` is the first
 * heartbeat ever recorded; a job is not judged until tracking has run longer
 * than its window, so the first days after deploy do not cry wolf.
 */
export function evaluateJobHealth(
  rows: JobRunRow[],
  now: Date,
  trackingSince: Date | null,
): JobProblem[] {
  const problems: JobProblem[] = [];
  for (const { job, label, windowMs } of EXPECTED_JOBS) {
    const runs = rows
      .filter((r) => r.job === job)
      .sort((a, b) => b.ran_at.localeCompare(a.ran_at));
    const latest = runs[0];
    const lastOk = runs.find((r) => r.ok);
    if (latest && !latest.ok) {
      problems.push({
        job,
        label,
        problem: `Last run failed (status ${latest.status ?? "unknown"}) at ${sast(latest.ran_at)}`,
      });
      continue;
    }
    const judged = trackingSince && now.getTime() - trackingSince.getTime() >= windowMs;
    if (!judged) continue;
    if (!lastOk || now.getTime() - new Date(lastOk.ran_at).getTime() > windowMs) {
      problems.push({
        job,
        label,
        problem: lastOk
          ? `No successful run since ${sast(lastOk.ran_at)}`
          : "Has not run successfully since tracking started",
      });
    }
  }
  return problems;
}

function sast(iso: string): string {
  return new Date(new Date(iso).getTime() + 2 * HOUR).toISOString().slice(0, 16).replace("T", " ");
}

export async function runJobHealthCheck(
  admin: Admin,
  now: Date = new Date(),
): Promise<{ ok: boolean; problems: JobProblem[]; emailed: boolean }> {
  const longest = Math.max(...EXPECTED_JOBS.map((j) => j.windowMs));
  const since = new Date(now.getTime() - longest - DAY).toISOString();
  const table = () => admin.from("job_runs" as never) as unknown as {
    select: (c: string) => any;
    delete: () => any;
  };

  const [{ data: rows, error }, { data: first }] = await Promise.all([
    table().select("job, ran_at, ok, status").gte("ran_at", since).order("ran_at", { ascending: false }).limit(20000),
    table().select("ran_at").order("ran_at", { ascending: true }).limit(1),
  ]);
  if (error) throw new Error(`job_runs read failed: ${error.message}`);
  const trackingSince = (first as Array<{ ran_at: string }> | null)?.[0]?.ran_at;

  const problems = evaluateJobHealth(
    (rows ?? []) as JobRunRow[],
    now,
    trackingSince ? new Date(trackingSince) : null,
  );

  // Keep two weeks of heartbeats.
  await table()
    .delete()
    .lt("ran_at", new Date(now.getTime() - 14 * DAY).toISOString())
    .then(
      () => undefined,
      () => undefined,
    );

  let emailed = false;
  if (problems.length) {
    log.warn("job health check: problems found", { jobs: problems.map((p) => p.job) });
    try {
      const { sendTransactionalEmailServer } = await import("@/lib/email/send-server");
      const sent = await sendTransactionalEmailServer({
        templateName: "job-health",
        recipientEmail: process.env.JOB_HEALTH_EMAIL || "hello@peakmovement.co.za",
        idempotencyKey: `job-health-${now.toISOString().slice(0, 10)}`,
        templateData: { problems },
      });
      emailed = sent.ok;
    } catch (e) {
      log.warn("job health check: email failed", {
        error: e instanceof Error ? e.message : "unknown",
      });
    }
  }
  return { ok: problems.length === 0, problems, emailed };
}
