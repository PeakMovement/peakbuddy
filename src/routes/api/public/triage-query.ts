import { createFileRoute } from "@tanstack/react-router";
import { log } from "@/lib/log";
import { applyCombinationFloor, applyKeywordFloor, type RedFlagCategory, type UrgencyTier } from "@/lib/yves";
import {
  extractAndFirstPass,
  formatExtractionForPrompt,
  type Extraction,
  type FirstPassTriage,
} from "@/lib/yves-extraction.server";

const PROMPT_VERSION = "yves-2026-07-21-v3";

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ??
  "https://buddytracker.netlify.app,https://peakbuddy.lovable.app,https://buddy.peakmovement.co.za,http://localhost:3000,http://localhost:5173"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function corsHeadersFor(origin: string | null): Record<string, string> {
  const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  };
}

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_CLIENT = 10;
const rateBuckets = new Map<string, number[]>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  if (rateBuckets.size > 10_000) rateBuckets.clear();
  const hits = (rateBuckets.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX_PER_CLIENT) {
    rateBuckets.set(key, hits);
    return true;
  }
  hits.push(now);
  rateBuckets.set(key, hits);
  return false;
}

const MAX_QUERY_LENGTH = 2_000;
const SONNET_MODEL = "claude-sonnet-4-5-20250929";

const TRIAGE_TOOL = {
  name: "triage_result",
  description:
    "Return a structured clinical triage assessment. You must first REASON through the red-flag checklist, then score.",
  input_schema: {
    type: "object",
    required: [
      "severity",
      "urgency",
      "categories",
      "red_flags",
      "red_flag_category",
      "differential",
      "recommended_questions",
      "escalation_reason",
      "negation_detected",
      "attribution_detected",
      "rationale",
      "should_notify_practitioner",
      "confidence",
      "checklist_walkthrough",
      "what_would_change_my_mind",
    ],
    properties: {
      // Reason-then-score: model must fill these BEFORE the numeric fields.
      checklist_walkthrough: {
        type: "string",
        description:
          "2-6 sentences walking through which red-flag categories you considered and why they do or do not apply. Reason from the extracted signal and patient context. Fill this FIRST.",
      },
      what_would_change_my_mind: {
        type: "string",
        description:
          "The single most important piece of information that would raise or lower your urgency. Forces you to name your uncertainty.",
      },
      severity: { type: "integer", minimum: 0, maximum: 10 },
      urgency: { type: "string", enum: ["emergency", "urgent", "soon", "monitor", "routine"] },
      categories: { type: "array", items: { type: "string" } },
      red_flags: { type: "array", items: { type: "string" } },
      red_flag_category: {
        type: ["string", "null"],
        enum: [
          "cardiac",
          "neuro",
          "cauda_equina",
          "systemic",
          "mental_health",
          "infection",
          "msk_alarm",
          "respiratory",
          "general",
          null,
        ],
      },
      differential: {
        type: "array",
        description: "Top 2-3 possible clinical explanations, ranked.",
        items: {
          type: "object",
          required: ["explanation", "likelihood"],
          properties: {
            explanation: { type: "string" },
            likelihood: { type: "string", enum: ["high", "medium", "low"] },
          },
        },
      },
      recommended_questions: {
        type: "array",
        description: "1-3 follow-up questions Yves should ask the patient to clarify.",
        items: { type: "string" },
      },
      escalation_reason: {
        type: "string",
        enum: ["context", "current_text", "both", "none"],
      },
      negation_detected: { type: "boolean" },
      attribution_detected: { type: "boolean" },
      rationale: { type: "string" },
      should_notify_practitioner: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  },
};

const SYSTEM_PROMPT_BASE = `You are Yves, a clinical triage assistant embedded in Buddy — a health monitoring platform used by physiotherapists, biokineticists, sports scientists and other allied health professionals in South Africa.

<ROLE>
You review a patient's symptom message alongside a structured extraction (from a first-pass model) and rich patient context. You reason through the red-flag checklist, THEN score. You return the triage_result tool call.

You are a clinical reasoner, not a keyword matcher. When in doubt, err higher — a missed emergency is always worse than a false alarm.
</ROLE>

<RED_FLAG_CHECKLIST>
1. CARDIAC — chest pain/pressure/tightness, left arm pain, jaw pain, breathlessness on exertion, palpitations, irregular heartbeat
2. NEURO — sudden weakness, facial droop, speech changes, vision loss, sudden severe headache, new numbness, foot drop, fainting
3. CAUDA EQUINA — saddle numbness, new bladder/bowel changes, bilateral leg weakness → always emergency
4. SYSTEMIC / ONCOLOGICAL — unexplained weight loss, night sweats, new lumps, blood in urine/stool/spit, persistent fatigue
5. MENTAL HEALTH CRISIS — suicidal ideation, self-harm, psychosis, severe panic, hopelessness
6. INFECTION — fever with localised severe pain, neck stiffness with headache, spreading redness
7. MSK ALARM — recent trauma, sudden loss of joint function, locked joint, joint giving way repeatedly
8. RESPIRATORY — severe shortness of breath, wheezing, throat closing, coughing blood
</RED_FLAG_CHECKLIST>

<LANGUAGE>
Patients often write Afrikaans or mix it with English. Treat identically to English and triage the same. Common terms:
borspyn = chest pain · hartaanval = heart attack · beroerte = stroke · kortasem = short of breath ·
kan nie asemhaal nie = cannot breathe · stuiptrekking = seizure · verlam = paralysis ·
bewusteloos = unconscious · selfmoord = suicide · hartkloppings = palpitations · duiselig = dizzy ·
koors = fever · stywe nek = stiff neck · gevoelloos = numb · brandende pyn = burning pain ·
skietende pyn = shooting pain · flou word = fainting · nagsweet = night sweats ·
gewigsverlies = weight loss · rugpyn = back pain · bloed = blood
Never downgrade a symptom because it was written in Afrikaans.
</LANGUAGE>

<CLUSTERING>
Two or more symptoms from the SAME body system are materially more concerning together than any one alone. Escalate at least one tier and name the cluster in red_flags and rationale:
- cardiac: chest pain + breathlessness + jaw/left-arm pain + cold sweats
- neuro: facial droop + slurred speech + one-sided weakness
- cauda equina: bilateral leg symptoms + saddle numbness + bladder/bowel change
- infection: fever + stiff neck + headache
- systemic: weight loss + night sweats + persistent fatigue
</CLUSTERING>

<PROCESS>
1. Read the extracted signal and patient context BEFORE the raw message.
2. Fill checklist_walkthrough: enumerate which categories you considered and why they do/don't apply.
3. Fill what_would_change_my_mind: name your top uncertainty.
4. Build differential (2-3 ranked explanations).
5. Build recommended_questions (1-3).
6. Score severity (0-10) and urgency last, driven by the reasoning above.
7. Trust the extraction's negations and attributions unless the raw message clearly contradicts them.
8. Set escalation_reason="context" if today's text alone wouldn't warrant this urgency but history does.
9. Never return severity 0 for something the patient found worth reporting.
</PROCESS>

<SCORING>
SEVERITY: 0-2 routine, 3-4 monitor, 5-6 soon, 7-8 urgent, 9-10 emergency
URGENCY: emergency=call 112 now, urgent=same day, soon=24-48h, monitor=watch, routine=next appointment
</SCORING>`;

// Few-shot examples grouped by category. Only the relevant ones are injected
// per request, based on the first-pass red_flag_category.
const EXAMPLES: Record<string, string[]> = {
  cardiac: [
    '"Sharp pain shooting down my left arm with nausea" → cardiac presentation → emergency, severity 10, category cardiac',
    '"Heart is racing after coffee, feels fluttery" → possibly benign palpitations but rule out arrhythmia → soon, severity 5, category cardiac',
  ],
  neuro: [
    '"Worst headache of my life, came on suddenly" → possible SAH → emergency, severity 10, category neuro',
    '"My foot has gone completely numb suddenly" → nerve/vascular → urgent, category neuro',
    '"Headache every morning" → possible intracranial pressure → urgent, severity 7, category neuro',
  ],
  cauda_equina: [
    '"Cannot feel the saddle area, trouble peeing today" → cauda equina → emergency, severity 10',
    '"Both legs weak this week + new bladder leaking" → cauda equina alarm → emergency',
  ],
  systemic: [
    '"Losing weight without trying, exhausted, night sweats" → malignancy red flag → urgent, severity 7, category systemic',
    '"Blood in my urine yesterday, no pain" → urgent, severity 7, category systemic',
  ],
  mental_health: [
    '"Cannot stop crying, feel hopeless" → mental health → urgent, severity 7, category mental_health',
    '"I keep thinking about ending it" → emergency, severity 10, category mental_health',
  ],
  infection: [
    '"Fever with a really stiff neck and bad headache" → meningitis concern → urgent, severity 9, category infection',
  ],
  msk_alarm: [
    '"Knee gave way climbing stairs" (Knee Stability program) → relevant MSK alarm → soon, severity 6, category msk_alarm',
    '"Locked shoulder, cannot lift arm" → soon, severity 5, category msk_alarm',
  ],
  respiratory: [
    '"Very short of breath climbing stairs, wasn\'t like this last week" → urgent, category respiratory',
  ],
  general: [
    '"Lower back aches after sitting" → postural MSK → routine, severity 2',
    '"I feel dizzy every time I stand up" → orthostatic hypotension → soon, severity 5',
  ],
};

function buildSystemPrompt(firstPassCategory: string | null): string {
  const bucket = firstPassCategory && EXAMPLES[firstPassCategory] ? firstPassCategory : "general";
  const chosen = EXAMPLES[bucket];
  // Include the bucket's examples plus one general anchor so the model has a low-severity comparison.
  const general = bucket === "general" ? [] : EXAMPLES.general.slice(0, 1);
  const examplesBlock = ["<EXAMPLES>", ...chosen.map((e) => `- ${e}`), ...general.map((e) => `- ${e}`), "</EXAMPLES>"].join("\n");
  return `${SYSTEM_PROMPT_BASE}\n\n${examplesBlock}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Server-side context builder
// ─────────────────────────────────────────────────────────────────────────────
type SupabaseAdmin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

interface WearableDeltas {
  hrv_avg_7d: number | null;
  hrv_change_pct: number | null; // vs prior 7d
  rhr_avg_7d: number | null;
  rhr_change_bpm: number | null;
  sleep_debt_hrs_7d: number | null;
  latest_source: string | null;
  latest_date: string | null;
  last_night_readiness: number | null;
}

interface CalibrationPrior {
  cardiac: { confirmed: number; false_alarm: number };
  neuro: { confirmed: number; false_alarm: number };
  cauda_equina: { confirmed: number; false_alarm: number };
  systemic: { confirmed: number; false_alarm: number };
  mental_health: { confirmed: number; false_alarm: number };
  infection: { confirmed: number; false_alarm: number };
  msk_alarm: { confirmed: number; false_alarm: number };
  respiratory: { confirmed: number; false_alarm: number };
  general: { confirmed: number; false_alarm: number };
}

interface ServerContext {
  avgPainLast3: number | null;
  painTrend: "rising" | "falling" | "stable";
  flaggedCountLast7d: number;
  worseChangeRecent: boolean;
  checkInCount: number;
  assignedProgram: string | null;
  knownConditions: string | null;
  recentSymptoms: Array<{ note: string; pain: number | null; flagged: boolean; days_ago: number }>;
  previousRedFlags: Array<{ category: string; days_ago: number }>;
  daysSinceLastCheckIn: number | null;
  painChange7d: number | null;
  wearable: WearableDeltas;
  timeOfDay: { local_hour: number; period: "early-morning" | "morning" | "afternoon" | "evening" | "night" };
  calibration: CalibrationPrior | null;
}

const EMPTY_WEARABLE: WearableDeltas = {
  hrv_avg_7d: null,
  hrv_change_pct: null,
  rhr_avg_7d: null,
  rhr_change_bpm: null,
  sleep_debt_hrs_7d: null,
  latest_source: null,
  latest_date: null,
  last_night_readiness: null,
};

function periodFor(hour: number): ServerContext["timeOfDay"]["period"] {
  if (hour < 5) return "night";
  if (hour < 9) return "early-morning";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 22) return "evening";
  return "night";
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

async function buildWearableDeltas(
  admin: SupabaseAdmin,
  clientId: string,
): Promise<WearableDeltas> {
  try {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    const { data } = await admin
      .from("wearable_sessions")
      .select("date, source, hrv_avg, resting_hr, total_sleep_duration, readiness_score")
      .eq("client_id", clientId)
      .gte("date", fourteenDaysAgo)
      .order("date", { ascending: false });

    const rows = data ?? [];
    if (rows.length === 0) return EMPTY_WEARABLE;

    const sevenDaysAgoDate = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const recent = rows.filter((r) => r.date >= sevenDaysAgoDate);
    const prior = rows.filter((r) => r.date < sevenDaysAgoDate);

    const hrvR = avg(recent.map((r) => Number(r.hrv_avg)).filter((n) => Number.isFinite(n)));
    const hrvP = avg(prior.map((r) => Number(r.hrv_avg)).filter((n) => Number.isFinite(n)));
    const rhrR = avg(recent.map((r) => Number(r.resting_hr)).filter((n) => Number.isFinite(n)));
    const rhrP = avg(prior.map((r) => Number(r.resting_hr)).filter((n) => Number.isFinite(n)));

    // Sleep debt: expected 8h/night vs actual (seconds → hours), last 7d.
    const sleepSecs = recent
      .map((r) => Number(r.total_sleep_duration))
      .filter((n) => Number.isFinite(n) && n > 0);
    const totalSleepHrs = sleepSecs.reduce((a, b) => a + b / 3600, 0);
    const sleepDebt = sleepSecs.length > 0 ? sleepSecs.length * 8 - totalSleepHrs : null;

    const latest = rows[0];

    return {
      hrv_avg_7d: hrvR != null ? Math.round(hrvR * 10) / 10 : null,
      hrv_change_pct:
        hrvR != null && hrvP != null && hrvP > 0
          ? Math.round(((hrvR - hrvP) / hrvP) * 100)
          : null,
      rhr_avg_7d: rhrR != null ? Math.round(rhrR * 10) / 10 : null,
      rhr_change_bpm: rhrR != null && rhrP != null ? Math.round((rhrR - rhrP) * 10) / 10 : null,
      sleep_debt_hrs_7d: sleepDebt != null ? Math.round(sleepDebt * 10) / 10 : null,
      latest_source: latest?.source ?? null,
      latest_date: latest?.date ?? null,
      last_night_readiness: latest?.readiness_score != null ? Number(latest.readiness_score) : null,
    };
  } catch {
    return EMPTY_WEARABLE;
  }
}

async function buildCalibrationPrior(
  admin: SupabaseAdmin,
  practitionerId: string,
): Promise<CalibrationPrior | null> {
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const { data } = await admin
      .from("alerts")
      .select("red_flag_category, outcome")
      .eq("practitioner_id", practitionerId)
      .gte("created_at", ninetyDaysAgo)
      .not("outcome", "is", null);

    const rows = data ?? [];
    if (rows.length === 0) return null;

    const cats: (keyof CalibrationPrior)[] = [
      "cardiac",
      "neuro",
      "cauda_equina",
      "systemic",
      "mental_health",
      "infection",
      "msk_alarm",
      "respiratory",
      "general",
    ];
    const prior = Object.fromEntries(
      cats.map((c) => [c, { confirmed: 0, false_alarm: 0 }]),
    ) as unknown as CalibrationPrior;

    for (const r of rows) {
      const cat = (r.red_flag_category as keyof CalibrationPrior) ?? "general";
      if (!prior[cat]) continue;
      if (r.outcome === "confirmed") prior[cat].confirmed += 1;
      else if (r.outcome === "false_alarm") prior[cat].false_alarm += 1;
    }
    return prior;
  } catch {
    return null;
  }
}

async function buildServerContext(
  admin: SupabaseAdmin,
  clientId: string,
  practitionerId: string,
): Promise<ServerContext> {
  const now = Date.now();
  const hour = new Date().getUTCHours(); // SA is UTC+2 but we treat this as an approximation

  const empty: ServerContext = {
    avgPainLast3: null,
    painTrend: "stable",
    flaggedCountLast7d: 0,
    worseChangeRecent: false,
    checkInCount: 0,
    assignedProgram: null,
    knownConditions: null,
    recentSymptoms: [],
    previousRedFlags: [],
    daysSinceLastCheckIn: null,
    painChange7d: null,
    wearable: EMPTY_WEARABLE,
    timeOfDay: { local_hour: hour, period: periodFor(hour) },
    calibration: null,
  };

  try {
    const [{ data: checkIns }, { data: client }, { data: pastAlerts }, wearable, calibration] =
      await Promise.all([
        admin
          .from("check_ins")
          .select("pain_level, notes, flagged, created_at")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(10),
        admin
          .from("clients")
          .select("notes, suggested_program_id")
          .eq("id", clientId)
          .maybeSingle(),
        admin
          .from("alerts")
          .select("red_flag_category, created_at")
          .eq("client_id", clientId)
          .eq("practitioner_id", practitionerId)
          .gte("created_at", new Date(now - 30 * 86_400_000).toISOString())
          .order("created_at", { ascending: false })
          .limit(10),
        buildWearableDeltas(admin, clientId),
        buildCalibrationPrior(admin, practitionerId),
      ]);

    const list = checkIns ?? [];

    const last3Pain = list
      .slice(0, 3)
      .map((c) => c.pain_level)
      .filter((p): p is number => typeof p === "number");
    const avgPainLast3 = last3Pain.length
      ? Math.round((last3Pain.reduce((a, b) => a + b, 0) / last3Pain.length) * 10) / 10
      : null;

    let painTrend: "rising" | "falling" | "stable" = "stable";
    if (last3Pain.length >= 3) {
      const diff = last3Pain[0] - last3Pain[2];
      if (diff >= 2) painTrend = "rising";
      else if (diff <= -2) painTrend = "falling";
    }

    const sevenDaysAgo = now - 7 * 86_400_000;
    const flaggedCountLast7d = list.filter(
      (c) => c.flagged && new Date(c.created_at).getTime() >= sevenDaysAgo,
    ).length;

    const daysSinceLastCheckIn = list[0]
      ? Math.floor((now - new Date(list[0].created_at).getTime()) / 86_400_000)
      : null;

    const within7d = list.filter((c) => new Date(c.created_at).getTime() >= sevenDaysAgo);
    let painChange7d: number | null = null;
    if (within7d.length >= 2) {
      const newest = within7d[0].pain_level;
      const oldest = within7d[within7d.length - 1].pain_level;
      if (typeof newest === "number" && typeof oldest === "number") {
        painChange7d = newest - oldest;
      }
    }

    const recentSymptoms = list
      .filter((c) => c.notes && c.notes.trim().length > 0)
      .slice(0, 5)
      .map((c) => ({
        note: (c.notes ?? "").slice(0, 200),
        pain: c.pain_level,
        flagged: c.flagged,
        days_ago: Math.floor((now - new Date(c.created_at).getTime()) / 86_400_000),
      }));

    let assignedProgram: string | null = null;
    if (client?.suggested_program_id) {
      const { data: prog } = await admin
        .from("programs")
        .select("name, focus_area")
        .eq("id", client.suggested_program_id)
        .maybeSingle();
      if (prog) {
        assignedProgram = prog.focus_area ? `${prog.name} (${prog.focus_area})` : prog.name;
      }
    }

    const previousRedFlags = (pastAlerts ?? [])
      .filter((a) => a.red_flag_category)
      .map((a) => ({
        category: a.red_flag_category as string,
        days_ago: Math.floor((now - new Date(a.created_at).getTime()) / 86_400_000),
      }));

    return {
      avgPainLast3,
      painTrend,
      flaggedCountLast7d,
      worseChangeRecent: painTrend === "rising",
      checkInCount: list.length,
      assignedProgram,
      knownConditions: client?.notes ?? null,
      recentSymptoms,
      previousRedFlags,
      daysSinceLastCheckIn,
      painChange7d,
      wearable,
      timeOfDay: { local_hour: hour, period: periodFor(hour) },
      calibration,
    };
  } catch (e) {
    log.warn("[triage-query] context build failed, using empty context:", e);
    return empty;
  }
}

function formatContextBlock(ctx: ServerContext): string {
  const lines: string[] = ["<PATIENT_CONTEXT>"];
  lines.push(`When: ${ctx.timeOfDay.period} (hour ${ctx.timeOfDay.local_hour} UTC)`);
  if (ctx.assignedProgram) lines.push(`Active program: ${ctx.assignedProgram}`);
  if (ctx.knownConditions)
    lines.push(`Practitioner notes / known conditions: ${ctx.knownConditions.slice(0, 400)}`);
  lines.push(`Total check-ins: ${ctx.checkInCount}`);
  if (ctx.daysSinceLastCheckIn !== null) {
    lines.push(`Days since last check-in: ${ctx.daysSinceLastCheckIn}`);
  }
  if (ctx.avgPainLast3 !== null) {
    lines.push(`Avg pain last 3: ${ctx.avgPainLast3}/10 (trend: ${ctx.painTrend})`);
  }
  if (ctx.painChange7d !== null) {
    lines.push(`Pain change 7d: ${ctx.painChange7d > 0 ? "+" : ""}${ctx.painChange7d}`);
  }
  lines.push(`Flagged check-ins last 7d: ${ctx.flaggedCountLast7d}`);

  if (ctx.previousRedFlags.length > 0) {
    lines.push("Previous red-flag alerts (last 30d):");
    for (const rf of ctx.previousRedFlags) {
      lines.push(`  - ${rf.category} (${rf.days_ago}d ago)`);
    }
  }

  if (ctx.recentSymptoms.length > 0) {
    lines.push("Recent symptom notes (newest first):");
    for (const s of ctx.recentSymptoms) {
      const pain = s.pain !== null ? `pain ${s.pain}/10` : "no pain score";
      const flag = s.flagged ? " [FLAGGED]" : "";
      lines.push(`  - ${s.days_ago}d ago, ${pain}${flag}: "${s.note}"`);
    }
  }

  const w = ctx.wearable;
  if (w.latest_source) {
    lines.push(`Wearable (${w.latest_source}, latest ${w.latest_date}):`);
    if (w.hrv_avg_7d != null) {
      const chg = w.hrv_change_pct != null ? ` (${w.hrv_change_pct > 0 ? "+" : ""}${w.hrv_change_pct}% vs prior 7d)` : "";
      lines.push(`  - HRV 7d avg: ${w.hrv_avg_7d}ms${chg}`);
    }
    if (w.rhr_avg_7d != null) {
      const chg = w.rhr_change_bpm != null ? ` (${w.rhr_change_bpm > 0 ? "+" : ""}${w.rhr_change_bpm} bpm)` : "";
      lines.push(`  - Resting HR 7d avg: ${w.rhr_avg_7d}${chg}`);
    }
    if (w.sleep_debt_hrs_7d != null) {
      lines.push(`  - Sleep debt 7d: ${w.sleep_debt_hrs_7d}h`);
    }
    if (w.last_night_readiness != null) {
      lines.push(`  - Last-night readiness: ${w.last_night_readiness}/100`);
    }
  }

  if (ctx.calibration) {
    const parts: string[] = [];
    for (const [cat, v] of Object.entries(ctx.calibration)) {
      const total = v.confirmed + v.false_alarm;
      if (total >= 3) parts.push(`${cat}: ${v.confirmed}/${total} confirmed`);
    }
    if (parts.length > 0) {
      lines.push(`Practice priors (last 90d, informational — do not use to downgrade a red flag): ${parts.join("; ")}`);
    }
  }

  lines.push("</PATIENT_CONTEXT>");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Reasoning-model triage call
// ─────────────────────────────────────────────────────────────────────────────
type TriageOutput = {
  urgency: UrgencyTier;
  severity: number;
  categories?: string[];
  red_flags?: string[];
  red_flag_category?: RedFlagCategory | null;
  differential?: unknown;
  recommended_questions?: unknown;
  escalation_reason?: string;
  negation_detected?: boolean;
  attribution_detected?: boolean;
  rationale?: string;
  should_notify_practitioner?: boolean;
  confidence?: number;
  checklist_walkthrough?: string;
  what_would_change_my_mind?: string;
};

async function callReasoningModel(params: {
  apiKey: string;
  queryText: string;
  contextBlock: string;
  extractionBlock: string;
  firstPass: FirstPassTriage | null;
  category: string | null;
  timeoutMs: number;
  memoryRules: Array<{ scope: string; rule_type: string; title: string; rule_text: string }>;
}): Promise<{ ok: true; data: TriageOutput; latencyMs: number } | { ok: false; error: string; latencyMs: number }> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const { buildYvesSystemPrompt } = await import("@/lib/yves-identity");
    const system = buildYvesSystemPrompt({
      base: buildSystemPrompt(params.category),
      scope: "triage",
      memoryRules: params.memoryRules,
    });

    const firstPassBlock = params.firstPass
      ? `<FIRST_PASS_OPINION>
A cheaper first-pass model suggested: urgency=${params.firstPass.urgency}, severity=${params.firstPass.severity}, category=${params.firstPass.red_flag_category ?? "none"}, confidence=${params.firstPass.confidence}.
Rationale: ${params.firstPass.short_rationale}
You may agree or override. State your reasoning independently.
</FIRST_PASS_OPINION>`
      : "";

    const userMessage = [
      `<PATIENT_MESSAGE>\n"${params.queryText}"\n</PATIENT_MESSAGE>`,
      params.extractionBlock,
      params.contextBlock,
      firstPassBlock,
    ]
      .filter(Boolean)
      .join("\n\n");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": params.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: SONNET_MODEL,
        max_tokens: 2048,
        system,
        tools: [TRIAGE_TOOL],
        tool_choice: { type: "tool", name: "triage_result" },
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { ok: false, error: `sonnet ${res.status}: ${errText.slice(0, 160)}`, latencyMs: Date.now() - started };
    }
    const data = (await res.json()) as { content?: Array<{ type: string; input?: unknown }> };
    const toolUse = data.content?.find((item) => item.type === "tool_use");
    if (!toolUse?.input) return { ok: false, error: "no tool_use in sonnet response", latencyMs: Date.now() - started };
    return { ok: true, data: toolUse.input as TriageOutput, latencyMs: Date.now() - started };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timeout);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────────
// ── Server-side red-flag alert (reliability safety net) ──────────────────────
// Yves detects red flags on the server, but the client browser is what fires
// the practitioner alert. If the user closes the tab or loses network before
// that runs, the practitioner is never notified — the worst failure mode for a
// clinical product. Firing here (before we respond) guarantees delivery.
//
// Idempotent with the client path: this insert commits before the HTTP response
// is sent, so the client's own findRecentOpenAlert() check then sees it and
// no-ops — no double alert. notifyAlertPush also atomically claims push_fired,
// so a push can never be sent twice. Fully wrapped: any failure here is logged
// and swallowed so the triage response (and the client fallback) is unaffected.
async function fireServerRedFlagAlert(
  admin: (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"],
  args: {
    clientId: string;
    practitionerId: string;
    queryText: string;
    urgency: string;
    severity: number;
  },
): Promise<void> {
  try {
    const isRedFlag =
      args.severity >= 5 || args.urgency === "urgent" || args.urgency === "emergency";
    if (!isRedFlag) return;

    // Same 24h open-alert dedup the client uses.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await admin
      .from("alerts")
      .select("id")
      .eq("client_id", args.clientId)
      .eq("alert_type", "red_flag")
      .eq("is_read", false)
      .gte("created_at", since)
      .limit(1);
    if (existing && existing.length > 0) return;

    const { data: alertRow } = await admin
      .from("alerts")
      .insert({
        practitioner_id: args.practitionerId,
        client_id: args.clientId,
        alert_type: "red_flag",
        message: `Red flag detected: ${args.queryText.slice(0, 100)}`,
        urgency: args.urgency,
      })
      .select("id")
      .single();

    const alertId = (alertRow?.id as string | undefined) ?? undefined;
    if (!alertId) return;

    // Use the service-role cores directly (the notifyAlert* serverFns are
    // auth-middleware-gated for browser callers; here we are a trusted server
    // that already authenticated the user and detected the red flag).

    // Push — atomically claim push_fired so this can never double-send with the
    // client path (mirrors notifyAlertPush's claim).
    try {
      const { data: claimed } = await admin
        .from("alerts")
        .update({ push_fired: true })
        .eq("id", alertId)
        .eq("push_fired", false)
        .select("id")
        .maybeSingle();
      if (claimed) {
        const { data: cli } = await admin
          .from("clients")
          .select("full_name")
          .eq("id", args.clientId)
          .maybeSingle();
        const firstName = ((cli?.full_name as string | null) || "Your client").trim().split(/\s+/)[0];
        const { sendPushCore } = await import("@/lib/push.functions");
        await sendPushCore(admin, {
          userId: args.practitionerId,
          title: "Buddy alert",
          body: `${firstName} reported symptoms that may need review`,
          data: { clientId: args.clientId, kind: "yves" },
        });
      }
    } catch (e) {
      log.warn("[triage-query] server-side push failed:", e);
    }

    // Email — idempotent on email_fired inside the core.
    try {
      const { sendAlertEmailCore } = await import("@/lib/notify-practitioner.functions");
      await sendAlertEmailCore(admin, alertId);
    } catch (e) {
      log.warn("[triage-query] server-side email failed:", e);
    }
  } catch (e) {
    log.warn("[triage-query] server-side red-flag alert failed (client path is fallback):", e);
  }
}

export const Route = createFileRoute("/api/public/triage-query")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 200, headers: corsHeadersFor(request.headers.get("origin")) }),
      POST: async ({ request }) => {
        const cors = corsHeadersFor(request.headers.get("origin"));
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { ...cors, "Content-Type": "application/json" },
          });

        const requestStart = Date.now();

        try {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (!apiKey) return json({ error: "Service not configured" }, 500);

          const authHeader = request.headers.get("authorization");
          if (!authHeader?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);
          const token = authHeader.slice("Bearer ".length);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
          const userEmail = userData?.user?.email?.toLowerCase();
          if (userErr || !userEmail) return json({ error: "Invalid or expired session" }, 401);

          const body = (await request.json().catch(() => null)) as {
            query_text?: unknown;
            client_id?: unknown;
          } | null;
          const query_text = body?.query_text;
          const client_id = typeof body?.client_id === "string" ? body.client_id : null;

          if (!query_text || typeof query_text !== "string")
            return json({ error: "query_text is required" }, 400);
          if (query_text.length > MAX_QUERY_LENGTH)
            return json({ error: `query_text exceeds ${MAX_QUERY_LENGTH} characters` }, 400);
          if (!client_id) return json({ error: "client_id is required" }, 400);

          if (isRateLimited(client_id))
            return json({ error: "Too many requests, slow down", retryable: true }, 429);

          const { data: c, error: cErr } = await supabaseAdmin
            .from("clients")
            .select("practitioner_id, yves_enabled, yves_ai_consent, email")
            .eq("id", client_id)
            .maybeSingle();

          if (cErr) {
            log.warn("[triage-query] client lookup failed, failing closed:", cErr.code);
            return json({ error: "Access check unavailable, try again", retryable: true }, 503);
          }
          if (!c) return json({ error: "Client not found" }, 403);
          if (!c.email || c.email.toLowerCase() !== userEmail)
            return json({ error: "Not authorized for this client" }, 403);
          if (!c.practitioner_id)
            return json({ error: "Yves access disabled: no practitioner" }, 403);
          if (c.yves_enabled === false)
            return json({ error: "Yves access disabled for client" }, 403);
          if (c.yves_ai_consent !== true) {
            return json(
              {
                error:
                  "AI consent required. Please agree to share your symptom messages with our AI provider before using Yves.",
                code: "ai_consent_required",
              },
              403,
            );
          }

          // Per-client daily limit: max 3 Yves questions per calendar day.
          const dayStart = new Date();
          dayStart.setUTCHours(0, 0, 0, 0);
          const { count: usedToday } = await supabaseAdmin
            .from("symptom_queries")
            .select("id", { count: "exact", head: true })
            .eq("client_id", client_id)
            .gte("created_at", dayStart.toISOString());
          if ((usedToday ?? 0) >= 3) {
            return json(
              {
                error:
                  "You've reached today's limit of 3 Yves questions. Please continue tomorrow, or contact your practitioner if this is urgent.",
                code: "daily_limit_reached",
              },
              429,
            );
          }

          const { data: p, error: pErr } = await supabaseAdmin
            .from("practices")
            .select("yves_enabled, ai_features_enabled")
            .eq("practitioner_id", c.practitioner_id)
            .maybeSingle();
          if (pErr) {
            log.warn("[triage-query] practice lookup failed, failing closed:", pErr.code);
            return json({ error: "Access check unavailable, try again", retryable: true }, 503);
          }
          if (!p || p.ai_features_enabled !== true) {
            return json(
              {
                error:
                  "AI features are not enabled for your clinic. Please contact your practitioner.",
                code: "ai_disabled",
              },
              403,
            );
          }
          if (p.yves_enabled === false)
            return json({ error: "Yves access disabled for practice" }, 403);

          // Global kill switch
          const { data: platform } = await supabaseAdmin
            .from("platform_settings")
            .select("programs_feature_enabled")
            .limit(1)
            .maybeSingle();
          if (platform && platform.programs_feature_enabled === false) {
            return json(
              { error: "AI features are temporarily unavailable.", code: "ai_disabled" },
              503,
            );
          }

          // ── Build context (server-side, real data) ────────────────────────
          const ctx = await buildServerContext(supabaseAdmin, client_id, c.practitioner_id);
          const contextBlock = formatContextBlock(ctx);

          // ── Phase 2: extraction + first-pass triage (Haiku) ──────────────
          let extraction: Extraction | null = null;
          let firstPass: FirstPassTriage | null = null;
          let extractionModel: string | null = null;
          const extractResult = await extractAndFirstPass({
            apiKey,
            queryText: query_text,
            contextBlock,
            timeoutMs: 10_000,
          });
          if (extractResult.ok) {
            extraction = extractResult.data.extraction;
            firstPass = extractResult.data.triage;
            extractionModel = "claude-3-5-haiku-20241022";
          } else {
            log.warn("[triage-query] extraction failed, continuing without:", extractResult.error);
          }

          const extractionBlock = extraction ? formatExtractionForPrompt(extraction) : "";

          // ── Phase 3: router — decide if we need the strong reasoning model ──
          // We ALWAYS run Sonnet today (safest), but decide whether to include
          // the first-pass opinion. When the first-pass looks confident and low
          // risk, Sonnet still confirms — this is the "second opinion" path.
          const escalationReasons: string[] = [];
          if (!firstPass) escalationReasons.push("no_first_pass");
          else {
            if (firstPass.severity >= 6) escalationReasons.push("severity_ge_6");
            if (firstPass.confidence < 0.7) escalationReasons.push("low_confidence");
            if (firstPass.red_flag_category) escalationReasons.push("red_flag_category_set");
          }

          // Load active Yves memory for triage surface (global + triage only),
          // via cached helper — high-volume path.
          const { getActiveYvesMemoryForScopesCached } = await import(
            "@/lib/yves-memory-cache.server"
          );
          const triageMemoryRules = await getActiveYvesMemoryForScopesCached(
            supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient,
            ["global", "triage"],
          );

          const sonnetResult = await callReasoningModel({
            apiKey,
            queryText: query_text,
            contextBlock,
            extractionBlock,
            firstPass,
            category: firstPass?.red_flag_category ?? null,
            timeoutMs: 15_000,
            memoryRules: triageMemoryRules,
          });

          if (!sonnetResult.ok) {
            log.error("[triage-query] sonnet call failed:", sonnetResult.error);
            // Log the failure for observability then fall back to first-pass if we have it.
            await supabaseAdmin.from("yves_triage_logs").insert({
              client_id,
              practitioner_id: c.practitioner_id,
              prompt_version: PROMPT_VERSION,
              query_text_len: query_text.length,
              extraction_model: extractionModel,
              extraction_output: (extraction ?? null) as unknown as import("@/integrations/supabase/types").Json,
              first_pass_model: firstPass ? "claude-3-5-haiku-20241022" : null,
              first_pass_urgency: firstPass?.urgency ?? null,
              first_pass_severity: firstPass?.severity ?? null,
              first_pass_confidence: firstPass?.confidence ?? null,
              escalated: true,
              escalation_reasons: escalationReasons,
              final_model: null,
              total_latency_ms: Date.now() - requestStart,
              error: sonnetResult.error,
            });

            if (firstPass) {
              // Return first-pass triage as a fallback so the client can still respond.
              const fallback: TriageOutput = {
                urgency: firstPass.urgency,
                severity: firstPass.severity,
                red_flag_category: firstPass.red_flag_category as RedFlagCategory | null,
                confidence: firstPass.confidence * 0.7, // discount since it wasn't reviewed
                rationale: firstPass.short_rationale,
                red_flags: [],
                categories: [],
                differential: [],
                recommended_questions: [],
                escalation_reason: "none",
                negation_detected: (extraction?.negations.length ?? 0) > 0,
                attribution_detected: (extraction?.attributions.length ?? 0) > 0,
                should_notify_practitioner: firstPass.severity >= 6,
              };
              const fallbackOut = applySafetyFloors(query_text, fallback);
              await fireServerRedFlagAlert(supabaseAdmin, {
                clientId: client_id,
                practitionerId: c.practitioner_id,
                queryText: query_text,
                urgency: fallbackOut.urgency,
                severity: fallbackOut.severity,
              });
              const cleanFallback = { ...fallbackOut } as Record<string, unknown>;
              delete cleanFallback._floor_terms;
              delete cleanFallback._combo_terms;
              return json(cleanFallback);
            }
            return json({ error: "Triage service unavailable", retryable: true }, 502);
          }

          // Apply combination floor + existing keyword floor on the final output
          // so a moderate cluster the model missed still escalates.
          const finalOutput = applySafetyFloors(query_text, sonnetResult.data);

          // Observability
          try {
            await supabaseAdmin.from("yves_triage_logs").insert({
              client_id,
              practitioner_id: c.practitioner_id,
              prompt_version: PROMPT_VERSION,
              query_text_len: query_text.length,
              extraction_model: extractionModel,
              extraction_output: (extraction ?? null) as unknown as import("@/integrations/supabase/types").Json,
              first_pass_model: firstPass ? "claude-3-5-haiku-20241022" : null,
              first_pass_urgency: firstPass?.urgency ?? null,
              first_pass_severity: firstPass?.severity ?? null,
              first_pass_confidence: firstPass?.confidence ?? null,
              escalated: escalationReasons.length > 0,
              escalation_reasons: escalationReasons,
              final_model: SONNET_MODEL,
              final_urgency: finalOutput.urgency,
              final_severity: finalOutput.severity,
              final_red_flag_category: finalOutput.red_flag_category ?? null,
              floor_terms_hit: (finalOutput as unknown as { _floor_terms?: string[] })._floor_terms ?? [],
              combination_floor_hit: (finalOutput as unknown as { _combo_terms?: string[] })._combo_terms ?? [],
              total_latency_ms: Date.now() - requestStart,
            });
          } catch (e) {
            log.warn("[triage-query] failed to write triage log:", e);
          }

          // Fire the practitioner alert server-side so delivery does not depend
          // on the client keeping the tab open (idempotent with the client path).
          await fireServerRedFlagAlert(supabaseAdmin, {
            clientId: client_id,
            practitionerId: c.practitioner_id,
            queryText: query_text,
            urgency: finalOutput.urgency,
            severity: finalOutput.severity,
          });

          // Strip internal debugging fields before returning
          const clean = { ...finalOutput } as Record<string, unknown>;
          delete clean._floor_terms;
          delete clean._combo_terms;
          return json(clean);
        } catch (err) {
          log.error("[triage-query] unhandled error:", err);
          return json({ error: "Internal error", retryable: true }, 500);
        }
      },
    },
  },
});

// Apply the keyword + combination safety floors on top of the model output.
// Floors can only ESCALATE, never downgrade — that invariant is preserved by
// the underlying applyKeywordFloor / applyCombinationFloor implementations.
function applySafetyFloors(
  queryText: string,
  ai: TriageOutput,
): TriageOutput & { _floor_terms?: string[]; _combo_terms?: string[] } {
  if (ai.negation_detected || ai.attribution_detected) return ai;

  const floor = applyKeywordFloor(queryText, ai.urgency, ai.severity);
  const combo = applyCombinationFloor(queryText, floor.urgency, floor.severity);

  const escalated = floor.escalated || combo.escalated;
  if (!escalated) return { ...ai, _floor_terms: [], _combo_terms: [] };

  const cluster = combo.matched.length > 0 ? ` Cluster: ${combo.matched.join(", ")}.` : "";
  return {
    ...ai,
    urgency: combo.urgency,
    severity: combo.severity,
    red_flag_category: ai.red_flag_category ?? combo.topCategory ?? floor.topCategory,
    should_notify_practitioner: combo.severity >= 6,
    red_flags: [...(ai.red_flags ?? []), ...floor.matchedTerms, ...combo.matched],
    rationale:
      (ai.rationale ?? "") +
      (cluster ? ` Safety floor escalated based on detected cluster.${cluster}` : " Safety floor escalated based on detected terms."),
    _floor_terms: floor.matchedTerms,
    _combo_terms: combo.matched,
  };
}
