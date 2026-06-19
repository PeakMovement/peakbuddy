import { createFileRoute } from "@tanstack/react-router";
import { log } from "@/lib/log";

const BATCH_SIZE = 50;
const DRAFT_THRESHOLD = 60;
const DELTA_TRIGGER = 20;

type Metric = "pain" | "sleep" | "stress" | "energy" | "mood";

type ClientRow = {
  id: string;
  full_name: string;
  practitioner_id: string;
  primary_complaint: string | null;
  passive_monitoring_enabled: boolean;
  yves_ai_consent: boolean | null;
};

type CheckInRow = {
  created_at: string;
  pain_level: number | null;
  sleep_quality: number | null;
  stress_level: number | null;
  energy_level: number | null;
  mood: string | null;
};

type BaselineRow = {
  pain_mean: number | null; pain_std: number | null;
  sleep_mean: number | null; sleep_std: number | null;
  stress_mean: number | null; stress_std: number | null;
  energy_mean: number | null; energy_std: number | null;
  mood_mean: number | null; mood_std: number | null;
};

type ProgramRow = {
  id: string;
  name: string;
  description: string;
  symptom_tags: string[];
};

const MOOD_MAP: Record<string, number> = {
  great: 5, good: 4, okay: 3, ok: 3, low: 2, bad: 1, terrible: 0,
};
function moodToNumber(m: string | null): number | null {
  if (!m) return null;
  return MOOD_MAP[m.toLowerCase().trim()] ?? null;
}
function meanStd(vals: number[]) {
  if (!vals.length) return { mean: 0, std: 0 };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (vals.length < 2) return { mean, std: 0 };
  const v = vals.reduce((s, x) => s + (x - mean) ** 2, 0) / (vals.length - 1);
  return { mean, std: Math.sqrt(v) };
}
function metricSeries(rows: CheckInRow[], m: Metric): number[] {
  return rows
    .map((r) =>
      m === "pain" ? r.pain_level
      : m === "sleep" ? r.sleep_quality
      : m === "stress" ? r.stress_level
      : m === "energy" ? r.energy_level
      : moodToNumber(r.mood),
    )
    .filter((v): v is number => typeof v === "number");
}
const WEIGHTS: Record<Metric, number> = { pain: 0.35, sleep: 0.2, stress: 0.2, energy: 0.15, mood: 0.1 };
const WORSE_DIR: Record<Metric, 1 | -1> = { pain: 1, sleep: -1, stress: 1, energy: -1, mood: -1 };
const Z_CAP = 2;

function computeRisk(recent: CheckInRow[], baseline: BaselineRow) {
  const breakdown: { metric: Metric; recent_mean: number | null; baseline_mean: number | null; z: number; direction: "worse" | "better" | "flat" }[] = [];
  let total = 0;
  for (const metric of ["pain","sleep","stress","energy","mood"] as Metric[]) {
    const series = metricSeries(recent, metric);
    const recentMean = series.length ? series.reduce((a,b) => a+b, 0) / series.length : null;
    const baseMean = baseline[`${metric}_mean` as const];
    const baseStd = baseline[`${metric}_std` as const];
    let z = 0;
    if (recentMean !== null && baseMean !== null && baseStd && baseStd > 0.1) {
      z = (recentMean - baseMean) / baseStd;
    }
    const worseZ = z * WORSE_DIR[metric];
    const clamped = Math.max(0, Math.min(Z_CAP, worseZ)) / Z_CAP;
    total += clamped * WEIGHTS[metric];
    breakdown.push({
      metric, recent_mean: recentMean, baseline_mean: baseMean,
      z: Number(worseZ.toFixed(2)),
      direction: worseZ > 0.5 ? "worse" : worseZ < -0.5 ? "better" : "flat",
    });
  }
  const risk_score = Math.round(total * 100);
  const worsening = breakdown.filter((b) => b.direction === "worse");
  const improving = breakdown.filter((b) => b.direction === "better");
  const trend =
    risk_score >= 50 || worsening.length >= 2 ? "worsening"
    : improving.length >= 2 && worsening.length === 0 ? "improving"
    : "stable";
  const summary = worsening.length === 0
    ? "All metrics within baseline."
    : `${worsening.map((b) => `${b.metric} worse than baseline`).join("; ")}.`;
  return { risk_score, trend, breakdown, summary };
}

async function aiDraft(args: {
  client: ClientRow;
  recent: CheckInRow[];
  computed: ReturnType<typeof computeRisk>;
  programs: ProgramRow[];
}): Promise<{ title: string; body: string; program_id?: string; reason?: string } | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key || !args.client.yves_ai_consent) return null;
  const programsList = args.programs.map((p) => ({
    id: p.id, name: p.name, tags: p.symptom_tags,
  }));
  const prompt = `You are an assistant for a clinical practitioner.
Patient: ${args.client.full_name}
Primary complaint: ${args.client.primary_complaint || "(not set)"}
Current risk score: ${args.computed.risk_score}/100 (trend: ${args.computed.trend})
Metric breakdown: ${JSON.stringify(args.computed.breakdown)}
Recent check-ins (last 3 days): ${JSON.stringify(args.recent.slice(0, 10))}
Available approved programs: ${JSON.stringify(programsList)}

Draft a SHORT note (max 3 sentences) for the practitioner explaining what's trending and ONE concrete suggested action. Optionally pick the single best program id from the list.

Respond ONLY with strict JSON:
{"title":"<<= 60 chars>","body":"<<= 300 chars>","program_id":"<id or null>","reason":"<one short sentence or null>"}`;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as { title?: string; body?: string; program_id?: string | null; reason?: string | null };
    if (!parsed.title || !parsed.body) return null;
    return {
      title: parsed.title.slice(0, 60),
      body: parsed.body.slice(0, 300),
      program_id: parsed.program_id && args.programs.some((p) => p.id === parsed.program_id) ? parsed.program_id : undefined,
      reason: parsed.reason ?? undefined,
    };
  } catch (e) {
    log.warn("ai draft failed", e);
    return null;
  }
}

function templateDraft(client: ClientRow, computed: ReturnType<typeof computeRisk>): { title: string; body: string } {
  return {
    title: `Risk score ${computed.risk_score} — ${client.full_name}`,
    body: `${client.full_name}'s risk score moved to ${computed.risk_score}/100 (${computed.trend}). ${computed.summary} Consider checking in.`,
  };
}

type AdminClient = typeof import("@/integrations/supabase/client.server")["supabaseAdmin"];

async function processClient(
  supabaseAdmin: AdminClient,
  client: ClientRow,
  programs: ProgramRow[],
  forDate: string,
) {
  // 1. Baseline
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: bRows } = await supabaseAdmin
    .from("check_ins")
    .select("created_at, pain_level, sleep_quality, stress_level, energy_level, mood")
    .eq("client_id", client.id)
    .gte("created_at", since30);
  const baseCheckIns = (bRows ?? []) as CheckInRow[];
  if (baseCheckIns.length < 3) return { skipped: "insufficient_history" as const };

  const pain = meanStd(metricSeries(baseCheckIns, "pain"));
  const sleep = meanStd(metricSeries(baseCheckIns, "sleep"));
  const stress = meanStd(metricSeries(baseCheckIns, "stress"));
  const energy = meanStd(metricSeries(baseCheckIns, "energy"));
  const mood = meanStd(metricSeries(baseCheckIns, "mood"));
  const baseline: BaselineRow = {
    pain_mean: pain.mean, pain_std: pain.std,
    sleep_mean: sleep.mean, sleep_std: sleep.std,
    stress_mean: stress.mean, stress_std: stress.std,
    energy_mean: energy.mean, energy_std: energy.std,
    mood_mean: mood.mean, mood_std: mood.std,
  };
  await supabaseAdmin.from("client_baselines").upsert(
    { client_id: client.id, computed_at: new Date().toISOString(), sample_size: baseCheckIns.length, ...baseline },
    { onConflict: "client_id" },
  );

  // 2. Recent risk
  const endIso = `${forDate}T23:59:59.999Z`;
  const startIso = new Date(Date.parse(`${forDate}T00:00:00Z`) - 3 * 86_400_000).toISOString();
  const { data: rRows } = await supabaseAdmin
    .from("check_ins")
    .select("created_at, pain_level, sleep_quality, stress_level, energy_level, mood")
    .eq("client_id", client.id)
    .gte("created_at", startIso)
    .lte("created_at", endIso);
  const recent = (rRows ?? []) as CheckInRow[];
  if (recent.length === 0) return { skipped: "no_recent" as const };

  const computed = computeRisk(recent, baseline);
  const { data: saved } = await supabaseAdmin
    .from("risk_scores")
    .upsert(
      {
        client_id: client.id,
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

  // 3. Trigger?
  const { data: prevRow } = await supabaseAdmin
    .from("risk_scores")
    .select("risk_score")
    .eq("client_id", client.id)
    .lt("score_date", forDate)
    .order("score_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const prevScore = (prevRow as { risk_score: number } | null)?.risk_score ?? 0;
  const jumped = computed.risk_score - prevScore >= DELTA_TRIGGER;
  const shouldDraft = computed.risk_score >= DRAFT_THRESHOLD || jumped;
  if (!shouldDraft) return { ok: true as const, risk_score: computed.risk_score, drafted: false };

  // 4. Rate-limit: skip if a draft already exists for this client today.
  const todayStart = new Date(`${forDate}T00:00:00Z`).toISOString();
  const { count: existing } = await supabaseAdmin
    .from("practitioner_drafts")
    .select("*", { count: "exact", head: true })
    .eq("client_id", client.id)
    .gte("created_at", todayStart);
  if ((existing ?? 0) > 0) return { ok: true as const, risk_score: computed.risk_score, drafted: false };

  // 5. Draft via AI (if consented) or template fallback.
  const ai = await aiDraft({ client, recent, computed, programs });
  const draft = ai ?? templateDraft(client, computed);
  const suggested_action: { program_id?: string; program_name?: string; reason?: string } = {};
  if (ai?.program_id) {
    const prog = programs.find((p) => p.id === ai.program_id);
    if (prog) {
      suggested_action.program_id = prog.id;
      suggested_action.program_name = prog.name;
      if (ai.reason) suggested_action.reason = ai.reason;
    }
  }
  await supabaseAdmin.from("practitioner_drafts").insert({
    practitioner_id: client.practitioner_id,
    client_id: client.id,
    risk_score_id: saved?.id ?? null,
    kind: "risk_flare",
    draft_title: draft.title,
    draft_body: draft.body,
    suggested_action,
    status: "new",
  });
  return { ok: true as const, risk_score: computed.risk_score, drafted: true };
}

export const Route = createFileRoute("/api/public/hooks/nightly-risk-analysis")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get("apikey") ?? request.headers.get("Apikey");
        if (!apiKey || apiKey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Platform kill-switch
        const { data: settings } = await supabaseAdmin
          .from("platform_settings")
          .select("passive_monitoring_enabled")
          .limit(1)
          .maybeSingle();
        if ((settings as { passive_monitoring_enabled?: boolean } | null)?.passive_monitoring_enabled === false) {
          return Response.json({ ok: true, skipped: "feature_disabled" });
        }

        const forDate = new Date().toISOString().slice(0, 10);
        const { data: programs } = await supabaseAdmin
          .from("programs")
          .select("id, name, description, symptom_tags")
          .eq("active", true)
          .eq("approved_by_admin", true);
        const programRows = (programs ?? []) as ProgramRow[];

        const stats = { processed: 0, drafted: 0, errors: 0, skipped: 0 };
        let from = 0;
        // Loop in pages
        for (;;) {
          const { data: clients, error } = await supabaseAdmin
            .from("clients")
            .select("id, full_name, practitioner_id, primary_complaint, passive_monitoring_enabled, yves_ai_consent")
            .eq("passive_monitoring_enabled", true)
            .range(from, from + BATCH_SIZE - 1);
          if (error) {
            log.error("nightly batch fetch failed", error);
            break;
          }
          const rows = (clients ?? []) as ClientRow[];
          if (rows.length === 0) break;
          for (const c of rows) {
            try {
              const r = await processClient(supabaseAdmin, c, programRows, forDate);
              stats.processed += 1;
              if ("skipped" in r) stats.skipped += 1;
              else if (r.drafted) stats.drafted += 1;
            } catch (e) {
              stats.errors += 1;
              log.error(`nightly client ${c.id} failed`, e);
            }
          }
          if (rows.length < BATCH_SIZE) break;
          from += BATCH_SIZE;
        }

        return Response.json({ ok: true, forDate, ...stats });
      },
    },
  },
});
