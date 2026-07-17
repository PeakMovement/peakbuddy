import { createFileRoute } from "@tanstack/react-router";
import { log } from "@/lib/log";

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

const TRIAGE_TOOL = {
  name: "triage_result",
  description:
    "Return a structured clinical triage assessment after walking the red-flag checklist.",
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
    ],
    properties: {
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
        description: "Which red-flag checklist item triggered the highest concern, if any.",
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
        description:
          "Whether the urgency was driven by today's symptom description, the patient's prior history/context, or both.",
      },
      negation_detected: { type: "boolean" },
      attribution_detected: { type: "boolean" },
      rationale: { type: "string" },
      should_notify_practitioner: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  },
};

const SYSTEM_PROMPT = `You are Yves, a clinical triage assistant embedded in Buddy — a health monitoring platform used by physiotherapists, biokineticists, sports scientists and other allied health professionals in South Africa.

Your job is to assess patient-reported symptoms and return a structured clinical triage result using the triage_result tool.

═══════════════════════════════════════════════════════
CRITICAL — YOU ARE A CLINICAL REASONER, NOT A KEYWORD MATCHER
═══════════════════════════════════════════════════════

Read the full description AND the patient's history. Reason about what they are experiencing and what it could mean clinically.

═══════════════════════════════════════════════════════
RED-FLAG CHECKLIST — WALK THROUGH EVERY ONE BEFORE SCORING
═══════════════════════════════════════════════════════

1. CARDIAC — chest pain/pressure/tightness, left arm pain, jaw pain, breathlessness on exertion, palpitations, irregular heartbeat → cardiac
2. NEURO — sudden weakness, facial droop, speech changes, vision loss, sudden severe headache, new numbness, foot drop, fainting → neuro
3. CAUDA EQUINA — saddle numbness, new bladder/bowel changes, bilateral leg weakness → cauda_equina (always emergency)
4. SYSTEMIC / ONCOLOGICAL — unexplained weight loss, night sweats, new lumps, blood in urine/stool/spit, persistent fatigue → systemic
5. MENTAL HEALTH CRISIS — suicidal ideation, self-harm, psychosis, severe panic, hopelessness → mental_health
6. INFECTION — fever with localised severe pain, neck stiffness with headache, spreading redness → infection
7. MSK ALARM — recent trauma, sudden loss of joint function, locked joint, joint giving way repeatedly → msk_alarm
8. RESPIRATORY — severe shortness of breath, wheezing, throat closing, coughing blood → respiratory

For each, ask: does today's description OR the patient's recent history suggest this? Pick the highest-concern category as red_flag_category.

═══════════════════════════════════════════════════════
LANGUAGE — SOUTH AFRICAN ENGLISH AND AFRIKAANS
═══════════════════════════════════════════════════════

Patients often write in Afrikaans or mix it with English. Treat these as
identical to their English meaning and triage them exactly the same:

- borspyn / pyn op die bors = chest pain      - hartaanval = heart attack
- beroerte = stroke                            - kortasem / benoud = short of breath
- kan nie asemhaal nie = cannot breathe        - stuiptrekking = seizure
- verlam / verlamming = paralysis              - bewusteloos = unconscious
- selfmoord = suicide                          - hartkloppings = palpitations
- duiselig = dizzy                             - naar = nauseous
- koors = fever                                - stywe nek = stiff neck
- gevoelloos / verdowing = numb / numbness     - brandende pyn = burning pain
- skietende pyn = shooting pain                - flou word = fainting
- nagsweet = night sweats                      - gewigsverlies = weight loss
- rugpyn = back pain                           - bloed = blood

Never downgrade a symptom because it was written in Afrikaans.

═══════════════════════════════════════════════════════
SYMPTOM CLUSTERING — COMBINATIONS MATTER
═══════════════════════════════════════════════════════

Two or more symptoms from the SAME body system are materially more concerning
together than any one alone. Escalate at least one tier for these clusters, and
name the cluster you saw in red_flags and rationale:

- cardiac: chest pain + breathlessness + jaw or left-arm pain + cold sweats
- neuro: facial droop + slurred speech + one-sided weakness
- cauda equina: bilateral leg symptoms + saddle numbness + bladder/bowel change
- infection: fever + stiff neck + headache, or fever + severe localised pain
- systemic: unexplained weight loss + night sweats + persistent fatigue

═══════════════════════════════════════════════════════
USE THE PATIENT PROFILE — CONTEXT MATTERS
═══════════════════════════════════════════════════════

- A patient on a Knee Stability program reporting knee buckling → relevant, monitor closely
- 3rd flagged check-in this week with rising pain → escalate one tier even if today's text is mild → escalation_reason: "context"
- Previously flagged sciatic symptoms + new bladder issue → cauda equina alarm → emergency
- Long gap since last check-in + new symptom → take seriously, they only message when worried

═══════════════════════════════════════════════════════
REASONING EXAMPLES
═══════════════════════════════════════════════════════

- "My eyes are bleeding" → acute ocular/vascular event → emergency, severity 10, category general
- "Sharp pain shooting down my left arm with nausea" → cardiac presentation → emergency, severity 10, category cardiac
- "Headache every morning" → possible intracranial pressure, hypertension → urgent, severity 7, category neuro
- "Losing weight without trying, exhausted" → malignancy red flag → urgent, severity 7, category systemic
- "My foot has gone completely numb suddenly" → nerve/vascular → urgent, category neuro
- "Cannot stop crying, feel hopeless" → mental health → urgent, severity 7, category mental_health
- "Lower back aches after sitting" → postural MSK → routine, severity 2
- "I feel dizzy every time I stand up" → orthostatic hypotension → soon, severity 5
- "Knee gave way climbing stairs" (on Knee Stability program) → relevant MSK alarm → soon, severity 6, category msk_alarm

═══════════════════════════════════════════════════════
RULES
═══════════════════════════════════════════════════════

1. Reason about the whole clinical picture — not individual words
2. A single alarming symptom overrides everything else
3. Detect negation — "I don't have chest pain" → negation_detected: true, lower urgency
4. Detect attribution — "my friend has chest pain" → attribution_detected: true
5. When in doubt choose the higher urgency tier — a missed emergency is always worse
6. Use patient context — rising pain trend, recurring red-flag category, or relevant assigned program escalates urgency
7. Set escalation_reason: "context" if today's text alone wouldn't warrant the urgency but history does
8. Always provide 2-3 differential explanations ranked by likelihood
9. Always provide 1-3 follow-up questions you'd want answered
10. Always complete the triage_result tool call
11. Rationale must be 2-3 plain English sentences explaining reasoning to a non-medical reader
12. Never return severity 0 for any complaint the patient finds significant enough to report

SEVERITY: 0-2 routine, 3-4 monitor, 5-6 soon, 7-8 urgent, 9-10 emergency
URGENCY: emergency=call 112 now, urgent=same day, soon=24-48h, monitor=watch and wait, routine=next appointment

When in doubt err toward higher urgency. False positive always safer than false negative.`;

// ─────────────────────────────────────────────────────────────────────────────
// Server-side context builder — pulls fresh data from DB so the AI gets the
// real clinical picture, not whatever the client chose to send.
// ─────────────────────────────────────────────────────────────────────────────
type SupabaseAdmin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

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
}

async function buildServerContext(
  admin: SupabaseAdmin,
  clientId: string,
  practitionerId: string,
): Promise<ServerContext> {
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
  };

  try {
    // Recent check-ins (last 10)
    const { data: checkIns } = await admin
      .from("check_ins")
      .select("pain_level, notes, flagged, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(10);

    const list = checkIns ?? [];
    const now = Date.now();

    // Pain stats
    const last3Pain = list
      .slice(0, 3)
      .map((c) => c.pain_level)
      .filter((p): p is number => typeof p === "number");
    const avgPainLast3 = last3Pain.length
      ? Math.round((last3Pain.reduce((a, b) => a + b, 0) / last3Pain.length) * 10) / 10
      : null;

    // Trend over last 3
    let painTrend: "rising" | "falling" | "stable" = "stable";
    if (last3Pain.length >= 3) {
      const diff = last3Pain[0] - last3Pain[2];
      if (diff >= 2) painTrend = "rising";
      else if (diff <= -2) painTrend = "falling";
    }

    // Flagged in last 7d
    const sevenDaysAgo = now - 7 * 86_400_000;
    const flaggedCountLast7d = list.filter(
      (c) => c.flagged && new Date(c.created_at).getTime() >= sevenDaysAgo,
    ).length;

    // Days since last check-in
    const daysSinceLastCheckIn = list[0]
      ? Math.floor((now - new Date(list[0].created_at).getTime()) / 86_400_000)
      : null;

    // Pain change last 7d (oldest in 7d window vs most recent)
    const within7d = list.filter((c) => new Date(c.created_at).getTime() >= sevenDaysAgo);
    let painChange7d: number | null = null;
    if (within7d.length >= 2) {
      const newest = within7d[0].pain_level;
      const oldest = within7d[within7d.length - 1].pain_level;
      if (typeof newest === "number" && typeof oldest === "number") {
        painChange7d = newest - oldest;
      }
    }

    // Recent symptoms with notes
    const recentSymptoms = list
      .filter((c) => c.notes && c.notes.trim().length > 0)
      .slice(0, 5)
      .map((c) => ({
        note: (c.notes ?? "").slice(0, 200),
        pain: c.pain_level,
        flagged: c.flagged,
        days_ago: Math.floor((now - new Date(c.created_at).getTime()) / 86_400_000),
      }));

    // Client profile: notes + assigned program
    const { data: client } = await admin
      .from("clients")
      .select("notes, suggested_program_id")
      .eq("id", clientId)
      .maybeSingle();

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

    // Previous red-flag alerts in last 30d
    const thirtyDaysAgo = now - 30 * 86_400_000;
    const { data: pastAlerts } = await admin
      .from("alerts")
      .select("red_flag_category, created_at")
      .eq("client_id", clientId)
      .eq("practitioner_id", practitionerId)
      .gte("created_at", new Date(thirtyDaysAgo).toISOString())
      .order("created_at", { ascending: false })
      .limit(10);

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
    };
  } catch (e) {
    log.warn("[triage-query] context build failed, using empty context:", e);
    return empty;
  }
}

function formatContextBlock(ctx: ServerContext): string {
  const lines: string[] = ["═══ PATIENT PROFILE ═══"];
  if (ctx.assignedProgram) lines.push(`Active program: ${ctx.assignedProgram}`);
  if (ctx.knownConditions)
    lines.push(`Known notes/conditions: ${ctx.knownConditions.slice(0, 400)}`);
  lines.push(`Total check-ins logged: ${ctx.checkInCount}`);
  if (ctx.daysSinceLastCheckIn !== null) {
    lines.push(`Days since last check-in: ${ctx.daysSinceLastCheckIn}`);
  }
  if (ctx.avgPainLast3 !== null) {
    lines.push(`Average pain last 3 check-ins: ${ctx.avgPainLast3}/10 (trend: ${ctx.painTrend})`);
  }
  if (ctx.painChange7d !== null) {
    lines.push(`Pain change over 7 days: ${ctx.painChange7d > 0 ? "+" : ""}${ctx.painChange7d}`);
  }
  lines.push(`Flagged check-ins last 7d: ${ctx.flaggedCountLast7d}`);

  if (ctx.previousRedFlags.length > 0) {
    lines.push("");
    lines.push("Previous red-flag alerts (last 30d):");
    for (const rf of ctx.previousRedFlags) {
      lines.push(`  - ${rf.category} (${rf.days_ago}d ago)`);
    }
  }

  if (ctx.recentSymptoms.length > 0) {
    lines.push("");
    lines.push("Recent symptom notes (most recent first):");
    for (const s of ctx.recentSymptoms) {
      const pain = s.pain !== null ? `pain ${s.pain}/10` : "no pain score";
      const flag = s.flagged ? " [FLAGGED]" : "";
      lines.push(`  - ${s.days_ago}d ago, ${pain}${flag}: "${s.note}"`);
    }
  }

  return lines.join("\n");
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

        try {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (!apiKey) {
            return json({ error: "Service not configured" }, 500);
          }

          const authHeader = request.headers.get("authorization");
          if (!authHeader?.startsWith("Bearer ")) {
            return json({ error: "Authentication required" }, 401);
          }
          const token = authHeader.slice("Bearer ".length);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
          const userEmail = userData?.user?.email?.toLowerCase();
          if (userErr || !userEmail) {
            return json({ error: "Invalid or expired session" }, 401);
          }

          const body = (await request.json().catch(() => null)) as {
            query_text?: unknown;
            client_id?: unknown;
          } | null;
          const query_text = body?.query_text;
          const client_id = typeof body?.client_id === "string" ? body.client_id : null;

          if (!query_text || typeof query_text !== "string") {
            return json({ error: "query_text is required" }, 400);
          }
          if (query_text.length > MAX_QUERY_LENGTH) {
            return json({ error: `query_text exceeds ${MAX_QUERY_LENGTH} characters` }, 400);
          }
          if (!client_id) {
            return json({ error: "client_id is required" }, 400);
          }

          if (isRateLimited(client_id)) {
            return json({ error: "Too many requests, slow down", retryable: true }, 429);
          }

          const { data: c, error: cErr } = await supabaseAdmin
            .from("clients")
            .select("practitioner_id, yves_enabled, yves_ai_consent, email")
            .eq("id", client_id)
            .maybeSingle();

          if (cErr) {
            log.warn("[triage-query] client lookup failed, failing closed:", cErr.code);
            return json({ error: "Access check unavailable, try again", retryable: true }, 503);
          }
          if (!c) {
            return json({ error: "Client not found" }, 403);
          }
          if (!c.email || c.email.toLowerCase() !== userEmail) {
            return json({ error: "Not authorized for this client" }, 403);
          }
          if (!c.practitioner_id) {
            return json({ error: "Yves access disabled: no practitioner" }, 403);
          }
          if (c.yves_enabled === false) {
            return json({ error: "Yves access disabled for client" }, 403);
          }
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
          if (p.yves_enabled === false) {
            return json({ error: "Yves access disabled for practice" }, 403);
          }

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

          // Build context server-side so the AI sees the real clinical picture
          const ctx = await buildServerContext(supabaseAdmin, client_id, c.practitioner_id);

          const userMessage = `Patient symptom description:\n"${query_text}"\n\n${formatContextBlock(ctx)}`;

          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-5-20250929",
              max_tokens: 2048,
              system: SYSTEM_PROMPT,
              tools: [TRIAGE_TOOL],
              tool_choice: { type: "tool", name: "triage_result" },
              messages: [{ role: "user", content: userMessage }],
            }),
          });

          if (!response.ok) {
            const errText = await response.text().catch(() => "");
            log.error(
              "[triage-query] Anthropic API error:",
              response.status,
              errText.slice(0, 200),
            );
            return json({ error: "Triage service unavailable", retryable: true }, 502);
          }

          const data = (await response.json()) as {
            content?: Array<{ type: string; input?: unknown }>;
          };
          const toolUse = data.content?.find((item) => item.type === "tool_use");

          if (!toolUse?.input) {
            return json({ error: "No triage result returned", retryable: true }, 502);
          }

          return json(toolUse.input);
        } catch (err) {
          log.error("[triage-query] unhandled error:", err);
          return json({ error: "Internal error", retryable: true }, 500);
        }
      },
    },
  },
});
