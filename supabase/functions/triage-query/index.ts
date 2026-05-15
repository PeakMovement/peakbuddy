import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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

REASONING EXAMPLES — apply this same depth to every query:

"My eyes are bleeding"
→ Acute ocular trauma or severe vascular event. This is a medical emergency regardless of cause.
→ urgency: emergency, severity: 10

"I have a headache every morning when I wake up"
→ Morning headaches can indicate elevated intracranial pressure, hypertension, sleep apnoea, or medication overuse. Requires investigation.
→ urgency: urgent, severity: 7

"Sharp pain shooting down my left arm with nausea"
→ Classic cardiac presentation. Treat as cardiac emergency until proven otherwise.
→ urgency: emergency, severity: 10

"I have been losing weight without trying and feel exhausted"
→ Unexplained weight loss with fatigue is a red flag for malignancy, thyroid disease, diabetes, or systemic illness.
→ urgency: urgent, severity: 7

"My foot has gone completely numb"
→ Could indicate nerve compression, vascular compromise, or neurological event. Context determines urgency.
→ urgency: urgent if sudden onset, soon if gradual

"I cannot stop crying and feel hopeless"
→ Mental health crisis. Does not require physical symptoms to be clinically serious.
→ urgency: urgent, severity: 7

"My lower back aches after sitting for a long time"
→ Common postural musculoskeletal complaint. Low risk unless red flags present.
→ urgency: routine, severity: 2

"I feel dizzy every time I stand up"
→ Orthostatic hypotension, dehydration, or cardiac rhythm issue. Needs investigation.
→ urgency: soon, severity: 5

"I haven't slept in 4 days"
→ Acute sleep deprivation at this level is medically dangerous — psychosis risk, immune suppression, cardiovascular stress.
→ urgency: urgent, severity: 7

RULES YOU MUST FOLLOW:

1. Reason about the whole clinical picture — combine all symptoms the patient mentions
2. A single alarming symptom overrides everything else
3. Detect negation — "I don't have chest pain" means they are ruling it out. Set negation_detected: true and lower urgency accordingly
4. Detect attribution — "my friend has chest pain" means it is not their symptom. Set attribution_detected: true
5. When in doubt, choose the higher urgency tier. A missed emergency is always worse than an unnecessary contact
6. Use the patient context provided — rising pain trend and multiple recent flags increase urgency
7. Always complete the triage_result tool call — never return free text only
8. Your rationale must be 2-3 plain-English sentences explaining your reasoning to a non-medical reader
9. red_flags must list the specific aspects of the description that concerned you
10. categories must use clinical terms: cardiac, neurological, musculoskeletal, respiratory, spinal_emergency, mental_health, gastrointestinal, vascular, oncological, infectious, endocrine, ophthalmological, trauma, other

SEVERITY SCALE:
0-2: routine concern
3-4: monitor
5-6: soon
7-8: urgent  
9-10: emergency

Never return severity 0 for a complaint that has any clinical significance. A patient describing any symptom that is bothering them enough to report it should score at least 2.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { query_text, client_context } = body;

    if (!query_text || typeof query_text !== "string") {
      return new Response(
        JSON.stringify({ error: "query_text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let userMessage = `Patient symptom description:\n"${query_text}"`;

    if (client_context) {
      userMessage += `\n\nPatient history context:
- Average pain score (last 3 check-ins): ${client_context.avgPainLast3 ?? "unknown"}/10
- Pain trend: ${client_context.painTrend ?? "unknown"}
- Flagged check-ins in last 7 days: ${client_context.flaggedCountLast7d ?? 0}
- Patient reported worsening recently: ${client_context.worseChangeRecent ? "yes" : "no"}
- Total check-ins on record: ${client_context.checkInCount ?? 0}

Use this context to inform urgency — a patient with rising pain and recent flags warrants higher concern than a stable patient describing the same symptom.`;
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
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const toolUse = data.content?.find((c: { type: string }) => c.type === "tool_use");

    if (!toolUse?.input) {
      return new Response(
        JSON.stringify({ error: "No triage result returned from model" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify(toolUse.input),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
