/**
 * Practitioner agent, the part that does not touch the database (11 Oct 2026).
 *
 * Buddy's phrase matcher stays the fast path for the commands it already
 * gets right. This module is what runs when a practitioner writes the way
 * they actually write: several people, a wording of their own, "all 4",
 * "the first one", "and Steven too".
 *
 * The model only chooses a tool. Names, statuses and messages in the reply
 * come from tool results. Nothing here sends a WhatsApp.
 */
import { rankPatients } from "./practitioner-understand";
import type { PracCandidate, PracMemory, PracPending, PracTurn } from "./practitioner-understand";
import { practitionerCheckinText, practitionerConfirmSend } from "./voice";

export const AGENT_TOOLS = [
  "list_practitioners",
  "client_status",
  "read_messages",
  "send_checkin",
  "programme_sent",
  "ask_reception",
  "schedule_updates",
  "practice_overview",
  "red_flags",
  "quiet_clients",
  "usage",
  "heidi_read",
  "clarify",
] as const;

export type AgentTool = (typeof AGENT_TOOLS)[number];

export interface AgentDecision {
  tool: AgentTool;
  /** Names as the practitioner said them. `["all"]` means everyone in scope. */
  names: string[];
  note: string | null;
  task: string | null;
  question: string | null;
  frequency: "daily" | "weekdays" | "weekly" | "off" | "menu" | null;
  weekday: number | null;
  time: string | null;
}

export interface AgentTurnInput {
  practitionerName: string;
  practiceName: string;
  message: string;
  history: PracTurn[];
  pending: string | null;
  heidiEnabled: boolean;
  canSeeAllPractitioners: boolean;
}

export interface ScopedClient {
  id: string;
  full_name: string | null;
}

export type NameHit =
  | { query: string; status: "one"; client: ScopedClient }
  | { query: string; status: "many"; clients: ScopedClient[] }
  | { query: string; status: "none" }
  | { query: string; status: "all"; clients: ScopedClient[] };

const TOOL_SET = new Set<string>(AGENT_TOOLS);

/** Phrases the matcher has no answer for, so the agent should try first. */
const LIST_PRACTITIONERS =
  /\b(?:practitioners?|physios?|physiotherapists?|clinicians?|therapists?)\b[\s\S]{0,50}\b(?:list|listed|have|names|who)\b|\b(?:list|who(?:'s| are| is)?|show(?: me)?|tell me|what are)\b[\s\S]{0,40}\b(?:practitioners?|physios?|physiotherapists?|the team|your team|our team)\b/i;

const CUSTOM_NOTE =
  /\b(?:make sure (?:to|you)|say (?:you(?:'re| are)|that|it's|it is)|tell them|let them know|mention|include that|add that|and say)\b/i;

const RECEPTION_WORD = /\b(?:reception(?:ist)?s?|front\s+desk|secretar(?:y|ies)|mishqah)\b/i;

const ASKING =
  /\b(?:how|status|message|contact|check|ask|tell|send|programme|program|list|who|what|show|read|update|quiet|flag|usage|heidi|doing|going|ping|nudge)\b/i;

/** Two or more people in one sentence ("Cayla, Michaela, Steven and Vicki"). */
export function looksLikeSeveralPeople(text: string): boolean {
  const parts = String(text ?? "")
    .split(/\s*(?:,|&|\band\b)\s*/i)
    .map((p) => p.trim())
    .filter((p) => /[A-Za-z]{3,}/.test(p));
  return parts.length >= 2;
}

/**
 * True when the matcher should step aside. Clear one-person commands,
 * button taps and reception errands stay on the fast path.
 */
export function needsPractitionerAgent(text: string, memory?: PracMemory | null): boolean {
  if (memory?.pending) return true;
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (LIST_PRACTITIONERS.test(t)) return true;
  if (RECEPTION_WORD.test(t) && !CUSTOM_NOTE.test(t)) return false;
  if (CUSTOM_NOTE.test(t) && ASKING.test(t)) return true;
  // Two or more people in one sentence, including "I've sent Cayla and Steven
  // their programmes", which the one-name matcher would turn into "which one?".
  if (looksLikeSeveralPeople(t)) return true;
  return false;
}

export function agentButtons(): Array<{ id: string; title: string }> {
  return [
    { id: "prac_ag_yes", title: "Yes" },
    { id: "prac_ag_edit", title: "Edit" },
    { id: "prac_ag_no", title: "Cancel" },
  ];
}

export function isAgentButton(replyId: string | null | undefined): boolean {
  return replyId === "prac_ag_yes" || replyId === "prac_ag_edit" || replyId === "prac_ag_no";
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function asNames(value: unknown): string[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\s*(?:,|&|\band\b)\s*/i)
      : [];
  const names = list
    .map((n) => clip(String(n ?? ""), 60))
    .filter((n) => n.length >= 2 && n.length <= 60);
  return names.slice(0, 12);
}

const FREQUENCIES = new Set(["daily", "weekdays", "weekly", "off", "menu"]);

/** The model's tool call, or null when it is not one of ours. */
export function validDecision(raw: unknown): AgentDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const tool = String(row.tool ?? row.name ?? "");
  if (!TOOL_SET.has(tool)) return null;
  const frequency = FREQUENCIES.has(String(row.frequency))
    ? (String(row.frequency) as AgentDecision["frequency"])
    : null;
  const weekday =
    typeof row.weekday === "number" && row.weekday >= 1 && row.weekday <= 7 ? row.weekday : null;
  const time =
    typeof row.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(row.time) ? row.time : null;
  const note = typeof row.note === "string" ? clip(row.note, 280) : null;
  const task = typeof row.task === "string" ? clip(row.task, 600) : null;
  const question = typeof row.question === "string" ? clip(row.question, 300) : null;
  if (
    tool === "clarify" &&
    (!question || /\b(i've|i have)\s+(sent|messaged|asked|told)\b/i.test(question))
  )
    return null;
  return {
    tool: tool as AgentTool,
    names: asNames(row.names),
    note: note || null,
    task: task || null,
    question: question || null,
    frequency,
    weekday,
    time,
  };
}

/** OpenAI-style tool list. Heidi is left out until its secrets are set. */
export function practitionerToolSchemas(heidiEnabled: boolean): unknown[] {
  const strArray = { type: "array", items: { type: "string" } };
  const tools: Array<{
    name: string;
    description: string;
    properties: Record<string, unknown>;
    required: string[];
  }> = [
    {
      name: "list_practitioners",
      description:
        "List the practitioners on this practice. Owners and admins see everyone. Anyone else sees only themselves.",
      properties: {},
      required: [],
    },
    {
      name: "client_status",
      description:
        'How one client, several named clients, or all clients in scope are doing. Use names exactly as spoken, or ["all"].',
      properties: { names: strArray },
      required: ["names"],
    },
    {
      name: "read_messages",
      description:
        'Read open messages and alerts for one client, several, or all. names as spoken, or ["all"].',
      properties: { names: strArray },
      required: ["names"],
    },
    {
      name: "send_checkin",
      description:
        "Check in with one or more clients. Does not send. A confirmation is shown first. Put any wording the practitioner wants included in note.",
      properties: { names: strArray, note: { type: "string" } },
      required: ["names"],
    },
    {
      name: "programme_sent",
      description:
        "The practitioner has sent these clients their exercise programme. Confirmation first. Does not send yet.",
      properties: { names: strArray },
      required: ["names"],
    },
    {
      name: "ask_reception",
      description: "Pass an errand to reception. Confirmation first. Put the errand in task.",
      properties: { task: { type: "string" } },
      required: ["task"],
    },
    {
      name: "schedule_updates",
      description:
        "Set or stop the practitioner's scheduled client updates. frequency is daily, weekdays, weekly, off, or menu. time is HH:MM. weekday is 1 (Monday) to 7.",
      properties: {
        frequency: { type: "string" },
        weekday: { type: "integer" },
        time: { type: "string" },
      },
      required: ["frequency"],
    },
    {
      name: "practice_overview",
      description:
        "A short overview of red flags, usage and quiet clients, scoped to this practitioner.",
      properties: {},
      required: [],
    },
    {
      name: "red_flags",
      description: "Open red flags in scope.",
      properties: {},
      required: [],
    },
    {
      name: "quiet_clients",
      description: "Clients who have gone quiet.",
      properties: {},
      required: [],
    },
    {
      name: "usage",
      description: "How many clients are using Buddy.",
      properties: {},
      required: [],
    },
    {
      name: "clarify",
      description:
        "Ask one short question when the request is unclear. Do not state any client fact.",
      properties: { question: { type: "string" } },
      required: ["question"],
    },
  ];
  if (heidiEnabled) {
    tools.push({
      name: "heidi_read",
      description: "Read a client's Heidi notes. names must include a first and last name.",
      properties: { names: strArray },
      required: ["names"],
    });
  }
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: { type: "object", properties: t.properties, required: t.required },
    },
  }));
}

export function pendingSummary(pending: PracPending | null | undefined): string | null {
  if (!pending) return null;
  if (pending.kind === "choose") {
    const lines = pending.candidates.map((c) => `${c.n}. ${c.name}`);
    const already = pending.resolvedIds.length
      ? ` Already included: ${pending.resolvedIds.length}.`
      : "";
    return `Waiting for them to pick from a numbered list for ${pending.action}.${already}\n${lines.join("\n")}`;
  }
  const who = pending.names.join(", ") || `${pending.clientIds.length} clients`;
  if (pending.editing)
    return `They are editing the ${pending.action} message to ${who}. The next line is the new wording.`;
  return `Waiting for Yes, Edit or Cancel before ${pending.action} to ${who}. Preview: ${pending.preview}`;
}

export function buildPractitionerPrompt(input: AgentTurnInput): {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const history = input.history
    .slice(-6)
    .filter(
      (t, i, all) =>
        !(i === all.length - 1 && t.role === "practitioner" && t.text === input.message),
    );
  const messages = [
    ...history.map((t) => ({
      role: (t.role === "buddy" ? "assistant" : "user") as "user" | "assistant",
      content: t.text,
    })),
    { role: "user" as const, content: input.message.slice(0, 1500) },
  ];
  const system = `You are Buddy, the WhatsApp assistant at ${input.practiceName}, talking to ${input.practitionerName}, a practitioner.
Choose exactly one tool. You do not know any clients, statuses, messages or practitioners. Never invent them. Never claim you have sent anything.
Names go in the tool exactly as spoken. Several people are one tool call with every name. "all", "everyone" or "my clients" is names: ["all"].
A wording they want included ("say you're with ${input.practiceName}", "mention the race") goes in note, in their words.
Follow-ups ("all 4", "yes", "the first one", "1 and 3", "and Steven too") refer to the pending state. Keep the same tool and update the names.
If you are unsure, call clarify with one short question. No client facts in that question.
Scheduled updates use schedule_updates. Reception errands use ask_reception.
${input.canSeeAllPractitioners ? "This person is an owner or admin and can see the whole practice." : "This person sees only their own clients, and only themselves in the practitioner list."}
${input.heidiEnabled ? "Heidi is connected. heidi_read needs a first and last name." : "Heidi is not connected. Do not call heidi_read."}
${input.pending ? `\nPENDING:\n${input.pending}` : ""}
Write nothing except the tool call.`;
  return { system, messages };
}

/**
 * A note that only repeats "it's Buddy from <practice>" adds nothing.
 * Anything else is kept, with the leading "say" / "make sure to say" removed.
 */
export function extraCheckinNote(
  note: string | null | undefined,
  practiceName: string,
): string | null {
  const t = String(note ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  const practice = practiceName.trim() || "Peak Movement";
  const n = t.toLowerCase();
  const aboutPractice =
    n.includes(practice.toLowerCase()) ||
    n.includes("peak movement") ||
    /\b(with us|from us|with buddy|from buddy)\b/.test(n);
  const onlyIntro =
    /^(?:please\s+)?(?:make sure (?:to|you)\s+)?(?:say|mention|tell them|let them know|include)\s+(?:that\s+)?(?:you(?:'re| are)|it(?:'s| is)|buddy is|we are)\b/.test(
      n,
    ) && aboutPractice;
  if (onlyIntro || n.includes("checking in on how")) return null;
  const stripped = t
    .replace(
      /^(?:please\s+)?(?:make sure (?:to|you)\s+)?(?:say|mention|tell them|let them know|include)\s+(?:that\s+)?/i,
      "",
    )
    .trim();
  const use = stripped || t;
  const clipped = use.length > 240 ? `${use.slice(0, 237).trimEnd()}...` : use;
  return clipped.charAt(0).toUpperCase() + clipped.slice(1);
}

export function checkinPreview(practiceName: string, note: string | null): string {
  return practitionerCheckinText("<name>", practiceName, extraCheckinNote(note, practiceName));
}

export function checkinBody(firstName: string, practiceName: string, note: string | null): string {
  return practitionerCheckinText(firstName, practiceName, extraCheckinNote(note, practiceName));
}

/** "Cayla Rosenblatt, Michaela Geldhof, Steven and Vicki-Leigh Atkinson" */
export function joinNames(names: string[]): string {
  const list = names.map((n) => n.trim()).filter(Boolean);
  if (list.length <= 1) return list[0] ?? "them";
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export function confirmOutbound(names: string[], preview: string): string {
  return practitionerConfirmSend(joinNames(names), preview);
}

const WORD_NUM: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const ORDINALS: Record<string, number> = {
  first: 1,
  "1st": 1,
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  fourth: 4,
  "4th": 4,
  fifth: 5,
  "5th": 5,
  sixth: 6,
  "6th": 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  last: -1,
};

function spokenNumber(word: string): number | null {
  if (/^\d+$/.test(word)) return Number(word);
  return WORD_NUM[word] ?? null;
}

/**
 * A reply to a numbered list: "all", "all 4", "1 and 3", "the first one",
 * or one of the names. Null when it isn't a choice.
 */
export function resolveChoice(text: string, candidates: PracCandidate[]): string[] | null {
  const n = text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!n || !candidates.length) return null;
  if (
    /^(all|everyone|everybody|all of them|every one|the lot|both)(?:\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten))?$/.test(
      n,
    )
  ) {
    const countWord = n.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
    if (countWord) {
      const count = spokenNumber(countWord[1]);
      if (count != null && count !== candidates.length) return null;
    }
    return candidates.map((c) => c.id);
  }
  const range = n.match(
    /^(?:the\s+)?(first|last)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)$/,
  );
  if (range) {
    const count = spokenNumber(range[2]);
    if (!count || count > candidates.length) return null;
    const slice = range[1] === "first" ? candidates.slice(0, count) : candidates.slice(-count);
    return slice.map((c) => c.id);
  }
  const ordinals = [
    ...n.matchAll(
      /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|1st|2nd|3rd|4th|5th|6th|last)\b/g,
    ),
  ];
  if (
    ordinals.length &&
    /^(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|last|1st|2nd|3rd|4th|5th)(?:\s+one|\s+ones)?(?:\s+(?:and|,)\s+.*)?$/.test(
      n,
    )
  ) {
    const ids = ordinals.map((m) => {
      const o = ORDINALS[m[1]];
      if (o === -1) return candidates[candidates.length - 1]?.id;
      return candidates[o - 1]?.id;
    });
    if (ids.every(Boolean)) return ids as string[];
  }
  if (/^\d+(?:\s*(?:and|,)\s*\d+)*$/.test(n)) {
    const nums = n.split(/\s*(?:and|,)\s*/).map(Number);
    if (nums.every((x) => candidates.some((c) => c.n === x)))
      return nums.map((x) => candidates.find((c) => c.n === x)!.id);
    return null;
  }
  const wanted = n
    .split(/\s*(?:,|and)\s*/)
    .map((p) => p.replace(/^(?:the|number|no)\s+/, "").trim())
    .filter((p) => p.length >= 2 && !/^(one|ones|please|thanks|too)$/.test(p));
  if (!wanted.length) return null;
  const ids: string[] = [];
  for (const part of wanted) {
    const hit = resolveNames(
      [part],
      candidates.map((c) => ({ id: c.id, full_name: c.name })),
    )[0];
    if (!hit || hit.status !== "one") return null;
    ids.push(hit.client.id);
  }
  return [...new Set(ids)];
}

/** "and Steven too", "Steven as well", "also Vicki". Not a whole new instruction. */
export function addedNames(text: string): string[] | null {
  const n = text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!n || n.length > 80) return null;
  if (/\b(don't|do not|not|cancel|instead|except|without|stop)\b/.test(n)) return null;
  const m = n.match(
    /^(?:and|also|plus|add|include)?\s*(?:can you\s+)?(?:message|ask|include|add|contact)?\s*([a-z][a-z'-]{1,}(?:\s+(?!too\b|also\b|well\b|as\b|please\b)[a-z][a-z'-]{2,})?(?:\s+and\s+[a-z][a-z'-]{1,}(?:\s+(?!too\b|also\b|well\b)[a-z][a-z'-]{2,})?)?)\s*(?:too|as well|also)?$/,
  );
  if (!m) return null;
  const names = m[1]
    .split(/\s+and\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && !/^(please|thanks|too|well|also|them|her|him)$/.test(s));
  return names.length ? names : null;
}

/**
 * "vicki" has to find "Vicki-Leigh Atkinson". rankPatients wants the whole
 * first name, so a hyphenated name also matches on the part before the hyphen.
 */
function spokenNameHits(query: string, clients: ScopedClient[]): ScopedClient[] {
  const ranked = rankPatients(query, clients);
  if (ranked.length) return ranked.map((h) => h.patient);
  const tokens = query
    .toLowerCase()
    .split(/[^a-z'-]+/)
    .filter((w) => w.length >= 3);
  if (!tokens.length) return [];
  return clients.filter((c) => {
    const parts = String(c.full_name ?? "")
      .toLowerCase()
      .split(/[^a-z'-]+/)
      .filter((w) => w.length >= 2);
    if (!parts.length) return false;
    const first = parts[0];
    const stem = first.split("-")[0];
    const last = parts.length > 1 ? parts[parts.length - 1] : "";
    return tokens.some((t) => t === first || t === stem || t === last);
  });
}

export function resolveNames(queries: string[], clients: ScopedClient[]): NameHit[] {
  if (queries.length === 1 && queries[0].toLowerCase() === "all") {
    return [{ query: "all", status: "all", clients }];
  }
  return queries.map((query) => {
    const hits = spokenNameHits(query, clients);
    if (!hits.length) return { query, status: "none" as const };
    if (hits.length === 1) return { query, status: "one" as const, client: hits[0] };
    return { query, status: "many" as const, clients: hits.slice(0, 10) };
  });
}

export function choiceBody(intro: string, candidates: PracCandidate[]): string {
  const lines = candidates.map((c) => `${c.n}. ${c.name}`);
  return `${intro}\n${lines.join("\n")}\nReply with a number, a name, or "all".`;
}

export function formatPractitionerList(
  practice: string,
  people: Array<{ name: string; you: boolean }>,
): string {
  if (!people.length) return `I don't have any practitioners listed for ${practice} yet.`;
  if (people.length === 1 && people[0].you) {
    const first = people[0].name.split(/\s+/)[0] || "there";
    return `You're the only practitioner I can show you, ${first}. Owners and admins can see the whole list.`;
  }
  const lines = people.map((p) => `• ${p.name}${p.you ? " (you)" : ""}`);
  return `Here are the practitioners at ${practice}:\n${lines.join("\n")}`;
}

const REACH_LINE: Record<string, (name: string) => string> = {
  whatsapp: (name) => `${name}: messaged on WhatsApp.`,
  template: (name) =>
    `${name}: outside the 24 hour window, so I sent the check-in template. The personal wording isn't in that template.`,
  push: (name) => `${name}: not on WhatsApp with me, so I sent a notification in the Buddy app.`,
  busy: (name) => `${name}: already in a check-in with me, so I've left them to finish.`,
  queued: (name) =>
    `${name}: hasn't messaged in the last day, so I've saved it and they'll get it when they next write in.`,
  unreachable: (name) =>
    `${name}: hasn't messaged in over a day and isn't on the app, so I couldn't reach them. A message from you may get them going.`,
  not_registered: (name) => `${name}: isn't on Buddy yet, so I couldn't message them.`,
  failed: (name) => `${name}: something went wrong sending that. Please try again in a minute.`,
};

export function sendReport(rows: Array<{ name: string; how: string }>): string {
  if (!rows.length) return "I didn't have anyone to message.";
  const lines = rows.map((r) => REACH_LINE[r.how]?.(r.name) ?? REACH_LINE.failed(r.name));
  if (rows.length === 1) return lines[0];
  return ["Here's what happened.", ...lines].join("\n");
}

/**
 * Pull a tool call out of a chat-completions body. Accepts OpenAI tool_calls,
 * a JSON object in the message, and Gemini's functionCall part. Never throws.
 */
export function decisionFromGateway(json: unknown): AgentDecision | null {
  if (!json || typeof json !== "object") return null;
  const choices = (json as { choices?: unknown }).choices;
  const message = Array.isArray(choices)
    ? (choices[0] as { message?: Record<string, unknown> } | undefined)?.message
    : null;
  const calls = message && Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const call of calls) {
    const fn = (call as { function?: { name?: unknown; arguments?: unknown } }).function;
    if (!fn) continue;
    const args = parseArgs(fn.arguments);
    const decision = validDecision({ ...args, tool: fn.name });
    if (decision) return decision;
  }
  const content = message?.content;
  const fromContent = decisionFromContent(content);
  if (fromContent) return fromContent;
  const parts = (json as { candidates?: Array<{ content?: { parts?: unknown[] } }> })
    .candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const fc = (part as { functionCall?: { name?: unknown; args?: unknown } }).functionCall;
      if (fc) {
        const decision = validDecision({ ...(fc.args as object), tool: fc.name });
        if (decision) return decision;
      }
    }
  }
  return null;
}

function parseArgs(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function decisionFromContent(content: unknown): AgentDecision | null {
  const text = Array.isArray(content)
    ? content
        .map((p) =>
          p && typeof p === "object" && "text" in p
            ? String((p as { text?: unknown }).text ?? "")
            : "",
        )
        .join("\n")
    : typeof content === "string"
      ? content
      : "";
  const fenced = text.match(/\{[\s\S]*\}/);
  if (!fenced) return null;
  try {
    return validDecision(JSON.parse(fenced[0]) as unknown);
  } catch {
    return null;
  }
}
