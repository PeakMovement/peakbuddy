/**
 * Practitioner mode, part 2 (9 Oct 2026): practitioners ask Buddy how their
 * clients are doing, ask for regular updates, and ask Buddy to check in with
 * a client.
 *
 *   Zoe:   How are my clients doing?
 *   Buddy: (needs a look / gone quiet / doing well, one line each)
 *   Zoe:   How is Sam Kruger doing?
 *   Buddy: (last check-ins, pain trend, open alerts)
 *   Zoe:   Update me every weekday at 7am      (or daily, weekly, every Friday, stop updates)
 *   Zoe:   Check in with Sam
 *   Buddy: Done, I've asked Sam to check in. I'll send you their answers when they reply.
 *
 * Updates go out from the minute job. Inside the practitioner's 24 hour
 * window the update itself is sent; outside it the approved template
 * WHATSAPP_PRAC_UPDATE_TEMPLATE ("your update is ready", button "Show
 * update") opens the window and the tap brings the full update.
 */
import { log } from "@/lib/log";
import { toSast } from "./clinic-hours";
import { maskPhone, toE164Digits } from "./phone";
import type { OutboundMessage, ProviderSecrets, WhatsAppProvider } from "./provider";
import {
  bareReception,
  blocksOutbound,
  fixPractitionerTypos,
  isFillerTask,
  directCheckin,
  looseCheckin,
  looseReceptionTask,
  looseStatusName,
  normalizePractitionerText,
  RECEPTION_NAMES_STRONG,
  RECEPTION_NAMES_WEAK,
  RECEPTION_OWNER,
  statusOneJunk,
} from "./practitioner-understand";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type Db = { from: (t: string) => any; auth: Admin["auth"] };

const DAY = 86_400_000;
const WINDOW_MS = DAY - 2 * 60 * 1000;
/** A client counts as current with a check-in in this window, or joined recently. */
const ACTIVE_DAYS = 60;
const NEW_DAYS = 30;
/** No check-in for this many days: gone quiet. */
const QUIET_DAYS = 4;
/** Check-in requests wait this long for an answer. */
const REQUEST_TTL_MS = 2 * DAY;
const MAX_BODY = 3800;

/* ------------------------------------------------------------------ */
/* Intents                                                             */
/* ------------------------------------------------------------------ */

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export const STOP_UPDATES =
  /\b(stop|pause|cancel|turn off|switch off|no more|unsubscribe)\b[\s\S]{0,40}\b(updates?|reports?|summar(?:y|ies)|digests?)\b/i;
export const WANT_UPDATES =
  /\b(update|send|message|tell|brief)\s+me\b[\s\S]{0,60}\b(daily|every\s*day|each\s*day|every\s*morning|each\s*morning|mornings|weekly|every\s*week|each\s*week|weekdays?|every\s*(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b|\b(daily|weekly|morning)\s+(updates?|reports?|summar(?:y|ies)|digests?)\b|\b(send|give)\s+(?:me\s+)?(?:an?\s+)?(?:client\s+)?updates?\b[\s\S]{0,40}\b(every\s*morning|each\s*morning|daily|every\s*day|weekly|every\s*week|weekdays?|every\s*(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;
export const CHECKIN_REQUEST =
  /\bcheck[\s-]?in\s+(with|on)\b|\bask\s+[\s\S]{1,40}?\s+to\s+(check[\s-]?in|do\s+(a|their|his|her)\s+check[\s-]?in)\b|\bsend\s+[\s\S]{1,40}?\s+a\s+check[\s-]?in\b|\bnudge\s+\S+/i;
export const STATUS_ALL =
  /\bhow\s*(?:'s|’s|\s+is|\s+are)\s+(?:all\s+)?(?:my|our|the)\s+(?:clients?|patients?|people|caseload)\b|\b(?:client|patient)s?\s+(?:update|status|summary|report|overview)\b|^\s*(?:status|update|summary|overview)\s*[?.!]*\s*$|\bhow\s+is\s+(?:everyone|everybody)\b|\bhow\s+(?:are\s+)?(?:things|my clients)\b|\bstatus\s+of\s+(?:my|our|the)\s+(?:clients?|patients?)\b/i;
export const STATUS_ONE =
  /\bhow\s*(?:'s|’s|\s+is|\s+are)\s+([\s\S]{2,60}?)\s+(?:doing|going|getting\s+on|progressing|coming\s+along)\b|\b(?:update|status|news)\s+on\s+([\s\S]{2,60})/i;

export type PracIntent =
  | { kind: "updates_menu" }
  | {
      kind: "updates";
      frequency: "daily" | "weekdays" | "weekly" | "off";
      weekday: number;
      time: string;
    }
  | { kind: "checkin"; clientId: string | null; confidence?: "medium" }
  | { kind: "status_all"; practice: boolean }
  | { kind: "status_one"; clientId: string | null }
  | { kind: "admin"; topic: "overview" | "redflags" | "quiet" | "usage" }
  | { kind: "reception"; task: string }
  /** Phrasing names reception and a task, but not clearly enough to send. */
  | { kind: "reception_confirm"; task: string }
  /** "contact reception" with no errand: ask, then take the next message. */
  | { kind: "reception_ask" }
  | { kind: "reception_open" }
  | { kind: "other" };

/** "at 7", "at 7:30am", "at 18:00", "at 6pm". Default 07:30. */
export function readTime(text: string): string {
  const m = text.match(/\b(?:at|by|around)\s+(\d{1,2})(?:[:h.](\d{2}))?\s*(am|pm)?\b/i);
  if (!m) return "07:30";
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return "07:30";
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function readUpdates(text: string): PracIntent | null {
  if (STOP_UPDATES.test(text))
    return { kind: "updates", frequency: "off", weekday: 1, time: "07:30" };
  if (!WANT_UPDATES.test(text)) return null;
  const t = text.toLowerCase();
  const time = readTime(text);
  const day = DAYS.findIndex((d) => new RegExp(`\\b${d}s?\\b`).test(t));
  if (/\bweekdays?\b/.test(t)) return { kind: "updates", frequency: "weekdays", weekday: 1, time };
  if (day >= 0) return { kind: "updates", frequency: "weekly", weekday: day + 1, time };
  if (/\bweekly|every\s*week|each\s*week\b/.test(t))
    return { kind: "updates", frequency: "weekly", weekday: 1, time };
  return { kind: "updates", frequency: "daily", weekday: 1, time };
}

/** "Ask reception to ...", "tell the front desk that ...", "reception: ..." */
const RECEPTION_WHO =
  RECEPTION_OWNER + String.raw`(?:${RECEPTION_NAMES_STRONG}|${RECEPTION_NAMES_WEAK})\b`;
const RECEPTION_ASK = new RegExp(
  String.raw`^\s*(?:(?:please|pls|plz|can\s+you|could\s+you|would\s+you|buddy|hey)[\s,]+)*(?:ask|tell|get|message|remind|let|contact|text|ping|phone|whatsapp)\s+` +
    RECEPTION_WHO +
    String.raw`\s*(?:to\s+|that\s+|know\s+(?:that\s+)?|about\s+|[:,]\s*)?([\s\S]+)$`,
  "i",
);
const RECEPTION_COLON = new RegExp(
  String.raw`^\s*` + RECEPTION_WHO + String.raw`\s*[:,]\s*([\s\S]+)$`,
  "i",
);
export const RECEPTION_OPEN = new RegExp(
  String.raw`\b(what'?s|whats|what\s+is|anything|any|which)\b[\s\S]{0,25}\b(open|outstanding|pending|waiting|still)\b[\s\S]{0,25}\b(?:${RECEPTION_NAMES_STRONG})\b|\b(?:${RECEPTION_NAMES_STRONG})\s+(tasks|requests|errands|list)\b`,
  "i",
);

export function readReceptionTask(text: string): string | null {
  const t = String(text ?? "").trim();
  const m = t.match(RECEPTION_ASK) ?? t.match(RECEPTION_COLON);
  if (!m) return null;
  const task = m[1].trim().replace(/[\s.]+$/, "");
  if (task.length < 3 || RECEPTION_OPEN.test(t)) return null;
  const clipped = task.length > 600 ? `${task.slice(0, 597).trimEnd()}...` : task;
  return clipped.charAt(0).toUpperCase() + clipped.slice(1);
}

/** Practitioner commands this module answers. Button replies carry the ids. */
/** Practice owner questions, answered by practitioner-admin.server.ts. */
function adminTopicOf(text: string): "overview" | "redflags" | "quiet" | "usage" | null {
  if (
    /\b(practice|admin|owner)\s+(overview|summary|update|report|stats|numbers|dashboard)\b|^\s*(overview|dashboard|practice stats)\s*[?.!]*\s*$/i.test(
      text,
    )
  )
    return "overview";
  if (
    /\bred[\s-]?flags?\b|\b(any|open|unread|outstanding)\s+(alerts?|flags?)\b|\balerts?\s+(open|outstanding|today|this week)\b/i.test(
      text,
    )
  )
    return "redflags";
  if (
    /\b(gone|went|going)\s+quiet\b|\bquiet\s+(clients?|patients?|ones|people)\b|\b(stopped|not|haven'?t|havent|hasn'?t)\s+(been\s+)?check(ing|ed)?[\s-]?in\b|\binactive\s+(clients?|patients?)\b|\bwho(?:'?s|se|s| is| has| have)?\s+(?:all\s+)?(?:gone\s+|going\s+|went\s+)?quiet\b|\bany(?:one|body)\s+(?:gone\s+|going\s+|went\s+)?quiet\b/i.test(
      text,
    )
  )
    return "quiet";
  if (
    /\bhow\s+many\b[\s\S]{0,40}\b(clients|patients|people)\b|\b(using|on|joined)\s+buddy\b|\bbuddy\s+(usage|uptake|numbers|stats)\b|\b(usage|uptake)\b/i.test(
      text,
    )
  )
    return "usage";
  return null;
}

export function practitionerIntent(text: string, replyId: string | null): PracIntent {
  const r = replyId ?? "";
  if (r === "prac_status") return { kind: "status_all", practice: false };
  if (r === "prac_updates") return { kind: "updates_menu" };
  if (r === "prac_upd_daily")
    return { kind: "updates", frequency: "daily", weekday: 1, time: "07:30" };
  if (r === "prac_upd_weekly")
    return { kind: "updates", frequency: "weekly", weekday: 1, time: "07:30" };
  if (r === "prac_upd_off") return { kind: "updates", frequency: "off", weekday: 1, time: "07:30" };
  const ci = r.match(/^prac_ci_([0-9a-f-]{36})$/i);
  if (ci) return { kind: "checkin", clientId: ci[1] };
  const one = r.match(/^prac_one_([0-9a-f-]{36})$/i);
  if (one) return { kind: "status_one", clientId: one[1] };

  if (r.startsWith("prac_adm_")) {
    const topic = r.slice("prac_adm_".length);
    if (topic === "overview" || topic === "redflags" || topic === "quiet" || topic === "usage")
      return { kind: "admin", topic };
  }

  // Typos corrected, then the same patterns. Original text is tried first
  // so "Send Lee an invoice" keeps Lee's capital letter.
  const fixed = fixPractitionerTypos(text);
  const normalized = normalizePractitionerText(text);
  const blocked = blocksOutbound(text) || blocksOutbound(fixed);

  // Errands for reception come first: "ask reception to remind Sam to
  // check in" is for reception, not a check-in request.
  if (!blocked) {
    const task = readReceptionTask(text) ?? (fixed === text ? null : readReceptionTask(fixed));
    if (task && !isFillerTask(task)) return { kind: "reception", task };
    if ((task && isFillerTask(task)) || bareReception(text)) return { kind: "reception_ask" };
  }
  if (RECEPTION_OPEN.test(text) || RECEPTION_OPEN.test(normalized))
    return { kind: "reception_open" };
  if (!blocked) {
    const loose = looseReceptionTask(text);
    if (loose) return { kind: "reception_confirm", task: loose };
  }

  const upd = readUpdates(text) ?? (fixed === text ? null : readUpdates(fixed));
  // "don't update me daily" is not a request to start updates.
  if (upd && !(upd.kind === "updates" && upd.frequency !== "off" && blocked)) return upd;
  if (
    !blocked &&
    (CHECKIN_REQUEST.test(text) || CHECKIN_REQUEST.test(normalized) || directCheckin(text))
  )
    return { kind: "checkin", clientId: null };
  if (!blocked && looseCheckin(text))
    return { kind: "checkin", clientId: null, confidence: "medium" };
  const topic = adminTopicOf(text) ?? adminTopicOf(normalized);
  if (topic) return { kind: "admin", topic };
  const practice = /\b(practice|everyone|everybody|whole team|all (the )?(clients|patients))\b/i;
  if (STATUS_ALL.test(text) || STATUS_ALL.test(normalized))
    return { kind: "status_all", practice: practice.test(text) || practice.test(normalized) };
  if ((STATUS_ONE.test(text) || STATUS_ONE.test(normalized)) && !statusOneJunk(text))
    return { kind: "status_one", clientId: null };
  if (looseStatusName(text)) return { kind: "status_one", clientId: null };
  return { kind: "other" };
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export interface ClientStatus {
  id: string;
  name: string;
  joinedAt: string | null;
  checkins: Array<{
    at: string;
    pain: number | null;
    sleep: number | null;
    energy: number | null;
    notes: string | null;
  }>;
  openAlerts: Array<{ type: string; urgency: string; at: string; kind?: AlertKind }>;
  channel: "whatsapp" | "app" | "none";
}

export type Bucket = "attention" | "quiet" | "well" | "inactive";

export function bucketOf(c: ClientStatus, now: Date): Bucket {
  const last = c.checkins[0];
  const lastMs = last ? now.getTime() - new Date(last.at).getTime() : Infinity;
  const joinedMs = c.joinedAt ? now.getTime() - new Date(c.joinedAt).getTime() : Infinity;
  if (lastMs > ACTIVE_DAYS * DAY && joinedMs > NEW_DAYS * DAY && !c.openAlerts.length)
    return "inactive";
  if (c.openAlerts.length) return "attention";
  if (last && lastMs <= 7 * DAY) {
    const pain = last.pain;
    const prev = c.checkins.find((x, i) => i > 0 && x.pain != null)?.pain ?? null;
    if (pain != null && pain >= 7) return "attention";
    if (pain != null && prev != null && pain - prev >= 2) return "attention";
  }
  if (lastMs > QUIET_DAYS * DAY && joinedMs > 2 * DAY) return "quiet";
  return "well";
}

export function ago(at: string, now: Date): string {
  const d = Math.floor((now.getTime() - new Date(at).getTime()) / DAY);
  const sastToday = toSast(now).date;
  const sastThen = toSast(new Date(at)).date;
  if (sastThen === sastToday) return "today";
  if (d <= 1) return "yesterday";
  return `${d} days ago`;
}

export type AlertKind = "red_flag" | "question" | "call_request" | "message" | "pattern" | "other";

/** What an alert actually is, so the practitioner isn't told "question or call request". */
export function alertKind(type: string, message: string | null | undefined): AlertKind {
  if (type === "red_flag") return "red_flag";
  if (type === "pattern") return "pattern";
  if (type === "client_contact_request") {
    const m = String(message ?? "");
    if (/^clinical question/i.test(m)) return "question";
    if (/requested contact/i.test(m)) return "call_request";
    return "message";
  }
  return "other";
}

const KIND_WORDS: Record<AlertKind, [string, string]> = {
  red_flag: ["red flag", "red flags"],
  question: ["question", "questions"],
  call_request: ["call request", "call requests"],
  message: ["message for you", "messages for you"],
  pattern: ["pattern alert", "pattern alerts"],
  other: ["alert", "alerts"],
};
const KIND_ORDER: AlertKind[] = [
  "red_flag",
  "call_request",
  "question",
  "message",
  "pattern",
  "other",
];

/** "1 red flag and 2 call requests to review" */
export function alertLine(c: ClientStatus): string {
  const counts = new Map<AlertKind, number>();
  for (const a of c.openAlerts) {
    const k = a.kind ?? alertKind(a.type, null);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const parts = KIND_ORDER.filter((k) => counts.has(k)).map((k) => {
    const n = counts.get(k)!;
    return `${n} ${KIND_WORDS[k][n === 1 ? 0 : 1]}`;
  });
  const list =
    parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `${list} to review`;
}

function andList(xs: string[]): string {
  return xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? "");
}

function painLine(c: ClientStatus): string | null {
  const last = c.checkins[0];
  if (!last || last.pain == null) return null;
  const prev = c.checkins.find((x, i) => i > 0 && x.pain != null)?.pain ?? null;
  const trend =
    prev == null
      ? ""
      : last.pain > prev
        ? `, up from ${prev}`
        : last.pain < prev
          ? `, down from ${prev}`
          : ", steady";
  return `pain ${last.pain}${trend}`;
}

export function formatStatusAll(
  name: string,
  statuses: ClientStatus[],
  now: Date,
  practice = false,
): string {
  const by: Record<Bucket, ClientStatus[]> = { attention: [], quiet: [], well: [], inactive: [] };
  for (const c of statuses) by[bucketOf(c, now)].push(c);
  const active = statuses.length - by.inactive.length;
  if (!active) {
    return practice
      ? `No current clients at the practice yet, ${name}. Once patients join Buddy and start checking in, they'll show up here.`
      : `You don't have any current clients on Buddy yet, ${name}. Once your patients join and start checking in, they'll show up here.`;
  }
  const counts = [
    by.attention.length
      ? `${by.attention.length} need${by.attention.length === 1 ? "s" : ""} a look`
      : null,
    by.quiet.length ? `${by.quiet.length} gone quiet` : null,
    by.well.length ? `${by.well.length} doing well` : null,
  ].filter(Boolean) as string[];
  const lines: string[] = [
    practice
      ? `Here's how the practice's clients are doing, ${name}. ${active} current: ${andList(counts)}.`
      : `Here's how your clients are doing, ${name}. ${active} current: ${andList(counts)}.`,
  ];
  if (by.attention.length) {
    lines.push("", `*Needs a look (${by.attention.length})*`);
    for (const c of by.attention) {
      const bits = [
        painLine(c),
        c.checkins[0] ? `last check-in ${ago(c.checkins[0].at, now)}` : null,
        c.openAlerts.length ? alertLine(c) : null,
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(`• ${c.name}: ${bits}`);
    }
  }
  if (by.quiet.length) {
    const shown = by.quiet.slice(0, 6).map((c) => {
      if (!c.checkins[0]) return `${c.name} (no check-in yet)`;
      const d = ago(c.checkins[0].at, now);
      return `${c.name} (${d.replace(/ ago$/, "")})`;
    });
    const more = by.quiet.length - shown.length;
    lines.push(
      "",
      `*Gone quiet (${by.quiet.length})*, no check-in for 4 days or more:`,
      `${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`,
    );
  }
  if (by.well.length) {
    lines.push(
      "",
      `*Doing well (${by.well.length})*`,
      by.well
        .map((c) => {
          const p = c.checkins[0]?.pain;
          return p == null ? c.name : `${c.name} (pain ${p})`;
        })
        .join(", "),
    );
  }
  const example = (by.attention[0] ?? by.quiet[0] ?? by.well[0])?.name.split(/\s+/)[0] ?? "Sam";
  lines.push("", `Ask "how is ${example} doing?" for more on anyone.`);
  return clip(lines.join("\n"));
}

export function formatStatusOne(c: ClientStatus, now: Date): string {
  const lines = [`*${c.name}*`];
  const last = c.checkins[0];
  if (!last) {
    lines.push("No check-ins yet.");
  } else {
    const parts = [
      last.pain != null ? `pain ${last.pain}/10` : null,
      last.sleep != null ? `sleep ${last.sleep}/5` : null,
      last.energy != null ? `energy ${last.energy}/5` : null,
    ].filter(Boolean);
    lines.push(`Last check-in ${ago(last.at, now)}${parts.length ? `: ${parts.join(", ")}` : ""}.`);
    const week = c.checkins.filter((x) => now.getTime() - new Date(x.at).getTime() <= 7 * DAY);
    const pains = week.map((x) => x.pain).filter((p): p is number => p != null);
    if (week.length > 1 && pains.length > 1) {
      const oldest = pains[pains.length - 1];
      const newest = pains[0];
      const dir = newest > oldest ? "worse" : newest < oldest ? "better" : "the same";
      lines.push(`Past 7 days: ${week.length} check-ins, pain ${oldest} to ${newest} (${dir}).`);
    } else if (week.length) {
      lines.push(`Past 7 days: ${week.length} check-in${week.length > 1 ? "s" : ""}.`);
    } else {
      lines.push("No check-ins in the past 7 days.");
    }
    const note = c.checkins.find((x) => x.notes && x.notes.trim())?.notes?.trim();
    if (note) lines.push(`Latest note: "${note.length > 160 ? `${note.slice(0, 157)}...` : note}"`);
  }
  if (c.openAlerts.length)
    lines.push(
      `${alertLine(c).replace(/ to review$/, "")} not reviewed yet. Open their profile in Buddy to review.`,
    );
  lines.push(
    c.channel === "whatsapp"
      ? "Checks in on WhatsApp."
      : c.channel === "app"
        ? "Uses the Buddy app, not WhatsApp."
        : "Not on WhatsApp or the Buddy app yet.",
  );
  return clip(lines.join("\n"));
}

function clip(s: string): string {
  return s.length <= MAX_BODY
    ? s
    : `${s.slice(0, MAX_BODY - 40).replace(/\n[^\n]*$/, "")}\n...and more in the Buddy app.`;
}

/** The practitioner's own clients, or the whole practice for owners and admins who ask. */
export async function loadClientList(
  adminIn: Admin,
  userId: string,
  practice: boolean,
): Promise<
  Array<{
    id: string;
    full_name: string | null;
    created_at: string | null;
    auth_user_id: string | null;
  }>
> {
  const admin = adminIn as unknown as Db;
  const cols = "id, full_name, created_at, auth_user_id";
  if (practice) {
    const [{ data: owned }, { data: adminOf }] = await Promise.all([
      admin.from("practices").select("id").eq("practitioner_id", userId),
      admin
        .from("practice_members")
        .select("practice_id, role")
        .eq("user_id", userId)
        .eq("status", "active"),
    ]);
    const ids = [
      ...((owned ?? []) as Array<{ id: string }>).map((p) => p.id),
      ...((adminOf ?? []) as Array<{ practice_id: string; role: string }>)
        .filter((m) => m.role === "owner" || m.role === "admin")
        .map((m) => m.practice_id),
    ];
    if (ids.length) {
      const { data } = await admin.from("clients").select(cols).in("practice_id", ids).limit(1000);
      return (data ?? []) as never;
    }
  }
  const { data } = await admin
    .from("clients")
    .select(cols)
    .eq("practitioner_id", userId)
    .limit(1000);
  return (data ?? []) as never;
}

export async function loadStatuses(
  adminIn: Admin,
  clients: Array<{
    id: string;
    full_name: string | null;
    created_at: string | null;
    auth_user_id: string | null;
  }>,
  now: Date,
): Promise<ClientStatus[]> {
  const admin = adminIn as unknown as Db;
  if (!clients.length) return [];
  const ids = clients.map((c) => c.id);
  const since = new Date(now.getTime() - ACTIVE_DAYS * DAY).toISOString();
  const alertSince = new Date(now.getTime() - 14 * DAY).toISOString();
  const [{ data: cis }, { data: alerts }, { data: convs }] = await Promise.all([
    admin
      .from("check_ins")
      .select("client_id, pain_level, sleep_quality, energy_level, notes, created_at")
      .in("client_id", ids)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000),
    admin
      .from("alerts")
      .select("client_id, alert_type, urgency, created_at, is_read, reviewed_at, message")
      .in("client_id", ids)
      .gte("created_at", alertSince)
      .limit(2000),
    admin
      .from("whatsapp_conversations")
      .select("client_id, opted_out_at, state")
      .in("client_id", ids)
      .limit(2000),
  ]);
  const onWa = new Set(
    ((convs ?? []) as Array<{ client_id: string; opted_out_at: string | null; state: string }>)
      .filter((c) => !c.opted_out_at && c.state !== "opted_out")
      .map((c) => c.client_id),
  );
  const out = new Map<string, ClientStatus>();
  for (const c of clients) {
    out.set(c.id, {
      id: c.id,
      name: String(c.full_name ?? "").trim() || "Unnamed client",
      joinedAt: c.created_at,
      checkins: [],
      openAlerts: [],
      channel: onWa.has(c.id) ? "whatsapp" : c.auth_user_id ? "app" : "none",
    });
  }
  const rows = ((cis ?? []) as Array<Record<string, any>>).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  for (const r of rows) {
    out.get(r.client_id)?.checkins.push({
      at: r.created_at,
      pain: r.pain_level ?? null,
      sleep: r.sleep_quality ?? null,
      energy: r.energy_level ?? null,
      notes: r.notes ?? null,
    });
  }
  for (const a of (alerts ?? []) as Array<Record<string, any>>) {
    if (a.is_read || a.reviewed_at) continue;
    if (!["red_flag", "client_contact_request"].includes(a.alert_type) && a.urgency === "routine")
      continue;
    out.get(a.client_id)?.openAlerts.push({
      type: a.alert_type,
      urgency: a.urgency,
      at: a.created_at,
      kind: alertKind(a.alert_type, a.message),
    });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ */
/* Update preferences                                                  */
/* ------------------------------------------------------------------ */

export const UPDATE_MSG = {
  menu: "How often would you like a client update from me?",
  saved: (freq: string, weekday: number, time: string) => {
    const t = sayClock(time);
    if (freq === "off")
      return 'Done, I\'ve stopped your client updates. Ask me "how are my clients doing" any time.';
    if (freq === "daily") return `Done. I'll send you a client update every day at ${t}.`;
    if (freq === "weekdays") return `Done. I'll send you a client update every weekday at ${t}.`;
    const day = DAYS[weekday - 1];
    return `Done. I'll send you a client update every ${day[0].toUpperCase()}${day.slice(1)} at ${t}.`;
  },
  failed: "Sorry, I couldn't save that just now. Please try again in a minute.",
};

export function sayClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${ap}` : `${h12}${ap}`;
}

export async function saveUpdatePrefs(
  adminIn: Admin,
  userId: string,
  p: { frequency: string; weekday: number; time: string },
  now: Date,
): Promise<boolean> {
  const admin = adminIn as unknown as Db;
  const { error } = await admin.from("practitioner_update_prefs").upsert(
    {
      practitioner_id: userId,
      frequency: p.frequency,
      weekday: p.weekday,
      send_time: p.time,
      updated_at: now.toISOString(),
    },
    { onConflict: "practitioner_id" },
  );
  if (error) log.warn("practitioner update prefs save failed", { code: error.code });
  return !error;
}

/** Whether an update is due now (SAST), given the last one sent. */
export function updateDue(
  pref: {
    frequency: string;
    weekday: number | null;
    send_time: string;
    last_sent_at: string | null;
  },
  now: Date,
): boolean {
  if (pref.frequency === "off") return false;
  const n = toSast(now);
  const [h, m] = String(pref.send_time).slice(0, 5).split(":").map(Number);
  if (n.minuteOfDay < h * 60 + (m || 0)) return false;
  if (pref.frequency === "weekdays" && n.weekday > 5) return false;
  if (pref.frequency === "weekly" && n.weekday !== (pref.weekday ?? 1)) return false;
  if (!pref.last_sent_at) return true;
  return toSast(new Date(pref.last_sent_at)).date !== n.date;
}

/* ------------------------------------------------------------------ */
/* Sending to a practitioner outside a conversation                    */
/* ------------------------------------------------------------------ */

export interface SendEnv {
  provider: WhatsAppProvider;
  secrets: ProviderSecrets;
}

export async function practitionerContact(
  adminIn: Admin,
  userId: string,
): Promise<{ phone: string | null; firstName: string }> {
  const admin = adminIn as unknown as Db;
  const [{ data: user }, { data: prof }] = await Promise.all([
    adminIn.auth.admin.getUserById(userId),
    admin.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);
  return {
    phone: toE164Digits(user?.user?.phone ?? null),
    firstName:
      String(prof?.full_name ?? "")
        .trim()
        .split(/\s+/)[0] || "there",
  };
}

export async function windowOpen(adminIn: Admin, phone: string, now: Date): Promise<boolean> {
  const admin = adminIn as unknown as Db;
  const { data } = await admin
    .from("whatsapp_inbound")
    .select("received_at")
    .in("from_phone", [`+${phone}`, phone])
    .order("received_at", { ascending: false })
    .limit(1);
  const at = (data as Array<{ received_at: string }> | null)?.[0]?.received_at;
  return Boolean(at && now.getTime() - new Date(at).getTime() < WINDOW_MS);
}

export async function sendLogged(
  adminIn: Admin,
  env: SendEnv,
  msg: OutboundMessage,
  logBody: string,
): Promise<boolean> {
  const admin = adminIn as unknown as Db;
  let id: string | null = null;
  let ok = false;
  try {
    id = (await env.provider.send(msg, env.secrets)).providerMessageId || null;
    ok = true;
  } catch (e) {
    log.warn("practitioner message failed", {
      to: maskPhone(msg.to),
      error: e instanceof Error ? e.message : "unknown",
    });
  }
  await admin
    .from("whatsapp_outbound")
    .insert({
      phone: msg.to,
      client_id: null,
      provider: env.provider.id,
      provider_message_id: id,
      kind: msg.kind,
      body: logBody,
      sent_ok: ok,
    })
    .then(
      () => undefined,
      () => undefined,
    );
  return ok;
}

/**
 * The minute job: scheduled client updates, and answers to check-ins a
 * practitioner asked for. Best effort; a failure waits for the next minute
 * only where retrying makes sense.
 */
export async function runPractitionerJobs(
  adminIn: Admin,
  env: SendEnv,
  now = new Date(),
): Promise<void> {
  const admin = adminIn as unknown as Db;

  // 1. Scheduled updates.
  try {
    const { data: prefs } = await admin
      .from("practitioner_update_prefs")
      .select("practitioner_id, frequency, weekday, send_time, last_sent_at")
      .neq("frequency", "off")
      .limit(500);
    for (const p of (prefs ?? []) as Array<Record<string, any>>) {
      if (!updateDue(p as never, now)) continue;
      // Claim first so an overlapping run can't send twice.
      const claim = admin
        .from("practitioner_update_prefs")
        .update({ last_sent_at: now.toISOString() })
        .eq("practitioner_id", p.practitioner_id);
      const { data: claimed } = await (
        p.last_sent_at ? claim.eq("last_sent_at", p.last_sent_at) : claim.is("last_sent_at", null)
      ).select("practitioner_id");
      if (!(claimed ?? []).length) continue;
      await sendScheduledUpdate(adminIn, env, p.practitioner_id, now).catch((e) =>
        log.warn("scheduled practitioner update failed", {
          error: e instanceof Error ? e.message : "unknown",
        }),
      );
    }
  } catch {
    /* table may not exist until the migration runs */
  }

  // 2. A client asked Buddy to stop: tell their practitioner by name.
  try {
    const since = new Date(now.getTime() - DAY).toISOString();
    const { data: stops } = await admin
      .from("alerts")
      .select("id, practitioner_id, client_id, message")
      .eq("alert_type", "whatsapp_opt_out")
      .eq("push_fired", false)
      .gte("created_at", since)
      .limit(20);
    for (const a of (stops ?? []) as Array<Record<string, any>>) {
      const { data: claimed } = await admin
        .from("alerts")
        .update({ push_fired: true })
        .eq("id", a.id)
        .eq("push_fired", false)
        .select("id");
      if (!(claimed ?? []).length) continue;
      const body = String(a.message ?? "A client asked Buddy to stop their WhatsApp check-ins.");
      try {
        const { sendPushCore } = await import("@/lib/push.functions");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await sendPushCore(supabaseAdmin, {
          userId: a.practitioner_id,
          title: "Buddy",
          body,
          data: { clientId: a.client_id, kind: "opt_out" },
        });
      } catch {
        /* the alert row still shows in the app */
      }
      const contact = await practitionerContact(adminIn, a.practitioner_id);
      if (contact.phone && (await windowOpen(adminIn, contact.phone, now))) {
        await sendLogged(adminIn, env, { kind: "text", to: contact.phone, body }, body);
      }
    }
  } catch {
    /* never blocks the other jobs */
  }

  // 3. Check-ins a practitioner asked for: pass the answers on.
  try {
    const since = new Date(now.getTime() - REQUEST_TTL_MS).toISOString();
    const { data: reqs } = await admin
      .from("practitioner_checkin_requests")
      .select("id, client_id, practitioner_id, requested_at")
      .is("notified_at", null)
      .limit(50);
    for (const r of (reqs ?? []) as Array<Record<string, any>>) {
      if (r.requested_at < since) {
        await admin
          .from("practitioner_checkin_requests")
          .update({ notified_at: now.toISOString() })
          .eq("id", r.id);
        continue;
      }
      const { data: ci } = await admin
        .from("check_ins")
        .select("pain_level, sleep_quality, energy_level, notes, created_at")
        .eq("client_id", r.client_id)
        .gt("created_at", r.requested_at)
        .order("created_at", { ascending: false })
        .limit(1);
      const done = (ci as Array<Record<string, any>> | null)?.[0];
      if (!done) continue;
      const { data: claimed } = await admin
        .from("practitioner_checkin_requests")
        .update({ notified_at: now.toISOString(), completed_at: done.created_at })
        .eq("id", r.id)
        .is("notified_at", null)
        .select("id");
      if (!(claimed ?? []).length) continue;
      const contact = await practitionerContact(adminIn, r.practitioner_id);
      if (!contact.phone || !(await windowOpen(adminIn, contact.phone, now))) continue;
      const statuses = await loadStatuses(adminIn, await loadClientById(adminIn, r.client_id), now);
      const s = statuses[0];
      if (!s) continue;
      const body = `${s.name.split(/\s+/)[0]} just did the check-in you asked for.\n\n${formatStatusOne(s, now)}`;
      await sendLogged(adminIn, env, { kind: "text", to: contact.phone, body }, body);
    }
  } catch {
    /* table may not exist until the migration runs */
  }
}

async function loadClientById(adminIn: Admin, id: string) {
  const admin = adminIn as unknown as Db;
  const { data } = await admin
    .from("clients")
    .select("id, full_name, created_at, auth_user_id")
    .eq("id", id)
    .limit(1);
  return (data ?? []) as Array<{
    id: string;
    full_name: string | null;
    created_at: string | null;
    auth_user_id: string | null;
  }>;
}

async function sendScheduledUpdate(adminIn: Admin, env: SendEnv, userId: string, now: Date) {
  const contact = await practitionerContact(adminIn, userId);
  if (!contact.phone) return;
  if (await windowOpen(adminIn, contact.phone, now)) {
    const statuses = await loadStatuses(adminIn, await loadClientList(adminIn, userId, false), now);
    const body = formatStatusAll(contact.firstName, statuses, now);
    await sendLogged(adminIn, env, { kind: "text", to: contact.phone, body }, body);
    return;
  }
  const template = process.env.WHATSAPP_PRAC_UPDATE_TEMPLATE?.trim();
  if (!template) {
    log.info("practitioner update skipped: window closed and no template", {
      to: maskPhone(contact.phone),
    });
    return;
  }
  const statuses = await loadStatuses(adminIn, await loadClientList(adminIn, userId, false), now);
  const attention = statuses.filter((s) => bucketOf(s, now) === "attention").length;
  await sendLogged(
    adminIn,
    env,
    {
      kind: "template",
      to: contact.phone,
      templateName: template,
      languageCode: process.env.WHATSAPP_PRAC_UPDATE_TEMPLATE_LANG?.trim() || "en",
      variables: [contact.firstName, String(attention)],
      buttonPayloads: ["prac_status"],
    },
    `[practitioner update template ${template}]`,
  );
}

/** Record a check-in a practitioner asked for, so their answers come back. */
export async function recordCheckinRequest(
  adminIn: Admin,
  clientId: string,
  practitionerId: string,
  now: Date,
): Promise<void> {
  const admin = adminIn as unknown as Db;
  await admin
    .from("practitioner_checkin_requests")
    .insert({
      client_id: clientId,
      practitioner_id: practitionerId,
      requested_at: now.toISOString(),
    })
    .then(
      () => undefined,
      () => undefined,
    );
}
