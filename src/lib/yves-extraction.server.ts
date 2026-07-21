// Structured extraction + tentative triage for Yves. Runs as a cheap
// first-pass Anthropic Haiku call so the reasoning model gets a normalized
// symptom record (body region, onset, negations, attributions, associated
// symptoms) alongside the raw text. Handles "not chest pain, just tight"
// and "from yesterday's gym" reliably at the source.

const HAIKU_MODEL = "claude-3-5-haiku-20241022";

export interface Extraction {
  body_region: string | null;
  laterality: "left" | "right" | "bilateral" | "central" | "unknown";
  onset: "sudden" | "gradual" | "unknown";
  duration_hours: number | null;
  character: string | null;
  associated_symptoms: string[];
  negations: string[];
  attributions: string[]; // people the complaint is attributed to ("my brother")
  language: "en" | "af" | "mixed" | "other";
  self_reported: boolean;
  needs_clarification: string[];
}

export interface FirstPassTriage {
  urgency: "emergency" | "urgent" | "soon" | "monitor" | "routine";
  severity: number;
  red_flag_category:
    | "cardiac"
    | "neuro"
    | "cauda_equina"
    | "systemic"
    | "mental_health"
    | "infection"
    | "msk_alarm"
    | "respiratory"
    | "general"
    | null;
  confidence: number;
  short_rationale: string;
}

export interface ExtractionAndFirstPass {
  extraction: Extraction;
  triage: FirstPassTriage;
}

const EXTRACT_TOOL = {
  name: "extract_and_triage",
  description:
    "Return a normalized symptom extraction plus a tentative triage. The reasoning model will review this.",
  input_schema: {
    type: "object",
    required: ["extraction", "triage"],
    properties: {
      extraction: {
        type: "object",
        required: [
          "body_region",
          "laterality",
          "onset",
          "duration_hours",
          "character",
          "associated_symptoms",
          "negations",
          "attributions",
          "language",
          "self_reported",
          "needs_clarification",
        ],
        properties: {
          body_region: { type: ["string", "null"] },
          laterality: {
            type: "string",
            enum: ["left", "right", "bilateral", "central", "unknown"],
          },
          onset: { type: "string", enum: ["sudden", "gradual", "unknown"] },
          duration_hours: { type: ["number", "null"] },
          character: { type: ["string", "null"] },
          associated_symptoms: { type: "array", items: { type: "string" } },
          negations: { type: "array", items: { type: "string" } },
          attributions: { type: "array", items: { type: "string" } },
          language: { type: "string", enum: ["en", "af", "mixed", "other"] },
          self_reported: { type: "boolean" },
          needs_clarification: { type: "array", items: { type: "string" } },
        },
      },
      triage: {
        type: "object",
        required: ["urgency", "severity", "red_flag_category", "confidence", "short_rationale"],
        properties: {
          urgency: {
            type: "string",
            enum: ["emergency", "urgent", "soon", "monitor", "routine"],
          },
          severity: { type: "integer", minimum: 0, maximum: 10 },
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
          confidence: { type: "number", minimum: 0, maximum: 1 },
          short_rationale: { type: "string" },
        },
      },
    },
  },
};

const EXTRACT_SYSTEM = `You are the extraction stage of Yves, a clinical triage assistant.

Your job is two things, in one tool call:
1. EXTRACT normalized structured fields from the patient's message. Do NOT invent facts — set unknown/null when the message doesn't say.
2. Provide a TENTATIVE triage (urgency + severity + red-flag category + confidence). A stronger reasoning model will review and may override.

Rules for extraction:
- negations: list any symptom the patient explicitly says they do NOT have ("not chest pain", "no fever").
- attributions: list any people the complaint is about that are NOT the patient ("my brother", "my mom"). If the message is about someone else, set self_reported=false.
- language: "en" English, "af" Afrikaans, "mixed" both, "other" anything else. Treat Afrikaans red-flag terms identically to English.

Rules for tentative triage:
- When in doubt, err higher. False positive is safer than false negative.
- Never return severity 0 for something the patient found worth reporting.
- confidence is your calibrated certainty in the urgency, 0-1.

Always call the extract_and_triage tool.`;

export async function extractAndFirstPass(params: {
  apiKey: string;
  queryText: string;
  contextBlock: string;
  timeoutMs?: number;
}): Promise<{ ok: true; data: ExtractionAndFirstPass; latencyMs: number } | { ok: false; error: string; latencyMs: number }> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 12_000);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": params.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 1024,
        system: EXTRACT_SYSTEM,
        tools: [EXTRACT_TOOL],
        tool_choice: { type: "tool", name: "extract_and_triage" },
        messages: [
          {
            role: "user",
            content: `Patient message:\n"${params.queryText}"\n\n${params.contextBlock}`,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { ok: false, error: `haiku ${res.status}: ${errText.slice(0, 160)}`, latencyMs: Date.now() - started };
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; input?: unknown }>;
    };
    const toolUse = data.content?.find((item) => item.type === "tool_use");
    if (!toolUse?.input || typeof toolUse.input !== "object") {
      return { ok: false, error: "no tool_use in haiku response", latencyMs: Date.now() - started };
    }
    return { ok: true, data: toolUse.input as ExtractionAndFirstPass, latencyMs: Date.now() - started };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function formatExtractionForPrompt(x: Extraction): string {
  const lines = ["═══ EXTRACTED SIGNAL (first-pass) ═══"];
  lines.push(`Body region: ${x.body_region ?? "unknown"}  |  Laterality: ${x.laterality}`);
  lines.push(`Onset: ${x.onset}  |  Duration (hrs): ${x.duration_hours ?? "unknown"}`);
  if (x.character) lines.push(`Character: ${x.character}`);
  if (x.associated_symptoms.length) lines.push(`Associated: ${x.associated_symptoms.join(", ")}`);
  if (x.negations.length) lines.push(`Negated: ${x.negations.join(", ")}`);
  if (x.attributions.length) lines.push(`Attributed to (not patient): ${x.attributions.join(", ")}`);
  lines.push(`Self-reported: ${x.self_reported}  |  Language: ${x.language}`);
  if (x.needs_clarification.length) lines.push(`Ambiguous: ${x.needs_clarification.join("; ")}`);
  return lines.join("\n");
}
