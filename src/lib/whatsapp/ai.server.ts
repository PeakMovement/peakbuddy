import type { AiAssist } from "./conversation";
import { ASSIST_INTENTS, PRACTICE_INFO, type AssistRoute } from "./assistant";

/**
 * The two places the WhatsApp agent uses AI, both strictly as a fallback.
 *
 *   readAnswer   - "much better today, just stiff in the mornings" when we
 *                  asked for pain 0 to 10. The deterministic reader always
 *                  goes first; this runs only when it found nothing.
 *   transcribe   - a voice note, turned into text so it goes through exactly
 *                  the same path as a typed message, red flags included.
 *
 * Both are only called for patients with AI consent (yves_ai_consent), and
 * both fail soft: on any error they return null and the conversation carries
 * on as if the AI were not there (re-ask the question, or ask them to type).
 *
 * Nothing here logs content. Errors are reported as status codes only.
 */

const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const TIMEOUT_MS = 12_000;

export type AnswerField = "painScore" | "sleep" | "energy";

const QUESTION: Record<AnswerField, string> = {
  painScore: "How is your pain right now, from 0 (no pain) to 10 (worst pain imaginable)?",
  sleep: "How did you sleep last night, from 1 (very poorly) to 5 (very well)?",
  energy: "How is your energy today, from 1 (very low) to 5 (very high)?",
};

const RANGE: Record<AnswerField, [number, number]> = {
  painScore: [0, 10],
  sleep: [1, 5],
  energy: [1, 5],
};

const ANSWER_TOOL = {
  name: "record_answer",
  description: "Record the number the patient gave, or null if they did not give one.",
  input_schema: {
    type: "object",
    properties: {
      value: {
        type: ["integer", "null"],
        description:
          "The number on the question's scale, or null when the patient did not clearly answer it.",
      },
    },
    required: ["value"],
  },
} as const;

const SYSTEM = `A physiotherapy patient was asked one question on WhatsApp and replied in their own words, in English or Afrikaans.
Decide whether the reply answers the question with a value on the question's scale.
Rules:
- Only record a value the patient actually expressed. Map clear words onto the scale only when the mapping is obvious ("terrible night" for sleep is 1, "slept really well" is 5, "no pain at all" is 0).
- If they did not answer, answered something else, or it is genuinely unclear, record null. A wrong number is worse than asking again.
- You are not giving advice and you are not a safety check.`;

/** Fallback reader for one check-in answer. Null when unsure or unavailable. */
export async function readAnswerWithAi(field: AnswerField, reply: string): Promise<number | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !reply.trim()) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 100,
        system: SYSTEM,
        tools: [ANSWER_TOOL],
        tool_choice: { type: "tool", name: ANSWER_TOOL.name },
        messages: [
          {
            role: "user",
            content: `Question: ${QUESTION[field]}\nPatient's reply: ${reply.slice(0, 1000)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      content?: Array<{ type: string; input?: { value?: unknown } }>;
    };
    const value = json.content?.find((c) => c.type === "tool_use")?.input?.value;
    return validAnswer(field, value);
  } catch {
    return null;
  }
}

/** Exported for tests: the model's output is never trusted unchecked. */
export function validAnswer(field: AnswerField, value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  const [lo, hi] = RANGE[field];
  return value >= lo && value <= hi ? value : null;
}

export function assistFor(field: AnswerField, value: number | null): AiAssist {
  return { [field]: value };
}

/* ------------------------------------------------------------------ */
/* Voice notes                                                         */
/* ------------------------------------------------------------------ */

const TRANSCRIBE_PROMPT =
  "Transcribe this voice note from a physiotherapy patient exactly as spoken, in the language spoken (English or Afrikaans). Return only the transcript text, nothing else. If there is no intelligible speech, return an empty string.";

/**
 * Voice note to text through the Lovable AI gateway (Gemini, which accepts
 * audio). WhatsApp voice notes are OGG/Opus. Two request shapes are tried
 * because the gateway's audio support is not documented: OpenAI-style
 * input_audio first, then a data URL. Null if neither works.
 */
export async function transcribeVoiceNote(
  audio: Uint8Array,
  mimeType: string,
): Promise<string | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key || audio.byteLength === 0 || audio.byteLength > 10 * 1024 * 1024) return null;
  const b64 = toBase64(audio);
  const mime = mimeType.split(";")[0].trim() || "audio/ogg";
  const format = mime.split("/")[1] || "ogg";

  const shapes: unknown[] = [
    { type: "input_audio", input_audio: { data: b64, format } },
    { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
  ];

  for (const part of shapes) {
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: [{ type: "text", text: TRANSCRIBE_PROMPT }, part] }],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = json.choices?.[0]?.message?.content?.trim() ?? "";
      if (text) return text.slice(0, 4000);
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/* ------------------------------------------------------------------ */
/* Routing messages that are not check-in answers                      */
/* ------------------------------------------------------------------ */

const ROUTE_TOOL = {
  name: "route_message",
  description:
    "Classify the patient's message and, for practice questions, answer from the practice information only.",
  input_schema: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        enum: [...ASSIST_INTENTS],
      },
      answer: {
        type: ["string", "null"],
        description:
          "Only for practice_info: a short, friendly answer using ONLY facts in the practice information. Null if the information does not contain the answer.",
      },
    },
    required: ["intent", "answer"],
  },
} as const;

const ROUTE_SYSTEM = `You route WhatsApp messages sent to Buddy, the check-in assistant of a physiotherapy practice. The patient is not answering a check-in question right now.
Pick exactly one intent:
- log_change: they want to record that something has changed (pain, a symptom, how they feel) since their last check-in.
- booking: they want an appointment, check-up, to reschedule or cancel, or ask about availability.
- practice_info: a question about the practice itself: hours, address, parking, fees, medical aid, services, how to contact.
- clinical_question: any question about their condition, symptoms, treatment, exercises' safety, medication, what they should or shouldn't do, whether something is normal.
- progress: they ask how they have been doing according to their check-ins.
- exercises: they want their exercise programme (not advice about it).
- greeting: a greeting, thanks or small talk with nothing else in it ("Hi buddy", "thanks!").
- help: they ask what Buddy can do, how it works, who it is, or for a menu or options.
- other: anything else, including statements about how they feel.
Examples:
"Can I change my symptoms?" -> log_change (they want to update what they logged, not medical advice)
"I want to update my check-in" -> log_change
"Can you tell me what you can do?" -> help
"Hi buddy" -> greeting
"When can I come in for a check-up?" -> booking
"Should I ice my knee?" -> clinical_question
"Is it normal for it to click?" -> clinical_question
"My glute is really tight today" -> other
Only choose clinical_question for a genuine question about their body, symptoms, treatment or what is safe for them to do.
For practice_info, write the answer in 1 to 3 short sentences using ONLY the practice information below. Never invent prices, times, names or policies. If the information does not cover it, answer null.
Write in plain, warm South African English. No dashes.

PRACTICE INFORMATION:
${PRACTICE_INFO}`;

/** AI router. Null on any failure, and the caller falls back to keywords. */
export async function routeWithAi(text: string): Promise<AssistRoute | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !text.trim()) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 300,
        system: ROUTE_SYSTEM,
        tools: [ROUTE_TOOL],
        tool_choice: { type: "tool", name: ROUTE_TOOL.name },
        messages: [{ role: "user", content: text.slice(0, 1500) }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      content?: Array<{ type: string; input?: { intent?: unknown; answer?: unknown } }>;
    };
    return validRoute(json.content?.find((c) => c.type === "tool_use")?.input);
  } catch {
    return null;
  }
}

/** Exported for tests. The model's choice is checked, never trusted blind. */
export function validRoute(
  input: { intent?: unknown; answer?: unknown } | undefined,
): AssistRoute | null {
  const intent = input?.intent;
  if (typeof intent !== "string" || !(ASSIST_INTENTS as readonly string[]).includes(intent))
    return null;
  const answer =
    intent === "practice_info" && typeof input?.answer === "string" && input.answer.trim()
      ? input.answer.trim().slice(0, 600)
      : null;
  return { intent: intent as AssistRoute["intent"], answer };
}
