/**
 * Test Lab engine (28 Oct 2026).
 *
 * Runs Buddy's real WhatsApp worker, practitioner agent and reminder job
 * against an in-memory copy of a made-up practice. Every outbound message,
 * push, email and alert is captured into the transcript instead of sent.
 * AI calls are real, so what you see is how Buddy would actually answer.
 *
 * A lab is plain JSON, so it can be saved between messages (testlab_sessions).
 */
import type { OutboundMessage, WhatsAppProvider } from "@/lib/whatsapp/provider";
import { memoryDb, type MemoryUser, type Tables } from "./memory-db";
import { runInSandbox, type SandboxEvent } from "./sandbox";
import { LAB_PEOPLE, LAB_USER_KEYS, labSeed } from "./seed";

export interface LabLine {
  at: string;
  dir: "in" | "out" | "event" | "system";
  /** LabPerson key, or the phone when unknown. */
  who: string;
  text: string;
  buttons?: Array<{ id: string; title: string }>;
  listLabel?: string;
}

export interface LabState {
  version: 1;
  createdAt: string;
  /** Simulated minus real time, in ms. Moves when you skip ahead. */
  clockOffsetMs: number;
  tables: Tables;
  users: MemoryUser[];
  transcript: LabLine[];
}

const SECRETS = { signingSecret: "testlab", senderId: "testlab", accessToken: "testlab" };

/** Known template bodies, so a template send reads like what the patient sees. */
const TEMPLATE_TEXT: Record<string, (v: string[]) => string> = {
  buddy_checkin_reminder: (v) => `Hi ${v[0] ?? ""}, it's time for your Buddy check-in.`,
  buddy_day_after: (v) =>
    `Hi ${v[0]}, it's Buddy from ${v[1]}. How is the area you worked on yesterday? Reply here and I'll pass it to your physio. No medical advice from me.`,
  buddy_flare: (v) =>
    `Hi ${v[0]}, it's Buddy from ${v[1]}. You mentioned a harder day yesterday. If you want to log how it is this morning, reply here. If it is urgent, phone the practice.`,
  buddy_milestone: (v) =>
    `Hi ${v[0]}, it's Buddy from ${v[1]}. That's ${v[2]} check ins in a row. Reply if you want to log today.`,
  buddy_discharge_check: (v) =>
    `Hi ${v[0]}, it's Buddy from ${v[1]}. It has been two weeks since your discharge. Reply if you want your physio to know how things are. This is not a new appointment.`,
  buddy_checkin_delivery_alert: (v) =>
    `Hi ${v[0]}, ${v[1]} patients were due a check-in on ${v[2]} and none were delivered. No names are in this message.`,
};

export function newLab(realNow = new Date()): LabState {
  const { tables, users } = labSeed(realNow);
  return {
    version: 1,
    createdAt: realNow.toISOString(),
    clockOffsetMs: 0,
    tables,
    users,
    transcript: [
      {
        at: realNow.toISOString(),
        dir: "system",
        who: "lab",
        text: "Test Lab ready. Made-up practice with 5 patients and 2 practitioners. Nothing here reaches real WhatsApp.",
      },
    ],
  };
}

export function labNow(state: LabState, realNow = Date.now()): Date {
  return new Date(realNow + state.clockOffsetMs);
}

function whoForPhone(phone: string): string {
  const digits = String(phone).replace(/\D/g, "");
  return LAB_PEOPLE.find((p) => p.phone === digits)?.key ?? digits;
}

function render(m: OutboundMessage): Omit<LabLine, "at" | "dir" | "who"> {
  if (m.kind === "text") return { text: m.body };
  if (m.kind === "buttons") return { text: m.body, buttons: m.buttons };
  if (m.kind === "list") return { text: m.body, buttons: m.rows, listLabel: m.buttonLabel };
  const tpl = TEMPLATE_TEXT[m.templateName];
  const ids = m.buttonPayloads ?? [];
  return {
    text: `${tpl ? tpl(m.variables) : `[template ${m.templateName}] ${m.variables.join(" | ")}`}`,
    buttons: ids.length ? ids.map((id) => ({ id, title: id })) : undefined,
  };
}

function captureProvider(lines: LabLine[], now: () => Date): WhatsAppProvider {
  let n = 0;
  return {
    id: "meta",
    verifySignature: async () => true,
    parseWebhook: () => ({ messages: [], statuses: [] }),
    send: async (m: OutboundMessage) => {
      lines.push({ at: now().toISOString(), dir: "out", who: whoForPhone(m.to), ...render(m) });
      n++;
      return { providerMessageId: `wamid.lab.${Date.now()}.${n}` };
    },
    markRead: async () => undefined,
  } as WhatsAppProvider;
}

function eventLine(e: SandboxEvent): LabLine {
  const label: Record<SandboxEvent["kind"], string> = {
    whatsapp: "WhatsApp",
    push: "Push notification",
    email: "Email",
    alert_whatsapp: "Practitioner alert",
    job_note: "Job health note",
  };
  const named = LAB_USER_KEYS[e.to] ?? e.to;
  return { at: e.at, dir: "event", who: named, text: `${label[e.kind]}: ${e.summary}` };
}

async function withLab<T>(
  state: LabState,
  fn: (ctx: {
    admin: any;
    provider: WhatsAppProvider;
    now: () => Date;
    lines: LabLine[];
  }) => Promise<T>,
): Promise<{ state: LabState; lines: LabLine[]; result: T }> {
  const tables: Tables = structuredClone(state.tables);
  const users = structuredClone(state.users);
  const db = memoryDb(tables, users);
  const lines: LabLine[] = [];
  const events: SandboxEvent[] = [];
  const now = () => labNow(state);
  const provider = captureProvider(lines, now);
  const result = await runInSandbox({ events, now, whatsapp: { provider, secrets: SECRETS } }, () =>
    fn({ admin: db.admin, provider, now, lines }),
  );
  const all = [...lines, ...events.map(eventLine)].sort((a, b) => a.at.localeCompare(b.at));
  return {
    state: {
      ...state,
      tables: db.tables,
      users: db.users,
      transcript: [...state.transcript, ...all].slice(-400),
    },
    lines: all,
    result,
  };
}

export interface LabMessage {
  /** LabPerson key. */
  from: string;
  text?: string;
  replyId?: string | null;
  replyTitle?: string | null;
}

/** One message into Buddy, exactly as if it arrived from WhatsApp. */
export async function labSend(state: LabState, msg: LabMessage) {
  const person = LAB_PEOPLE.find((p) => p.key === msg.from);
  if (!person) throw new Error("Unknown Test Lab person");
  const now = labNow(state);
  const text = String(msg.text ?? "").slice(0, 4000);
  const inLine: LabLine = {
    at: now.toISOString(),
    dir: "in",
    who: person.key,
    text: msg.replyId ? `[tapped] ${msg.replyTitle ?? msg.replyId}` : text,
  };
  const withIn = { ...state, transcript: [...state.transcript, inLine] };
  return withLab(withIn, async ({ admin, provider, now: clock }) => {
    const { processPendingInbound } = await import("@/lib/whatsapp/worker.server");
    const id = crypto.randomUUID();
    await admin.from("whatsapp_inbound").insert({
      id,
      provider: "meta",
      provider_message_id: `wamid.labin.${id}`,
      from_phone: `+${person.phone}`,
      kind: msg.replyId ? "interactive" : "text",
      body: msg.replyId ? "" : text,
      reply_id: msg.replyId ?? null,
      reply_title: msg.replyId ? (msg.replyTitle ?? msg.replyId) : null,
      received_at: clock().toISOString(),
      status: "pending",
    });
    return processPendingInbound({ admin, provider, secrets: SECRETS, now: clock });
  });
}

export type LabJump = "1h" | "2h" | "reminder" | "morning" | "evening" | "1d" | "7d";

/** The next time (after now) that it is hh:mm in South Africa. */
function nextSast(now: Date, hh: number, mm: number): Date {
  const sastNow = new Date(now.getTime() + 2 * 3600_000);
  const target = new Date(
    Date.UTC(sastNow.getUTCFullYear(), sastNow.getUTCMonth(), sastNow.getUTCDate(), hh, mm, 30),
  );
  let t = target.getTime() - 2 * 3600_000;
  if (t <= now.getTime()) t += 24 * 3600_000;
  return new Date(t);
}

/**
 * Skip the clock ahead, then run what would have run: the reminder job at
 * reminder time, the morning job at 8am.
 */
export async function labAdvance(state: LabState, jump: LabJump) {
  const now = labNow(state);
  const target =
    jump === "1h"
      ? new Date(now.getTime() + 3600_000)
      : jump === "2h"
        ? new Date(now.getTime() + 2 * 3600_000 + 60_000)
        : jump === "evening"
          ? nextSast(now, 19, 31)
          : jump === "1d"
            ? new Date(now.getTime() + 24 * 3600_000)
            : jump === "7d"
              ? new Date(now.getTime() + 7 * 24 * 3600_000)
              : jump === "reminder"
                ? nextSast(now, 18, 1)
                : nextSast(now, 8, 1);
  const moved: LabState = {
    ...state,
    clockOffsetMs: state.clockOffsetMs + (target.getTime() - now.getTime()),
    transcript: [
      ...state.transcript,
      {
        at: target.toISOString(),
        dir: "system",
        who: "lab",
        text: `Clock moved to ${target.toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })} (South Africa).`,
      },
    ],
  };
  return withLab(moved, async ({ admin, now: clock }) => {
    const ran: string[] = [];
    const { runCheckinReminderTick } = await import("@/lib/whatsapp/checkin-reminder-tick.server");
    const r = await runCheckinReminderTick(admin, clock());
    ran.push(`reminders: ${r.sent} sent, ${r.undelivered} undelivered`);
    // The every-minute jobs: morning note, red flag escalation, daily
    // report, scheduled practitioner updates, Monday summary.
    try {
      const { runPractitionerJobs } = await import("@/lib/whatsapp/practitioner-status.server");
      const { whatsappConfigFromEnv } = await import("@/lib/whatsapp/worker.server");
      const cfg = whatsappConfigFromEnv();
      if (cfg) {
        await runPractitionerJobs(admin, cfg, clock());
        ran.push("minute jobs");
      }
    } catch (e) {
      ran.push(`minute jobs failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
    return ran;
  });
}

/** What the sandbox holds for one patient, for the side panel. */
export function labSnapshot(state: LabState) {
  const t = state.tables;
  return LAB_PEOPLE.filter((p) => p.role === "patient").map((p) => {
    const client = (t.clients ?? []).find((c) => String(c.phone_e164 ?? c.phone) === p.phone);
    const convo = (t.whatsapp_conversations ?? []).find((c) => String(c.phone) === p.phone);
    const reminder = client
      ? (t.checkin_reminders ?? []).find((r) => r.client_id === client.id)
      : null;
    const ins = client
      ? (t.check_ins ?? [])
          .filter((c) => c.client_id === client.id)
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      : [];
    return {
      key: p.key,
      label: p.label,
      exists: Boolean(client),
      archived: Boolean(client?.archived_at),
      state: convo?.state ?? null,
      reminder: reminder
        ? {
            days: reminder.days_of_week,
            time: reminder.time_of_day,
            frequency: reminder.frequency,
            enabled: reminder.enabled,
          }
        : null,
      checkins: ins.length,
      lastCheckin: ins[0]
        ? {
            at: ins[0].created_at,
            pain: ins[0].pain_level,
            sleep: ins[0].sleep_quality,
            energy: ins[0].energy_level,
          }
        : null,
      openAlerts: client
        ? (t.alerts ?? []).filter((a) => a.client_id === client.id && !a.is_read).length
        : 0,
    };
  });
}
