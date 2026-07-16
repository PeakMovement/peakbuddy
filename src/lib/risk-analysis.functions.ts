import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Only the client themselves, their practitioner, or a super admin may
 *  read/compute a given client's risk data. Throws otherwise. */
async function assertClientAccess(
  admin: SupabaseClient,
  userId: string,
  clientId: string,
): Promise<void> {
  const { data: c } = await admin
    .from("clients")
    .select("auth_user_id, practitioner_id")
    .eq("id", clientId)
    .maybeSingle();
  if (!c) throw new Error("Forbidden");
  if (c.auth_user_id === userId || c.practitioner_id === userId) return;
  const { data: prof } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (prof?.role !== "super_admin") throw new Error("Forbidden");
}

/** Per-metric weights — must sum to 1. */
const WEIGHTS = { pain: 0.35, sleep: 0.2, stress: 0.2, energy: 0.15, mood: 0.1 } as const;
/** A z-score larger than this contributes its max weight. */
const Z_CAP = 2;

const BASELINE_DAYS = 30;
const RECENT_DAYS = 3;
const DRAFT_THRESHOLD = 60;
const DELTA_TRIGGER = 20;

type Metric = "pain" | "sleep" | "stress" | "energy" | "mood";
type CheckInRow = {
  created_at: string;
  pain_level: number | null;
  sleep_quality: number | null;
  stress_level: number | null;
  energy_level: number | null;
  mood: string | null;
};

const MOOD_MAP: Record<string, number> = {
  great: 5, good: 4, okay: 3, ok: 3, low: 2, bad: 1, terrible: 0,
};

function moodToNumber(m: string | null): number | null {
  if (!m) return null;
  const key = m.toLowerCase().trim();
  return MOOD_MAP[key] ?? null;
}

function meanStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length < 2) return { mean, std: 0 };
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return { mean, std: Math.sqrt(variance) };
}

/** Direction: which way is "worse" for each metric. */
const WORSE_DIRECTION: Record<Metric, 1 | -1> = {
  pain: 1, // higher pain = worse
  sleep: -1, // lower sleep = worse
  stress: 1,
  energy: -1,
  mood: -1,
};

function metricSeries(rows: CheckInRow[], m: Metric): number[] {
  return rows
    .map((r) => {
      if (m === "pain") return r.pain_level;
      if (m === "sleep") return r.sleep_quality;
      if (m === "stress") return r.stress_level;
      if (m === "energy") return r.energy_level;
      return moodToNumber(r.mood);
    })
    .filter((v): v is number => typeof v === "number");
}

export type RiskBreakdown = {
  metric: Metric;
  recent_mean: number | null;
  baseline_mean: number | null;
  z: number;
  contribution: number; // 0..1 (weighted)
  direction: "worse" | "better" | "flat";
};

export type ComputedRisk = {
  risk_score: number;
  trend: "improving" | "stable" | "worsening";
  breakdown: RiskBreakdown[];
  summary: string;
};

export const computeBaseline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) =>
    z.object({ clientId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertClientAccess(supabaseAdmin as unknown as SupabaseClient, context.userId, data.clientId);
    const since = new Date(Date.now() - BASELINE_DAYS * 86_400_000).toISOString();
    const { data: rows } = await supabaseAdmin
      .from("check_ins")
      .select("created_at, pain_level, sleep_quality, stress_level, energy_level, mood")
      .eq("client_id", data.clientId)
      .gte("created_at", since);
    const checkIns = (rows ?? []) as CheckInRow[];
    if (checkIns.length < 3) return { ok: false, reason: "insufficient_data" as const };

    const pain = meanStd(metricSeries(checkIns, "pain"));
    const sleep = meanStd(metricSeries(checkIns, "sleep"));
    const stress = meanStd(metricSeries(checkIns, "stress"));
    const energy = meanStd(metricSeries(checkIns, "energy"));
    const mood = meanStd(metricSeries(checkIns, "mood"));

    await supabaseAdmin
      .from("client_baselines")
      .upsert(
        {
          client_id: data.clientId,
          computed_at: new Date().toISOString(),
          pain_mean: pain.mean, pain_std: pain.std,
          sleep_mean: sleep.mean, sleep_std: sleep.std,
          stress_mean: stress.mean, stress_std: stress.std,
          energy_mean: energy.mean, energy_std: energy.std,
          mood_mean: mood.mean, mood_std: mood.std,
          sample_size: checkIns.length,
        },
        { onConflict: "client_id" },
      );

    return { ok: true as const, sample_size: checkIns.length };
  });

function computeRiskFromData(
  recent: CheckInRow[],
  baseline: {
    pain_mean: number | null; pain_std: number | null;
    sleep_mean: number | null; sleep_std: number | null;
    stress_mean: number | null; stress_std: number | null;
    energy_mean: number | null; energy_std: number | null;
    mood_mean: number | null; mood_std: number | null;
  },
): ComputedRisk {
  const breakdown: RiskBreakdown[] = [];
  let totalScore = 0;

  for (const metric of ["pain", "sleep", "stress", "energy", "mood"] as Metric[]) {
    const series = metricSeries(recent, metric);
    const recentMean = series.length ? series.reduce((a, b) => a + b, 0) / series.length : null;
    const baseMean = baseline[`${metric}_mean` as const];
    const baseStd = baseline[`${metric}_std` as const];

    let z = 0;
    if (recentMean !== null && baseMean !== null && baseStd && baseStd > 0.1) {
      z = (recentMean - baseMean) / baseStd;
    }
    const worseZ = z * WORSE_DIRECTION[metric]; // positive => worse than baseline
    const clamped = Math.max(0, Math.min(Z_CAP, worseZ)) / Z_CAP; // 0..1
    const contribution = clamped * WEIGHTS[metric];
    totalScore += contribution;

    breakdown.push({
      metric,
      recent_mean: recentMean,
      baseline_mean: baseMean,
      z: Number(worseZ.toFixed(2)),
      contribution: Number(contribution.toFixed(3)),
      direction: worseZ > 0.5 ? "worse" : worseZ < -0.5 ? "better" : "flat",
    });
  }

  const risk_score = Math.round(totalScore * 100);
  const worsening = breakdown.filter((b) => b.direction === "worse");
  const improving = breakdown.filter((b) => b.direction === "better");
  const trend: ComputedRisk["trend"] =
    risk_score >= 50 || worsening.length >= 2
      ? "worsening"
      : improving.length >= 2 && worsening.length === 0
        ? "improving"
        : "stable";

  const summary =
    worsening.length === 0
      ? "All metrics within baseline."
      : `${worsening.map((b) => `${b.metric} ↑`).join(", ")} vs 30-day baseline.`;

  return { risk_score, trend, breakdown, summary };
}

export const computeRiskScore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; forDate?: string }) =>
    z.object({ clientId: z.string().uuid(), forDate: z.string().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertClientAccess(supabaseAdmin as unknown as SupabaseClient, context.userId, data.clientId);
    const forDate = data.forDate ?? new Date().toISOString().slice(0, 10);

    const { data: baselineRow } = await supabaseAdmin
      .from("client_baselines")
      .select("*")
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (!baselineRow) return { ok: false as const, reason: "no_baseline" };

    const endIso = `${forDate}T23:59:59.999Z`;
    const startIso = new Date(Date.parse(`${forDate}T00:00:00Z`) - RECENT_DAYS * 86_400_000).toISOString();
    const { data: rows } = await supabaseAdmin
      .from("check_ins")
      .select("created_at, pain_level, sleep_quality, stress_level, energy_level, mood")
      .eq("client_id", data.clientId)
      .gte("created_at", startIso)
      .lte("created_at", endIso);
    const recent = (rows ?? []) as CheckInRow[];
    if (recent.length === 0) return { ok: false as const, reason: "no_recent_checkins" };

    const computed = computeRiskFromData(recent, baselineRow);

    const { data: saved } = await supabaseAdmin
      .from("risk_scores")
      .upsert(
        {
          client_id: data.clientId,
          score_date: forDate,
          risk_score: computed.risk_score,
          delta_vs_baseline: { breakdown: computed.breakdown },
          trend: computed.trend,
          summary: computed.summary,
        },
        { onConflict: "client_id,score_date" },
      )
      .select("id")
      .maybeSingle();

    return { ok: true as const, risk_score_id: saved?.id, ...computed };
  });

/** Pure helpers exposed for tests / cron worker. */
export const _internal = { computeRiskFromData, meanStd, metricSeries, DRAFT_THRESHOLD, DELTA_TRIGGER };

export type ListRiskTrendItem = {
  score_date: string;
  risk_score: number;
  trend: string;
};

export const listClientRiskTrend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; days?: number }) =>
    z.object({ clientId: z.string().uuid(), days: z.number().int().min(1).max(90).optional() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<ListRiskTrendItem[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertClientAccess(supabaseAdmin as unknown as SupabaseClient, context.userId, data.clientId);
    const days = data.days ?? 14;
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const { data: rows } = await supabaseAdmin
      .from("risk_scores")
      .select("score_date, risk_score, trend")
      .eq("client_id", data.clientId)
      .gte("score_date", since)
      .order("score_date", { ascending: true });
    return (rows ?? []) as ListRiskTrendItem[];
  });
