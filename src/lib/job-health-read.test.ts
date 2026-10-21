import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
const sent: any[] = [];
vi.mock("@/lib/email/send-server", () => ({
  sendTransactionalEmailServer: vi.fn(async (m: any) => (sent.push(m), { ok: true })),
}));

import { EXPECTED_JOBS, runJobHealthCheck } from "./job-runs.server";
import { readAllPages } from "./whatsapp/drive-backup.server";

const H = 3_600_000;
const NOW = new Date("2026-10-21T06:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

/** Like the real API: any read returns at most 1000 rows. */
function cappedDb(rows: any[]) {
  const from = () => {
    const f: Array<(r: any) => boolean> = [];
    let asc = false;
    let lim = 1000;
    const api: any = {
      select: () => api,
      eq: (k: string, v: unknown) => (f.push((r) => r[k] === v), api),
      gte: (k: string, v: string) => (f.push((r) => r[k] >= v), api),
      lt: () => api,
      order: (_k: string, o: { ascending: boolean }) => ((asc = o.ascending), api),
      limit: (n: number) => ((lim = Math.min(n, 1000)), api),
      delete: () => api,
      then: (res: any, rej: any) => {
        const out = rows
          .filter((r) => f.every((x) => x(r)))
          .sort((a, b) => (asc ? 1 : -1) * a.ran_at.localeCompare(b.ran_at))
          .slice(0, lim);
        return Promise.resolve({ data: out, error: null }).then(res, rej);
      },
    };
    return api;
  };
  return { from } as any;
}

describe("daily job health check", () => {
  it("sees daily and weekly jobs even when minute ticks fill the first 1000 rows", async () => {
    const rows: any[] = [];
    // 9 days of every-minute and every-5-minute ticks: far more than 1000 rows.
    for (let m = 0; m < 9 * 24 * 60; m++) {
      rows.push({ job: "whatsapp-worker-tick", ran_at: ago(m * 60_000), ok: true, status: 200 });
      if (m % 5 === 0)
        rows.push({
          job: "checkin-reminders-tick",
          ran_at: ago(m * 60_000),
          ok: true,
          status: 200,
        });
    }
    for (const j of EXPECTED_JOBS) {
      if (j.job.includes("tick")) continue;
      rows.push({ job: j.job, ran_at: ago(5 * H), ok: true, status: 200 });
    }
    const r = await runJobHealthCheck(cappedDb(rows), NOW);
    expect(r.problems).toEqual([]);
  });

  it("still reports a weekly job whose last run failed, with its reason", async () => {
    const rows: any[] = [];
    for (let m = 0; m < 2000; m++)
      rows.push({ job: "whatsapp-worker-tick", ran_at: ago(m * 60_000), ok: true, status: 200 });
    for (const j of EXPECTED_JOBS) {
      if (j.job.includes("tick")) continue;
      rows.push({ job: j.job, ran_at: ago(5 * H), ok: true, status: 200 });
    }
    rows.push({ job: "checkin-reminders-tick", ran_at: ago(60_000), ok: true, status: 200 });
    rows.push({
      job: "whatsapp-drive-backup-weekly",
      ran_at: ago(H),
      ok: false,
      status: 503,
      detail: "drive connector not linked",
    });
    // Tracking started 30 days ago.
    rows.push({ job: "old", ran_at: ago(30 * 24 * H), ok: true, status: 200 });
    const r = await runJobHealthCheck(cappedDb(rows), NOW);
    expect(r.problems.map((p) => p.job)).toEqual(["whatsapp-drive-backup-weekly"]);
    expect(r.problems[0].problem).toContain("503: drive connector not linked");
  });
});

describe("drive backup paging", () => {
  it("reads past the 1000-row cap", async () => {
    const all = Array.from({ length: 2500 }, (_, i) => i);
    const got = await readAllPages(async (lo, hi) => ({ data: all.slice(lo, hi + 1) }));
    expect(got).toHaveLength(2500);
  });
});
