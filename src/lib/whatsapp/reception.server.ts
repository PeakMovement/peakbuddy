/**
 * Reception errands (10 Oct 2026, Justin). Practitioners ask Buddy to pass
 * admin errands to the practice reception number, and Buddy relays
 * reception's answers back to whoever asked.
 *
 *   Zoe:       Ask reception to book Sam Kruger for Thursday afternoon
 *   Buddy:     Done, I've passed that to reception. I'll let you know when they reply.
 *   Reception: (gets "New request from Zoe: ..." with a Done button)
 *   Reception: He can only do Friday
 *   Buddy:     (to Zoe) Reception replied about "Book Sam Kruger...": He can only do Friday
 *   Reception: (taps Done)
 *   Buddy:     (to Zoe) Reception has done it: "Book Sam Kruger..."
 *
 * The reception number is the Lovable secret WHATSAPP_RECEPTION_NUMBER.
 * Outside reception's 24 hour window Buddy uses the approved template
 * WHATSAPP_RECEPTION_TEMPLATE ({{1}} practitioner, {{2}} request, quick
 * reply Done). Without it, the request waits and goes out the moment
 * reception next messages Buddy.
 *
 * A typed reply from reception goes to the request most recently sent to
 * them; the Done button always closes the right one. Requests are admin
 * errands; nothing here is logged beyond counts and masked numbers.
 */
import { log } from "@/lib/log";
import { maskPhone, toE164Digits } from "./phone";
import type { OutboundMessage } from "./provider";
import {
  practitionerContact,
  sendLogged,
  windowOpen,
  type SendEnv,
} from "./practitioner-status.server";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type Db = { from: (t: string) => any };

const MAX_PENDING_DELIVERY = 5;

/** What Buddy says back to reception. */
export type ReplyMsg = { kind: "text"; body: string };

export interface ReceptionRequest {
  id: string;
  practitioner_id: string;
  request_text: string;
  status: "open" | "done";
  created_at: string;
  sent_at: string | null;
  last_reply: string | null;
  replied_at: string | null;
  done_at: string | null;
}

export type SendResult = "sent" | "waiting" | "no_number" | "failed";

/** The reception number from the Lovable secret, as E.164 digits. */
export function receptionPhone(): string | null {
  return toE164Digits(process.env.WHATSAPP_RECEPTION_NUMBER?.trim() || null);
}

export function isReceptionPhone(phone: string | null | undefined): boolean {
  const r = receptionPhone();
  return Boolean(r && phone && toE164Digits(phone) === r);
}

const short = (s: string, n = 60) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 3).trimEnd()}...` : t;
};
/** Template variables can't hold new lines or long runs of spaces. */
const flat = (s: string) =>
  s
    .replace(/[\r\n\t]+/g, "; ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[.;\s]+$/, "")
    .slice(0, 500);

function ago(at: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(at).getTime()) / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export const RECEPTION_MSG = {
  toPractitioner: (r: SendResult) =>
    r === "sent"
      ? "Done, I've passed that to reception. I'll let you know when they reply."
      : r === "waiting"
        ? "Got it. Reception hasn't messaged me in the last day, so WhatsApp won't let me message them first. I've saved it and they'll get it the moment they next message Buddy."
        : r === "no_number"
          ? "Reception isn't set up on Buddy yet, so I couldn't pass that on."
          : "Sorry, something went wrong passing that to reception. Please try again in a minute.",
  forward: (name: string, task: string) =>
    `New request from ${name}:\n\n${task}\n\nReply here and I'll pass your answer to ${name}, or tap Done when it's sorted.`,
  relayReply: (task: string, reply: string) =>
    `Reception replied about "${short(task)}":\n\n${reply}`,
  relayDone: (task: string) => `Reception has done it: "${short(task)}" ✅`,
  passed: (name: string, task: string, several: boolean) =>
    several ? `Passed to ${name} (about "${short(task, 40)}").` : `Passed to ${name}.`,
  doneThanks: (name: string) => `Thanks, I've let ${name} know it's done.`,
  alreadyDone: "That one's already marked done, thanks.",
  nothingOpen:
    "Thanks! There aren't any open requests from the practitioners right now, so I haven't passed that on.",
  noneOpenHello: (greeting: string) =>
    `${greeting}! No open requests from the practitioners right now.`,
  whichDone:
    'There\'s more than one open request. Tap Done on the one that\'s sorted, or reply "done 1", "done 2" and so on.',
  textOnly: "Sorry, I can only pass on typed messages for now.",
  ack: "\u{1F44D}",
};

async function loadOpen(adminIn: Admin): Promise<ReceptionRequest[]> {
  const admin = adminIn as unknown as Db;
  const { data } = await admin
    .from("reception_requests")
    .select("*")
    .eq("status", "open")
    .limit(200);
  return ((data ?? []) as ReceptionRequest[]).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

async function nameOf(adminIn: Admin, userId: string): Promise<string> {
  const admin = adminIn as unknown as Db;
  const { data } = await admin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return (
    String((data as { full_name?: string | null } | null)?.full_name ?? "")
      .trim()
      .split(/\s+/)[0] || "the practitioner"
  );
}

function forwardMessage(to: string, name: string, r: ReceptionRequest): OutboundMessage {
  return {
    kind: "buttons",
    to,
    body: RECEPTION_MSG.forward(name, r.request_text),
    buttons: [{ id: `rcp_done_${r.id}`, title: "Done" }],
  };
}

async function markSent(adminIn: Admin, id: string, now: Date) {
  const admin = adminIn as unknown as Db;
  await admin
    .from("reception_requests")
    .update({ sent_at: now.toISOString() })
    .eq("id", id)
    .select("id")
    .limit(1);
}

/** A practitioner's errand: save it, then send it to reception if WhatsApp allows. */
export async function sendToReception(
  adminIn: Admin,
  env: SendEnv,
  args: { practitionerId: string; practitionerName: string; task: string; now: Date },
): Promise<SendResult> {
  const admin = adminIn as unknown as Db;
  const phone = receptionPhone();
  if (!phone) return "no_number";
  const row: ReceptionRequest = {
    id: crypto.randomUUID(),
    practitioner_id: args.practitionerId,
    request_text: args.task.slice(0, 1000),
    status: "open",
    created_at: args.now.toISOString(),
    sent_at: null,
    last_reply: null,
    replied_at: null,
    done_at: null,
  };
  const { error } = await admin.from("reception_requests").insert(row);
  if (error) {
    log.warn("reception request not saved", { error: String(error.message ?? error) });
    return "failed";
  }
  if (await windowOpen(adminIn, phone, args.now)) {
    const ok = await sendLogged(
      adminIn,
      env,
      forwardMessage(phone, args.practitionerName, row),
      "[reception request]",
    );
    if (ok) await markSent(adminIn, row.id, args.now);
    return ok ? "sent" : "failed";
  }
  const template = process.env.WHATSAPP_RECEPTION_TEMPLATE?.trim();
  if (!template) {
    log.info("reception request waiting: window closed and no template", { to: maskPhone(phone) });
    return "waiting";
  }
  const ok = await sendLogged(
    adminIn,
    env,
    {
      kind: "template",
      to: phone,
      templateName: template,
      languageCode: process.env.WHATSAPP_RECEPTION_TEMPLATE_LANG?.trim() || "en",
      variables: [args.practitionerName, flat(row.request_text)],
      buttonPayloads: [`rcp_done_${row.id}`],
    },
    `[reception template ${template}]`,
  );
  if (ok) await markSent(adminIn, row.id, args.now);
  return ok ? "sent" : "failed";
}

/** Tell the practitioner who asked: WhatsApp in their window, otherwise a push. */
async function tellPractitioner(
  adminIn: Admin,
  env: SendEnv,
  userId: string,
  body: string,
  now: Date,
): Promise<void> {
  const contact = await practitionerContact(adminIn, userId);
  if (contact.phone && (await windowOpen(adminIn, contact.phone, now))) {
    const ok = await sendLogged(
      adminIn,
      env,
      { kind: "text", to: contact.phone, body },
      "[reception relay]",
    );
    if (ok) return;
  }
  try {
    const { sendPushCore } = await import("@/lib/push.functions");
    await sendPushCore(adminIn as never, {
      userId,
      title: "Reception replied",
      body: short(body, 160),
      data: { kind: "reception" },
    });
  } catch (e) {
    log.warn("reception relay push failed", { error: e instanceof Error ? e.message : "unknown" });
  }
}

type Talk = "greeting" | "ack" | "list" | null;
function receptionTalk(text: string): Talk {
  const t = text.trim();
  if (
    /^(hi|hello|hey|hiya|howzit|morning|good\s+(morning|afternoon|evening))\b[\s,!.]*(buddy)?[\s,!.]*$/i.test(
      t,
    )
  )
    return "greeting";
  if (
    /^(ok(ay)?|k|thanks?|thank\s*you|thx|ty|cheers|great|cool|perfect|noted|got it|on it|will do|sure|\u{1F44D}|\u{1F64F}|\u{1F44C})[\s.!\u{1F44D}\u{1F64F}]*$/iu.test(
      t,
    )
  )
    return "ack";
  if (
    /\b(what'?s|whats|what\s+is|any(thing)?)\b[\s\S]{0,20}\b(open|outstanding|pending|waiting)\b|^\s*(list|requests|open|tasks)\s*[?.!]*\s*$/i.test(
      t,
    )
  )
    return "list";
  return null;
}

function listBody(open: ReceptionRequest[], names: Map<string, string>, now: Date): string {
  const lines = [`Open requests (${open.length}):`];
  open.forEach((r, i) =>
    lines.push(
      `${i + 1}. From ${names.get(r.practitioner_id) ?? "a practitioner"}, ${ago(r.created_at, now)}: ${short(r.request_text, 120)}`,
    ),
  );
  lines.push("", 'Reply "done 1" (or the number) when one is sorted.');
  return lines.join("\n");
}

async function closeRequest(
  adminIn: Admin,
  env: SendEnv,
  r: ReceptionRequest,
  now: Date,
  reply: (m: ReplyMsg) => Promise<void>,
) {
  const admin = adminIn as unknown as Db;
  if (r.status === "done") {
    await reply({ kind: "text", body: RECEPTION_MSG.alreadyDone });
    return;
  }
  await admin
    .from("reception_requests")
    .update({ status: "done", done_at: now.toISOString() })
    .eq("id", r.id)
    .select("id")
    .limit(1);
  const name = await nameOf(adminIn, r.practitioner_id);
  await tellPractitioner(
    adminIn,
    env,
    r.practitioner_id,
    RECEPTION_MSG.relayDone(r.request_text),
    now,
  );
  await reply({ kind: "text", body: RECEPTION_MSG.doneThanks(name) });
}

/** Anything reception sends Buddy. Never touches patient conversations. */
export async function handleReceptionMessage(
  adminIn: Admin,
  msg: { text: string; replyId: string | null; isMedia: boolean },
  deps: SendEnv & {
    now: Date;
    phone: string;
    reply: (m: ReplyMsg) => Promise<void>;
  },
): Promise<void> {
  const admin = adminIn as unknown as Db;
  const env: SendEnv = { provider: deps.provider, secrets: deps.secrets };
  const { now } = deps;
  let open = await loadOpen(adminIn);
  const names = new Map<string, string>();
  for (const id of new Set(open.map((r) => r.practitioner_id)))
    names.set(id, await nameOf(adminIn, id));

  // Requests that waited for reception's window: it's open now.
  const waiting = open.filter((r) => !r.sent_at).slice(0, MAX_PENDING_DELIVERY);
  for (const r of waiting) {
    const ok = await sendLogged(
      adminIn,
      env,
      forwardMessage(deps.phone, names.get(r.practitioner_id) ?? "a practitioner", r),
      "[reception request, delayed]",
    );
    if (ok) {
      await markSent(adminIn, r.id, now);
      r.sent_at = now.toISOString();
    }
  }

  // Done button.
  const doneId = msg.replyId?.match(/^rcp_done_([0-9a-f-]{36})$/i)?.[1];
  if (doneId) {
    const { data } = await admin
      .from("reception_requests")
      .select("*")
      .eq("id", doneId)
      .maybeSingle();
    if (!data) {
      await deps.reply({ kind: "text", body: RECEPTION_MSG.alreadyDone });
      return;
    }
    await closeRequest(adminIn, env, data as ReceptionRequest, now, deps.reply);
    return;
  }

  const text = String(msg.text ?? "").trim();
  if (!text) {
    if (msg.isMedia) await deps.reply({ kind: "text", body: RECEPTION_MSG.textOnly });
    return;
  }

  // "done 2", "2 done", or "done" with only one open.
  const doneNum = text.match(
    /^\s*(?:done|sorted|finished|complete[d]?)\s*#?(\d{1,2})\s*[.!]*\s*$|^\s*#?(\d{1,2})\s+(?:is\s+)?(?:done|sorted)\s*[.!]*\s*$/i,
  );
  if (doneNum) {
    const n = Number(doneNum[1] ?? doneNum[2]);
    const r = open[n - 1];
    if (!r)
      await deps.reply({
        kind: "text",
        body: open.length ? listBody(open, names, now) : RECEPTION_MSG.noneOpenHello("Hi"),
      });
    else await closeRequest(adminIn, env, r, now, deps.reply);
    return;
  }
  if (/^\s*(?:all\s+)?(?:done|sorted|finished|completed?)\s*[.!✅]*\s*$/i.test(text)) {
    if (open.length === 1) await closeRequest(adminIn, env, open[0], now, deps.reply);
    else if (!open.length)
      await deps.reply({ kind: "text", body: RECEPTION_MSG.noneOpenHello("Thanks") });
    else
      await deps.reply({
        kind: "text",
        body: `${RECEPTION_MSG.whichDone}\n\n${listBody(open, names, now)}`,
      });
    return;
  }

  const talk = receptionTalk(text);
  if (talk === "ack") {
    await deps.reply({ kind: "text", body: RECEPTION_MSG.ack });
    return;
  }
  if (talk === "greeting" || talk === "list") {
    open = open.filter((r) => r.status === "open");
    const greeting = /morning/i.test(text)
      ? "Morning"
      : /afternoon/i.test(text)
        ? "Afternoon"
        : "Hi";
    await deps.reply({
      kind: "text",
      body: open.length
        ? `${talk === "greeting" ? `${greeting}! ` : ""}${listBody(open, names, now)}`
        : RECEPTION_MSG.noneOpenHello(greeting),
    });
    return;
  }

  // A typed answer: to the request most recently sent to reception.
  const target = open
    .filter((r) => r.sent_at)
    .sort((a, b) => new Date(b.sent_at!).getTime() - new Date(a.sent_at!).getTime())[0];
  if (!target) {
    await deps.reply({ kind: "text", body: RECEPTION_MSG.nothingOpen });
    return;
  }
  const replyText = text.slice(0, 2000);
  await admin
    .from("reception_requests")
    .update({ last_reply: replyText, replied_at: now.toISOString() })
    .eq("id", target.id)
    .select("id")
    .limit(1);
  await tellPractitioner(
    adminIn,
    env,
    target.practitioner_id,
    RECEPTION_MSG.relayReply(target.request_text, replyText),
    now,
  );
  await deps.reply({
    kind: "text",
    body: RECEPTION_MSG.passed(
      names.get(target.practitioner_id) ?? "the practitioner",
      target.request_text,
      open.filter((r) => r.sent_at).length > 1,
    ),
  });
}

/** "What's open with reception?" for one practitioner. */
export async function practitionerOpenList(
  adminIn: Admin,
  userId: string,
  now: Date,
): Promise<string> {
  const open = (await loadOpen(adminIn)).filter((r) => r.practitioner_id === userId);
  if (!open.length) return "Nothing open with reception for you right now.";
  const lines = [`Open with reception (${open.length}):`];
  for (const r of open) {
    const state = !r.sent_at
      ? "waiting for reception to message Buddy"
      : r.last_reply
        ? `last reply ${ago(r.replied_at ?? r.sent_at, now)}: "${short(r.last_reply, 80)}"`
        : `sent ${ago(r.sent_at, now)}, no reply yet`;
    lines.push(`• ${short(r.request_text, 80)} (${state})`);
  }
  return lines.join("\n");
}
