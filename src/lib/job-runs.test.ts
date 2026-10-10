import { describe, expect, it } from "vitest";
import { EXPECTED_JOBS, evaluateJobHealth, type JobRunRow } from "./job-runs.server";

const now = new Date("2026-10-09T06:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const H = 3_600_000;

function allHealthy(): JobRunRow[] {
  return EXPECTED_JOBS.map(({ job }) => ({ job, ran_at: ago(5 * 60_000), ok: true, status: 200 }));
}

describe("job health", () => {
  it("is quiet when every job ran recently", () => {
    expect(evaluateJobHealth(allHealthy(), now, new Date(ago(30 * 24 * H)))).toEqual([]);
  });

  it("flags a job whose latest run failed", () => {
    const rows = allHealthy();
    rows.push({ job: "wearables-sync-daily", ran_at: ago(60_000), ok: false, status: 500 });
    const p = evaluateJobHealth(rows, now, new Date(ago(30 * 24 * H)));
    expect(p.map((x) => x.job)).toEqual(["wearables-sync-daily"]);
    expect(p[0].problem).toContain("500");
  });

  it("flags a job that has gone quiet past its window", () => {
    const rows = allHealthy().filter((r) => r.job !== "checkin-reminders-tick");
    rows.push({ job: "checkin-reminders-tick", ran_at: ago(2 * H), ok: true, status: 200 });
    const p = evaluateJobHealth(rows, now, new Date(ago(30 * 24 * H)));
    expect(p.map((x) => x.job)).toEqual(["checkin-reminders-tick"]);
  });

  it("does not judge weekly jobs in the first days of tracking", () => {
    const rows = allHealthy().filter((r) => !r.job.includes("weekly"));
    const p = evaluateJobHealth(rows, now, new Date(ago(2 * 24 * H)));
    expect(p).toEqual([]);
  });

  it("includes the health check in the jobs it watches", () => {
    expect(EXPECTED_JOBS.map((j) => j.job)).toContain("job-health-check");
  });

  it("flags a red-flag delivery failure from the last day", () => {
    const rows = allHealthy();
    rows.push({
      job: "red-flag-notify",
      ran_at: ago(60_000),
      ok: false,
      status: 500,
      detail: "WhatsApp alert template is not configured",
    });
    const p = evaluateJobHealth(rows, now, new Date(ago(30 * 24 * H)));
    const hit = p.find((x) => x.job === "red-flag-notify");
    expect(hit?.problem).toContain("WhatsApp alert template is not configured");
  });

  it("ignores a red-flag delivery failure older than a day", () => {
    const rows = allHealthy();
    rows.push({
      job: "red-flag-notify",
      ran_at: ago(48 * H),
      ok: false,
      status: 500,
      detail: "old",
    });
    expect(evaluateJobHealth(rows, now, new Date(ago(30 * 24 * H))).map((x) => x.job)).not.toContain(
      "red-flag-notify",
    );
  });

  it("flags a job that never ran once tracking is old enough", () => {
    const rows = allHealthy().filter((r) => r.job !== "nightly-risk-analysis");
    const p = evaluateJobHealth(rows, now, new Date(ago(3 * 24 * H)));
    expect(p.map((x) => x.job)).toEqual(["nightly-risk-analysis"]);
  });
});
