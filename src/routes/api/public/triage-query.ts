import { createFileRoute } from "@tanstack/react-router";
import { log } from "@/lib/log";

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ??
  "https://peakbuddy.lovable.app,https://buddy.peakmovement.co.za,http://localhost:3000,http://localhost:5173"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function corsHeadersFor(origin: string | null): Record<string, string> {
  // Same-origin requests (including the iOS wrapper) send no Origin header and
  // are unaffected by CORS. Cross-origin callers must be on the allow list.
  const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  };
}

// In-memory sliding-window rate limit (per Worker isolate — first layer only;
// infrastructure-level limits belong in Cloudflare WAF rules).
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
  description: "Return a structured clinical triage assessment for the described symptoms.",
  input_schema: {
    type: "object",
    required: [
      "severity", "urgency", "categories", "red_flags",
      "negation_detected", "attribution_detected", "rationale",
      "should_notify_practitioner", "confidence",
    ],
    properties: {
      severity: { type: "integer", minimum: 0, maximum: 10 },
      urgency: { type: "string", enum: ["emergency", "urgent", "soon", "monitor", "routine"] },
      categories: { type: "array", items: { type: "string" } },
      red_flags: { type: "array", items: { type: "string" } },
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

CRITICAL — YOU ARE A CLINICAL REASONER, NOT A KEYWORD MATCHER:

Do not search for specific words. Read the full description and reason about what the patient is experiencing and what it could mean clinically.

REASONING EXAMPLES:
- "My eyes are bleeding" → acute ocular trauma or vascular event → emergency, severity 10
- "I have a headache every morning" → possible intracranial pressure, hypertension, sleep apnoea → urgent, severity 7
- "Sharp pain shooting down my left arm with nausea" → cardiac presentation → emergency, severity 10
- "I have been losing weight without trying and feel exhausted" → red flag for malignancy or systemic disease → urgent, severity 7
- "My foot has gone completely numb" → nerve compression or vascular issue → urgent if sudden, soon if gradual
- "I cannot stop crying and feel hopeless" → mental health crisis → urgent, severity 7
- "My lower back aches after sitting" → postural musculoskeletal → routine, severity 2
- "I feel dizzy every time I stand up" → orthostatic hypotension → soon, severity 5
- "I haven't slept in 4 days" → acute sleep deprivation, psychosis risk → urgent, severity 7
- "I have burning lower back pain that isn't getting better" → persistent pain, possible nerve involvement → soon, severity 5

RULES:
1. Reason about the whole clinical picture — not individual words
2. A single alarming symptom overrides everything else
3. Detect negation — "I don't have chest pain" → negation_detected: true, lower urgency
4. Detect attribution — "my friend has chest pain" → attribution_detected: true
5. When in doubt choose the higher urgency tier — a missed emergency is always worse
6. Use patient context provided — rising pain trend increases urgency
7. Always complete the triage_result tool call
8. Rationale must be 2-3 plain English sentences explaining reasoning to a non-medical reader
9. Never return severity 0 for any complaint the patient finds significant enough to report

SEVERITY: 0-2 routine, 3-4 monitor, 5-6 soon, 7-8 urgent, 9-10 emergency
URGENCY: emergency=call 112 now, urgent=same day, soon=24-48h, monitor=watch and wait, routine=next appointment

When in doubt err toward higher urgency. False positive always safer than false negative.`;

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

          // ── Authentication: require a valid Supabase session ──────────────
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

          // ── Input validation ───────────────────────────────────────────────
          const body = (await request.json().catch(() => null)) as {
            query_text?: unknown;
            client_context?: Record<string, unknown>;
            client_id?: unknown;
          } | null;
          const query_text = body?.query_text;
          const client_context = body?.client_context;
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

          // ── Rate limit (per client) ────────────────────────────────────────
          if (isRateLimited(client_id)) {
            return json({ error: "Too many requests, slow down", retryable: true }, 429);
          }

          // ── Access gate: ownership + Yves enablement. Fails closed. ───────
          const { data: c, error: cErr } = await supabaseAdmin
            .from("clients")
            .select("practitioner_id, yves_enabled, email")
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
            // The authenticated user may only triage as their own client record.
            return json({ error: "Not authorized for this client" }, 403);
          }
          if (!c.practitioner_id) {
            return json({ error: "Yves access disabled: no practitioner" }, 403);
          }
          if (c.yves_enabled === false) {
            return json({ error: "Yves access disabled for client" }, 403);
          }

          const { data: p, error: pErr } = await supabaseAdmin
            .from("practices")
            .select("yves_enabled")
            .eq("practitioner_id", c.practitioner_id)
            .maybeSingle();
          if (pErr) {
            log.warn("[triage-query] practice lookup failed, failing closed:", pErr.code);
            return json({ error: "Access check unavailable, try again", retryable: true }, 503);
          }
          if (p && p.yves_enabled === false) {
            return json({ error: "Yves access disabled for practice" }, 403);
          }

          // ── Build prompt and call the model ────────────────────────────────
          let userMessage = `Patient symptom description:\n"${query_text}"`;
          if (client_context) {
            const ctx = client_context as Record<string, unknown>;
            userMessage += `\n\nPatient history:
- Average pain (last 3 check-ins): ${ctx.avgPainLast3 ?? "unknown"}/10
- Pain trend: ${ctx.painTrend ?? "unknown"}
- Flagged check-ins last 7 days: ${ctx.flaggedCountLast7d ?? 0}
- Recent worsening: ${ctx.worseChangeRecent ? "yes" : "no"}
- Total check-ins: ${ctx.checkInCount ?? 0}`;
          }

          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514",
              max_tokens: 1024,
              system: SYSTEM_PROMPT,
              tools: [TRIAGE_TOOL],
              tool_choice: { type: "tool", name: "triage_result" },
              messages: [{ role: "user", content: userMessage }],
            }),
          });

          if (!response.ok) {
            log.error("[triage-query] Anthropic API error:", response.status);
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
          // Never leak internals to the caller; log server-side only.
          log.error("[triage-query] unhandled error:", err);
          return json({ error: "Internal error", retryable: true }, 500);
        }
      },
    },
  },
});
