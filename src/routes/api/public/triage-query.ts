import { createFileRoute } from "@tanstack/react-router";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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
      OPTIONS: async () => new Response(null, { status: 200, headers: corsHeaders }),
      POST: async ({ request }) => {
        try {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (!apiKey) {
            return new Response(
              JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          const body = await request.json().catch(() => null) as
            | { query_text?: unknown; client_context?: Record<string, unknown>; client_id?: unknown }
            | null;
          const query_text = body?.query_text;
          const client_context = body?.client_context;
          const client_id = typeof body?.client_id === "string" ? body.client_id : null;

          if (!query_text || typeof query_text !== "string") {
            return new Response(
              JSON.stringify({ error: "query_text is required" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          // Yves access gate — verify client has access before calling the model.
          // Fail-open on lookup errors so transient infra issues don't degrade Yves to keyword fallback.
          if (client_id) {
            try {
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
              const { data: c, error: cErr } = await supabaseAdmin
                .from("clients")
                .select("practitioner_id, yves_enabled")
                .eq("id", client_id)
                .maybeSingle();

              if (cErr) {
                console.warn("[triage-query] client lookup failed, failing open:", cErr);
              } else if (!c) {
                console.warn("[triage-query] no client row for id", client_id);
                return new Response(
                  JSON.stringify({ error: "Client not found" }),
                  { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
                );
              } else if (!c.practitioner_id) {
                console.warn("[triage-query] client has no practitioner", client_id);
                return new Response(
                  JSON.stringify({ error: "Yves access disabled: no practitioner" }),
                  { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
                );
              } else if (c.yves_enabled === false) {
                return new Response(
                  JSON.stringify({ error: "Yves access disabled for client" }),
                  { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
                );
              } else {
                const { data: p, error: pErr } = await supabaseAdmin
                  .from("practices")
                  .select("yves_enabled")
                  .eq("practitioner_id", c.practitioner_id)
                  .maybeSingle();
                if (pErr) {
                  console.warn("[triage-query] practice lookup failed, failing open:", pErr);
                } else if (p && p.yves_enabled === false) {
                  return new Response(
                    JSON.stringify({ error: "Yves access disabled for practice" }),
                    { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
                  );
                }
              }
            } catch (err) {
              console.warn("[triage-query] access check threw, failing open:", err);
            }
          }


          let userMessage = `Patient symptom description:\n"${query_text}"`;
          if (client_context) {
            const c = client_context as Record<string, unknown>;
            userMessage += `\n\nPatient history:
- Average pain (last 3 check-ins): ${c.avgPainLast3 ?? "unknown"}/10
- Pain trend: ${c.painTrend ?? "unknown"}
- Flagged check-ins last 7 days: ${c.flaggedCountLast7d ?? 0}
- Recent worsening: ${c.worseChangeRecent ? "yes" : "no"}
- Total check-ins: ${c.checkInCount ?? 0}`;
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
            const errText = await response.text();
            return new Response(
              JSON.stringify({ error: "Anthropic API error", detail: errText }),
              { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          const data = await response.json() as { content?: Array<{ type: string; input?: unknown }> };
          const toolUse = data.content?.find((c) => c.type === "tool_use");

          if (!toolUse?.input) {
            return new Response(
              JSON.stringify({ error: "No triage result returned" }),
              { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          return new Response(
            JSON.stringify(toolUse.input),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        } catch (err) {
          return new Response(
            JSON.stringify({ error: String(err) }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
