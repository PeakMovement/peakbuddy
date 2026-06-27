import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type InsightsPayload = {
  kpis: {
    activeClients: number;
    checkins7d: number;
    avgPain: number | null;
    avgPainDelta: number | null; // vs 6 weeks ago
    contacted7d: number;
  };
  checkInTrend: { day: string; checkins: number }[]; // last 7 days
  painTrend: { week: string; pain: number | null }[]; // last 6 weeks
  progressBuckets: { name: "Improving" | "Stable" | "Worsening" | "No data"; value: number }[];
  contactStatus: { label: string; value: number }[];
  symptoms: { name: string; count: number }[];
  topMovers: { name: string; delta: number }[];
};

const DAY_MS = 86_400_000;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Lightweight symptom buckets — substring matches against check-in notes.
const SYMPTOM_BUCKETS: { name: string; needles: string[] }[] = [
  { name: "Lower back", needles: ["lower back", "lumbar", "low back"] },
  { name: "Knee", needles: ["knee"] },
  { name: "Shoulder", needles: ["shoulder"] },
  { name: "Neck", needles: ["neck", "cervical"] },
  { name: "Sleep", needles: ["sleep", "insomnia"] },
  { name: "Headache", needles: ["headache", "migraine"] },
  { name: "Hip", needles: ["hip"] },
  { name: "Ankle", needles: ["ankle"] },
];

export const getPracticeInsights = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InsightsPayload> => {
    const { supabase, userId } = context;
    const now = Date.now();
    const since6w = new Date(now - 42 * DAY_MS).toISOString();
    const since7d = new Date(now - 7 * DAY_MS).toISOString();
    const since14d = new Date(now - 14 * DAY_MS).toISOString();

    const [{ data: clients }, { data: checkIns }, { data: alerts }] = await Promise.all([
      supabase
        .from("clients")
        .select("id, full_name, created_at")
        .eq("practitioner_id", userId),
      supabase
        .from("check_ins")
        .select("client_id, pain_level, notes, created_at")
        .eq("practitioner_id", userId)
        .gte("created_at", since6w),
      supabase
        .from("alerts")
        .select("id, outcome, outcome_at, created_at")
        .eq("practitioner_id", userId)
        .gte("created_at", since14d),
    ]);

    const clientList = clients ?? [];
    const checkInList = checkIns ?? [];
    const alertList = alerts ?? [];

    // KPI: active clients = any check-in in 14d
    const activeClientIds = new Set(
      checkInList.filter((c) => c.created_at >= since14d).map((c) => c.client_id),
    );

    // KPI: check-ins last 7d
    const checkins7d = checkInList.filter((c) => c.created_at >= since7d).length;

    // KPI: avg pain (last 7d) vs avg pain 5–6 weeks ago
    const recentPain = checkInList
      .filter((c) => c.created_at >= since7d && typeof c.pain_level === "number")
      .map((c) => c.pain_level as number);
    const sinceOlderStart = new Date(now - 42 * DAY_MS).toISOString();
    const sinceOlderEnd = new Date(now - 35 * DAY_MS).toISOString();
    const olderPain = checkInList
      .filter(
        (c) =>
          c.created_at >= sinceOlderStart &&
          c.created_at < sinceOlderEnd &&
          typeof c.pain_level === "number",
      )
      .map((c) => c.pain_level as number);
    const avg = (xs: number[]) =>
      xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
    const avgPain = avg(recentPain);
    const olderAvg = avg(olderPain);
    const avgPainDelta =
      avgPain !== null && olderAvg !== null ? Math.round((avgPain - olderAvg) * 10) / 10 : null;

    // KPI: contacted (alerts marked with any outcome) in 7d
    const contacted7d = alertList.filter(
      (a) => a.outcome && a.outcome_at && a.outcome_at >= since7d,
    ).length;

    // Check-in trend last 7 days
    const trendBuckets = new Map<string, number>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * DAY_MS);
      trendBuckets.set(d.toISOString().slice(0, 10), 0);
    }
    checkInList.forEach((c) => {
      const key = c.created_at.slice(0, 10);
      if (trendBuckets.has(key)) trendBuckets.set(key, (trendBuckets.get(key) ?? 0) + 1);
    });
    const checkInTrend = Array.from(trendBuckets.entries()).map(([iso, count]) => ({
      day: DOW[new Date(iso).getUTCDay()],
      checkins: count,
    }));

    // Pain trend last 6 weeks (W1 oldest → W6 newest)
    const painTrend: { week: string; pain: number | null }[] = [];
    for (let w = 5; w >= 0; w--) {
      const start = now - (w + 1) * 7 * DAY_MS;
      const end = now - w * 7 * DAY_MS;
      const xs = checkInList
        .filter((c) => {
          const t = new Date(c.created_at).getTime();
          return t >= start && t < end && typeof c.pain_level === "number";
        })
        .map((c) => c.pain_level as number);
      painTrend.push({ week: `W${6 - w}`, pain: avg(xs) });
    }

    // Progress buckets: per-client delta first-half vs second-half of 6w window
    const byClient = new Map<string, number[]>();
    checkInList.forEach((c) => {
      if (typeof c.pain_level !== "number") return;
      if (!byClient.has(c.client_id)) byClient.set(c.client_id, []);
    });
    const splitMid = now - 21 * DAY_MS;
    const perClientDelta = new Map<string, number | null>();
    clientList.forEach((cl) => {
      const rows = checkInList.filter(
        (c) => c.client_id === cl.id && typeof c.pain_level === "number",
      );
      const early = rows.filter((c) => new Date(c.created_at).getTime() < splitMid);
      const late = rows.filter((c) => new Date(c.created_at).getTime() >= splitMid);
      if (early.length === 0 || late.length === 0) {
        perClientDelta.set(cl.id, null);
        return;
      }
      const e = early.reduce((a, b) => a + (b.pain_level as number), 0) / early.length;
      const l = late.reduce((a, b) => a + (b.pain_level as number), 0) / late.length;
      perClientDelta.set(cl.id, Math.round((l - e) * 10) / 10);
    });

    let improving = 0,
      stable = 0,
      worsening = 0,
      noData = 0;
    perClientDelta.forEach((d) => {
      if (d === null) noData += 1;
      else if (d <= -0.5) improving += 1;
      else if (d >= 0.5) worsening += 1;
      else stable += 1;
    });

    const progressBuckets: InsightsPayload["progressBuckets"] = [
      { name: "Improving", value: improving },
      { name: "Stable", value: stable },
      { name: "Worsening", value: worsening },
      { name: "No data", value: noData },
    ];

    // Outreach status
    const contactedThisWeek = contacted7d;
    const awaiting = alertList.filter((a) => !a.outcome).length;
    const overdue = alertList.filter(
      (a) => !a.outcome && a.created_at < new Date(now - 14 * DAY_MS).toISOString(),
    ).length;
    const contactStatus = [
      { label: "Contacted this week", value: contactedThisWeek },
      { label: "Awaiting outreach", value: awaiting },
      { label: "Overdue (>14d)", value: overdue },
    ];

    // Symptoms — substring scan over notes from last 6w
    const counts = new Map<string, number>();
    SYMPTOM_BUCKETS.forEach((b) => counts.set(b.name, 0));
    checkInList.forEach((c) => {
      const n = (c.notes ?? "").toLowerCase();
      if (!n) return;
      SYMPTOM_BUCKETS.forEach((b) => {
        if (b.needles.some((kw) => n.includes(kw))) {
          counts.set(b.name, (counts.get(b.name) ?? 0) + 1);
        }
      });
    });
    const symptoms = Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count);

    // Top movers (largest |delta|)
    const movers = clientList
      .map((cl) => {
        const d = perClientDelta.get(cl.id);
        if (d === null || d === undefined) return null;
        const first = (cl.full_name || "").trim().split(/\s+/);
        const display =
          first.length >= 2
            ? `${first[0][0] ?? ""}. ${first[first.length - 1]}`
            : first[0] || "Client";
        return { name: display, delta: d };
      })
      .filter((m): m is { name: string; delta: number } => m !== null)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 5);

    return {
      kpis: {
        activeClients: activeClientIds.size,
        checkins7d,
        avgPain,
        avgPainDelta,
        contacted7d,
      },
      checkInTrend,
      painTrend,
      progressBuckets,
      contactStatus,
      symptoms,
      topMovers: movers,
    };
  });
