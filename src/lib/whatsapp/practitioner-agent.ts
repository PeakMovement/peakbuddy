/**
 * Practitioner agent, the part that does not touch the database.
 *
 * The model is the primary reader of every practitioner message: terse,
 * garbled, a voice-note transcript, emoji, or several asks in one line.
 * It only chooses tools. Names, statuses and messages in the reply come
 * from the database. Nothing here sends a WhatsApp.
 *
 * The phrase matcher is a zero-cost shortcut for an exact canonical
 * command or a button tap, and the fallback when the model is down.
 */
import { morningPhrase } from "./morning-checkin";
import { normalizePractitionerText, rankPatients } from "./practitioner-understand";
import type {
  PracCandidate,
  PracFocus,
  PracMemory,
  PracPending,
  PracTurn,
} from "./practitioner-understand";
import { practitionerCheckinText, practitionerConfirmSend } from "./voice";
import { parseProgrammeDays } from "@/lib/capabilities";

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
  "help",
  "confirm_pending",
  "cancel_pending",
  "dismiss_morning",
  "set_morning_checkin",
  "case_brief",
  "who_improved",
  "book_reception",
  "set_goal",
  "outcomes",
  "confirm_quiet_nudges",
  "set_programme_reminder",
  "archive_clients",
  "unarchive_clients",
  "discharge_client",
  "reopen_episode",
  "prepare_data_copy",
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
  /** Up to three short button labels when the tool is clarify. */
  options: string[];
  frequency: "daily" | "weekdays" | "weekly" | "off" | "menu" | null;
  weekday: number | null;
  time: string | null;
  /** set_morning_checkin only. */
  enabled: boolean | null;
  /** set_goal only. The words they used. Buddy does not rewrite them. */
  goal: string | null;
  /** set_programme_reminder. Weekdays, Sunday = 0. Empty means they named none. */
  programmeDays?: number[];
  /** True only when the practitioner says the patient already agreed. */
  programmeOptIn?: boolean;
  /** archive_clients: no check-in or message for this many days. */
  idleDays?: number | null;
}

export interface AgentTurnInput {
  practitionerName: string;
  practiceName: string;
  message: string;
  history: PracTurn[];
  pending: string | null;
  /** Last client, last list, and anything waiting. Pronouns resolve from this. */
  context: string;
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

/**
 * The whole message is one canonical command, or a button tap. Those skip
 * the model. Anything else, including "cayla?" and "ye do it", does not.
 */
const EXACT_COMMANDS = new Set([
  "how are my clients doing",
  "how are my clients",
  "my messages",
  "my message",
  "help",
  "what can you do",
  "what else can you do",
  "any red flags",
  "who's gone quiet",
  "whos gone quiet",
  "how many clients are using buddy",
  "practice overview",
]);

const CARE_DISCHARGE = /^(?:please\s+)?discharge\s+(.+)$/i;
const CARE_REOPEN =
  /^(?:please\s+)?(?:re-?open|open)\s+(?:the\s+)?episode(?:\s+again)?(?:\s+for\s+|\s+)(.+)$/i;
const CARE_COPY = /^(?:please\s+)?prepare(?:\s+a)?\s+copy(?:\s+for\s+|\s+)(.+)$/i;

/** Exact discharge, reopen, or copy request. Used when the model is down. */
export function carePhrase(
  text: string,
): { tool: "discharge_client" | "reopen_episode" | "prepare_data_copy"; name: string } | null {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  const matched =
    t.match(CARE_DISCHARGE) ?? t.match(CARE_REOPEN) ?? t.match(CARE_COPY);
  const name = matched?.[1]?.replace(/[.?!]+$/, "").trim() ?? "";
  if (name.length < 2 || name.length > 80) return null;
  if (CARE_DISCHARGE.test(t)) return { tool: "discharge_client", name };
  if (CARE_REOPEN.test(t)) return { tool: "reopen_episode", name };
  return { tool: "prepare_data_copy", name };
}

export function isExactShortcut(text: string, replyId?: string | null): boolean {
  if (replyId && !isAgentButton(replyId) && !replyId.startsWith("prac_cl_")) return true;
  if (replyId) return false;
  const n = normalizePractitionerText(text);
  return EXACT_COMMANDS.has(n) || morningPhrase(text) != null;
}

/**
 * True when this message should stay in practitioner mode even if the
 * number is also a patient. Exact commands are still commands via the
 * matcher. A bare pain score ("6") is left for the patient check-in.
 */
export function needsPractitionerAgent(text: string, memory?: PracMemory | null): boolean {
  if (
    memory?.pending ||
    memory?.focus ||
    memory?.awaitingMorningReception ||
    memory?.replyTo ||
    (memory?.queued && memory.queued.length > 0)
  )
    return true;
  if (isExactShortcut(text, null)) return false;
  const t = String(text ?? "").trim();
  if (!t || /^\d{1,2}$/.test(t)) return false;
  return true;
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
  const options = asOptions(row.options);
  const enabled = row.enabled === true ? true : row.enabled === false ? false : null;
  const goal = typeof row.goal === "string" ? clip(row.goal, 200) : null;
  const fromNumbers = Array.isArray(row.days)
    ? row.days.filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6)
    : [];
  const programmeDays = fromNumbers.length
    ? [...new Set(fromNumbers)]
    : parseProgrammeDays(
        [
          Array.isArray(row.days) ? row.days.map(String).join(" ") : "",
          String(row.task ?? ""),
          String(row.note ?? ""),
        ].join(" "),
      );
  const programmeOptIn = row.optedIn === true;
  const names = asNames(row.names);
  const rawIdle = row.idleDays ?? row.idle_days;
  const idleDays =
    typeof rawIdle === "number" && rawIdle >= 1 && rawIdle <= 730 ? Math.round(rawIdle) : null;
  if (
    (tool === "discharge_client" || tool === "reopen_episode" || tool === "prepare_data_copy") &&
    names.length === 0
  )
    return null;
  if (tool === "set_morning_checkin" && enabled == null) return null;
  if (tool === "set_goal" && !goal) return null;
  if (tool === "set_programme_reminder" && programmeDays.length === 0) return null;
  if (
    tool === "clarify" &&
    (!question || /\b(i've|i have)\s+(sent|messaged|asked|told)\b/i.test(question))
  )
    return null;
  return {
    tool: tool as AgentTool,
    names,
    note: note || null,
    task: task || null,
    question: question || null,
    options,
    frequency,
    weekday,
    time,
    enabled,
    goal,
    programmeDays,
    programmeOptIn,
    idleDays,
  };
}

function asOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => clip(String(item ?? ""), 20))
    .filter((item) => item.length >= 2)
    .slice(0, 3);
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
        "Set or stop the practitioner's scheduled client updates. frequency is daily, weekdays, weekly, off, or menu. time is HH:MM. weekday is 1 (Monday) to 7. This is not the weekday morning check-in note.",
      properties: {
        frequency: { type: "string" },
        weekday: { type: "integer" },
        time: { type: "string" },
      },
      required: ["frequency"],
    },
    {
      name: "dismiss_morning",
      description:
        "They don't want today's morning check-in (not today, skip, no thanks). Does not turn the note off for good.",
      properties: {},
      required: [],
    },
    {
      name: "set_morning_checkin",
      description:
        'Turn the weekday morning check-in note on or off. enabled false is "stop morning check-ins". enabled true turns it back on. Not "not today", and not the scheduled client update.',
      properties: { enabled: { type: "boolean" } },
      required: ["enabled"],
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
      name: "case_brief",
      description:
        "A practitioner-only brief from the stored session note, check-ins, and watch. Needs one client name. Does not message the patient and does not invent clinical advice.",
      properties: { names: strArray },
      required: ["names"],
    },
    {
      name: "who_improved",
      description: "Who has a lower pain score than at the start of this week. No message is sent.",
      properties: {},
      required: [],
    },
    {
      name: "book_reception",
      description:
        "Ask reception to book or move an appointment. Confirmation first. Put what they asked in task. Do not invent a free slot.",
      properties: { task: { type: "string" } },
      required: ["task"],
    },
    {
      name: "set_goal",
      description:
        "Store one goal for a client, in the practitioner's words. Needs names and goal. Does not message the patient.",
      properties: { names: strArray, goal: { type: "string" } },
      required: ["names", "goal"],
    },
    {
      name: "outcomes",
      description: "Owner scorecard: counts, initials, and complaint labels. No clinical notes.",
      properties: {},
      required: [],
    },
    {
      name: "confirm_quiet_nudges",
      description:
        "They agreed to send today's check-in reminder to the quiet patients already named. This is the confirm step. Do not call it unless they agreed.",
      properties: {},
      required: [],
    },
    {
      name: "set_programme_reminder",
      description:
        "Store the weekdays for a home-programme reminder. days is 0 Sunday through 6 Saturday. Set optedIn true only when they say the patient already agreed. Does not message the patient.",
      properties: {
        names: strArray,
        days: { type: "array", items: { type: "number" } },
        optedIn: { type: "boolean" },
      },
      required: ["names", "days"],
    },
    {
      name: "archive_clients",
      description:
        'Archive clients who have stopped responding (practice owner only). Records are kept; they come off lists and get no more reminders. Named clients, or names ["inactive"] for everyone with no check-in or message for idleDays days (default 60). "Delete", "remove" or "clear out" old clients means this. A confirmation is shown first.',
      properties: { names: strArray, idleDays: { type: "integer" } },
      required: [],
    },
    {
      name: "unarchive_clients",
      description:
        'Bring archived clients back (practice owner only). names as spoken, or ["all"].',
      properties: { names: strArray },
      required: ["names"],
    },
    {
      name: "discharge_client",
      description:
        "Stop check-in reminders, programme reminders and quiet nudges for named clients. Confirmation first. Does not delete the chart. Does not send until they confirm.",
      properties: { names: strArray },
      required: ["names"],
    },
    {
      name: "reopen_episode",
      description:
        "Open a discharged client's episode again so reminders can resume. Confirmation first. Does not message the patient.",
      properties: { names: strArray },
      required: ["names"],
    },
    {
      name: "prepare_data_copy",
      description:
        "Prepare a copy of what Buddy holds for named clients and, after confirmation, send a one-time link if their WhatsApp window is open. No clinical interpretation.",
      properties: { names: strArray },
      required: ["names"],
    },
    {
      name: "help",
      description: "They asked what Buddy can do. No client facts.",
      properties: {},
      required: [],
    },
    {
      name: "confirm_pending",
      description:
        "They agreed to the pending send: yes, ye do it, all, go ahead, a thumbs up. Only when something is waiting to be sent or picked.",
      properties: {},
      required: [],
    },
    {
      name: "cancel_pending",
      description: "They declined the pending send or choice.",
      properties: {},
      required: [],
    },
    {
      name: "clarify",
      description:
        "One short question when the request is unclear. options are up to 3 button labels, each under 20 characters. Do not state any client fact.",
      properties: { question: { type: "string" }, options: strArray },
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

export function conversationContext(
  focus: PracFocus | null | undefined,
  pending: string | null,
): string {
  const lines: string[] = [];
  if (focus?.clientName) {
    lines.push(
      `Last client discussed: ${focus.clientName}. "her", "him", "she", "he" and "that one" mean this client.`,
    );
  }
  if (focus?.list?.length) {
    const shown = focus.list.map((c, i) => `${i + 1}. ${c.name}`).join("\n");
    lines.push(
      `Last list shown. "them", "those" and "the ones you mentioned" mean these clients:\n${shown}`,
    );
  }
  if (pending) lines.push(pending);
  return lines.join("\n");
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
Read the message the way a colleague would. It may be terse ("cayla?"), garbled ("lauren wat she say"), a voice-note transcript, emoji, Afrikaans mixed with English, or several asks run together.
Call one tool per ask, in order. Several asks means several tools. You do not know any clients, statuses, messages or practitioners. Never invent them. Never claim you have sent anything.
Names go in the tool as spoken, or copied from the context below. "her", "him" and "that one" are the last client. "them", "those" and "the ones you mentioned" are the last list. "the quiet ones" is names: ["quiet"]. "all" or "everyone" is names: ["all"].
A wording they want included ("say you're with ${input.practiceName}", "mention the race") goes in note, in their words.
If something is waiting to be sent and they agree ("yes", "ye do it", "all", "👍"), call confirm_pending. If they decline, call cancel_pending.
If you are unsure, call clarify with one short question and up to 3 button labels under 20 characters. No client facts in that question.
Scheduled updates use schedule_updates. Reception errands use ask_reception. What you can do uses help.
A case brief is case_brief. Who improved this week is who_improved. Booking or moving an appointment is book_reception. A goal they want stored is set_goal. An outcomes or retention scorecard is outcomes. Agreeing to remind the quiet patients already named is confirm_quiet_nudges. Deleting, removing, clearing out or archiving old or unresponsive clients is archive_clients: named clients, or names ["inactive"] with idleDays when they give a period ("not responded in 3 months" is idleDays 90). Bringing someone back is unarchive_clients. Home programme reminder days are set_programme_reminder. days uses 0 for Sunday through 6 for Saturday. optedIn is true only when they say the patient already agreed. Do not message the patient from that tool.
Stopping reminders after discharge is discharge_client. Opening the episode again is reopen_episode. A copy of the record for them to review, then a one-time link, is prepare_data_copy. Each needs a name and waits for confirmation. Do not invent clinical advice. Do not use these for everyone at once.
A weekday morning note asks whether they want a patient update or reception to check in with anyone. "Patient update" or agreeing to the update is client_status with names ["all"]. Naming patients for reception to check in with is ask_reception, task "Check in with" those names. "Reception check-in" with no names is clarify asking who, with no client facts. "Not today" is dismiss_morning. "Stop morning check-ins" is set_morning_checkin with enabled false. "Start morning check-ins" is set_morning_checkin with enabled true. "Update me every morning" is schedule_updates, not the morning note.
${input.canSeeAllPractitioners ? "This person is an owner or admin and can see the whole practice." : "This person sees only their own clients, and only themselves in the practitioner list."}
${input.heidiEnabled ? "Heidi is connected. heidi_read needs a first and last name." : "Heidi is not connected. Do not call heidi_read."}
${input.context ? `\nCONTEXT:\n${input.context}` : ""}
Write nothing except the tool calls.`;
  return { system, messages };
}

const ONE_REFERENCE =
  /^(?:her|him|she|he|that one|this one|that client|this client|the same one|same one|that person)$/i;
const MANY_REFERENCE =
  /^(?:them|those|those ones|these|these ones|the ones|the ones you mentioned|everyone you mentioned|those clients|both|both of them|the same ones)$/i;
const QUIET_REFERENCE =
  /^(?:quiet|the quiet ones?|quiet ones?|quiet clients?|the quiet clients?)$/i;

/**
 * Turn "her" / "those" / "the quiet ones" into names the database can look
 * up. Unresolved pronouns stay unresolved so the caller asks, rather than
 * searching for a client named "her".
 */
export function expandReferences(
  names: string[],
  focus: PracFocus | null | undefined,
): { names: string[]; unresolved: boolean } {
  const out: string[] = [];
  let unresolved = false;
  for (const raw of names) {
    const n = raw.trim();
    if (QUIET_REFERENCE.test(n)) {
      out.push("quiet");
      continue;
    }
    if (ONE_REFERENCE.test(n)) {
      if (focus?.clientName) out.push(focus.clientName);
      else unresolved = true;
      continue;
    }
    if (MANY_REFERENCE.test(n)) {
      if (focus?.list?.length) out.push(...focus.list.map((c) => c.name));
      else if (focus?.clientName) out.push(focus.clientName);
      else unresolved = true;
      continue;
    }
    out.push(n);
  }
  return { names: out, unresolved };
}

/** Buttons for a clarifying question. Custom labels when the model gave some. */
export function clarifyButtons(options: string[]): Array<{ id: string; title: string }> {
  const custom = options
    .map((o) => clip(o, 20))
    .filter((o) => o.length >= 2)
    .slice(0, 3);
  if (custom.length) return custom.map((title, i) => ({ id: `prac_cl_${i}`, title }));
  return [
    { id: "prac_status", title: "How are my clients" },
    { id: "prac_inbox", title: "My messages" },
    { id: "prac_help", title: "What can you do" },
  ];
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
  needs_consent: (name) =>
    `${name}: hasn't signed the current consent form, so I won't message them until they have.`,
  failed: (name) => `${name}: something went wrong sending that. Please try again in a minute.`,
};

export function sendReport(rows: Array<{ name: string; how: string }>): string {
  if (!rows.length) return "I didn't have anyone to message.";
  const lines = rows.map((r) => REACH_LINE[r.how]?.(r.name) ?? REACH_LINE.failed(r.name));
  if (rows.length === 1) return lines[0];
  return ["Here's what happened.", ...lines].join("\n");
}

/**
 * Every tool call in a chat-completions body, in order. Accepts OpenAI
 * tool_calls, a JSON object or array in the message, and Gemini functionCall
 * parts. At most four. Never throws.
 */
export function decisionsFromGateway(json: unknown): AgentDecision[] {
  if (!json || typeof json !== "object") return [];
  if (Array.isArray(json))
    return json
      .map((row) => validDecision(row))
      .filter((d) => d != null)
      .slice(0, 4);
  const choices = (json as { choices?: unknown }).choices;
  const message = Array.isArray(choices)
    ? (choices[0] as { message?: Record<string, unknown> } | undefined)?.message
    : null;
  const calls = message && Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const fromCalls: AgentDecision[] = [];
  for (const call of calls) {
    const fn = (call as { function?: { name?: unknown; arguments?: unknown } }).function;
    if (!fn) continue;
    const decision = validDecision({ ...parseArgs(fn.arguments), tool: fn.name });
    if (decision) fromCalls.push(decision);
  }
  if (fromCalls.length) return fromCalls.slice(0, 4);
  const fromContent = decisionsFromContent(message?.content);
  if (fromContent.length) return fromContent.slice(0, 4);
  const parts = (json as { candidates?: Array<{ content?: { parts?: unknown[] } }> })
    .candidates?.[0]?.content?.parts;
  const fromParts: AgentDecision[] = [];
  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const fc = (part as { functionCall?: { name?: unknown; args?: unknown } }).functionCall;
      if (!fc) continue;
      const args =
        fc.args && typeof fc.args === "object" ? (fc.args as Record<string, unknown>) : {};
      const decision = validDecision({ ...args, tool: fc.name });
      if (decision) fromParts.push(decision);
    }
  }
  return fromParts.slice(0, 4);
}

/** The first tool call, for callers that only need one. */
export function decisionFromGateway(json: unknown): AgentDecision | null {
  return decisionsFromGateway(json)[0] ?? null;
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

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((p) =>
      p && typeof p === "object" && "text" in p ? String((p as { text?: unknown }).text ?? "") : "",
    )
    .join("\n");
}

function decisionsFromContent(content: unknown): AgentDecision[] {
  const text = contentText(content);
  const array = text.match(/\[[\s\S]*\]/);
  if (array) {
    try {
      const parsed = JSON.parse(array[0]) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((row) => validDecision(row)).filter((d) => d != null);
      }
    } catch {
      /* a single object may still follow */
    }
  }
  const fenced = text.match(/\{[\s\S]*\}/);
  if (!fenced) return [];
  try {
    const one = validDecision(JSON.parse(fenced[0]) as unknown);
    return one ? [one] : [];
  } catch {
    return [];
  }
}
