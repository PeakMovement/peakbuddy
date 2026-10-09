import type { AiAssist } from "./conversation";
import { ASSIST_INTENTS, PRACTICE_INFO, type AssistRoute } from "./assistant";
import {
  CONVERSE_ACTIONS,
  formatHistory,
  validConverse,
  type ConverseResult,
  type ConverseTurn,
} from "./converse";

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
  const intent = input?.intent === "capabilities" ? "help" : input?.intent;
  if (typeof intent !== "string" || !(ASSIST_INTENTS as readonly string[]).includes(intent))
    return null;
  const answer =
    intent === "practice_info" && typeof input?.answer === "string" && input.answer.trim()
      ? input.answer.trim().slice(0, 600)
      : null;
  return { intent: intent as AssistRoute["intent"], answer };
}

/* ------------------------------------------------------------------ */
/* Conversation: anything that fits no fixed path                      */
/* ------------------------------------------------------------------ */

export interface ConverseInput {
  firstName: string;
  message: string;
  history: ConverseTurn[];
  /** The check-in question waiting for an answer, if one is. */
  pendingQuestion: string | null;
  checkedInToday: boolean;
  hasWearable: boolean;
  /** What Buddy knows about them (patient-context.server.ts), or null. */
  context?: string | null;
}

const CONVERSE_TOOL = {
  name: "respond",
  description: "Reply to the patient and choose the one action Buddy should take next.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description:
          "What Buddy says, 1 to 3 short WhatsApp sentences. Empty only for clinical_question or menu.",
      },
      action: { type: "string", enum: [...CONVERSE_ACTIONS] },
      time: {
        type: ["string", "null"],
        description: "Only for set_checkin_time: the time they asked for as HH:MM, 24 hour.",
      },
      remember: {
        type: ["string", "null"],
        description:
          "Only when this message tells you something NEW and lasting about their everyday life worth remembering for later chats (a goal, an upcoming event, their work pattern, a hobby, family, a preference), as one short third-person line, e.g. 'Training for the Two Oceans half marathon in April'. Never health, symptoms, injuries, medication, money, religion, politics, relationships' intimate details or any numbers that identify them. Otherwise null.",
      },
    },
    required: ["reply", "action", "time", "remember"],
  },
} as const;

function converseSystem(input: ConverseInput): string {
  const situation = input.pendingQuestion
    ? `A check-in is in progress. Buddy just asked: "${input.pendingQuestion}". The patient's message did not answer it. After your reply, the system will repeat that question automatically, so do not ask it yourself.`
    : input.checkedInToday
      ? "No check-in is in progress. The patient has already done today's check-in."
      : "No check-in is in progress. The patient has NOT done today's check-in yet; gently steer towards it when it fits (action start_checkin when they seem ready, or mention they can reply CHECK IN).";

  const known = input.context?.trim()
    ? `

WHAT YOU KNOW ABOUT ${input.firstName.toUpperCase()} (from their Buddy record):
${input.context.trim()}

How to use this:
- Use it the way a friendly receptionist who knows them would: their practitioner's first name, their streak, that pain has been lower this week, the race they're training for, their watch run yesterday. Weave in at most one or two details, only when they fit. Never recite the list.
- Facts only. Never explain, interpret or predict anything clinical from it (no "that's because", no "you're healing well", no "that's a good sign"). Saying a number went down is fine; saying what it means is not.
- Never contradict what they say about themselves now; today's message wins over the record.
- Do not mention what the practice recorded they are being seen for unless they bring it up first.`
    : "";

  return `You are Buddy, the WhatsApp assistant of Peak Movement, a physiotherapy practice in Cape Town. You are talking to ${input.firstName}, a patient.

${situation}${known}

Your job: understand what they mean, even if it is vague, misspelt, slang, Afrikaans or off topic. Reply like a warm, sensible person would, in 1 to 3 short sentences. Then bring the conversation back to centre by choosing the ONE action that moves it forward. Be interpretative and conversational, not robotic. Never lecture.

What Buddy can do (the actions):
- none: just reply. Use for chit-chat, thanks, feelings, jokes, or when a reply is all that's needed. Still steer back gently.
- start_checkin: start today's check-in now (pain, sleep, energy, notes).
- log_change: they want to update or correct pain or symptoms since today's check-in.
- booking: they want an appointment, check-up, reschedule or cancel. The system adds the booking links.
- practice_info: a question about the practice. Answer it in your reply using ONLY the practice information below.
- clinical_question: ANY question about their body, symptoms, injury, treatment, exercises' safety, medication, or what is normal or safe. Do not answer it at all. Leave reply empty; the system tells them Justin will answer.
- progress: they want to know how they've been going. The system adds their trend.
- exercises: they want their exercise programme. The system adds the link.
- menu: they are lost or ask what you can do. The system shows the options list; your reply becomes its intro.
- note_for_practitioner: they are telling their physiotherapist something (how they feel, an update, a worry that isn't a question). Acknowledge kindly; the system passes it on.
- connect_wearable: they want to link a smartwatch or ring. The system adds the link.
- set_checkin_time: they want their daily check-in at a different time. Put it in "time" as HH:MM.
- skip_question: during a check-in, they don't want to answer the current sleep or energy question. Never for pain.
- pause_checkin: during a check-in, they want to stop for now and carry on later.

Hard rules:
- Never give medical advice, a diagnosis, reassurance about symptoms, or tell them what to do for their body. That is always clinical_question.
- Never state a price, time, address, policy or name that is not in the practice information. If you don't know, say the practice can help and choose booking or none.
- Never write links or phone numbers yourself; the system adds the right ones.
- Never claim to have done something other than the action you chose. Never promise a callback time.
- If they are upset or frustrated, acknowledge it first, kindly and briefly.
- If they write in Afrikaans or isiXhosa, reply in the same language.
- Plain, warm South African English. No dashes, no emojis unless they used one, no markdown headings.

PRACTICE INFORMATION:
${PRACTICE_INFO}`;
}

/** The conversational fallback. Null on any failure; the caller uses fixed replies. */
export async function converseWithAi(input: ConverseInput): Promise<ConverseResult | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !input.message.trim()) return null;
  const history = formatHistory(input.history);
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
        max_tokens: 400,
        system: converseSystem(input),
        tools: [CONVERSE_TOOL],
        tool_choice: { type: "tool", name: CONVERSE_TOOL.name },
        messages: [
          {
            role: "user",
            content: `${history ? `Recent conversation:\n${history}\n\n` : ""}Patient's new message: ${input.message.slice(0, 1500)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      content?: Array<{
        type: string;
        input?: { reply?: unknown; action?: unknown; time?: unknown; remember?: unknown };
      }>;
    };
    return validConverse(json.content?.find((c) => c.type === "tool_use")?.input);
  } catch {
    return null;
  }
}
