/**
 * Practitioner mode (stage 2, 9 Oct 2026). Buddy recognises a practitioner's
 * registered mobile and lets them tell it when they've sent a patient their
 * exercise programme:
 *
 *   Zoe:   I've sent Sam Kruger his programme
 *   Buddy: Perfect, I'll let Sam know.            (patient on Buddy)
 *          Sorry, Sam isn't registered on Buddy yet. Here's the link to forward: ...
 *
 * The patient is found among that practitioner's own patients (or, for a
 * practice owner or member, the practice's). Two possible matches: Buddy asks
 * which, with the choice carrying the patient id. Nothing is ever sent to a
 * patient outside the practitioner's list.
 *
 * Patient delivery: WhatsApp inside the 24 hour window; outside it the
 * approved template WHATSAPP_PROGRAMME_TEMPLATE when set; otherwise a push in
 * the app for app users; otherwise Buddy says honestly it can't reach them.
 */
import { log } from "@/lib/log";
import { HEIDI_MSG } from "./heidi";
import { handleHeidiTurn, heidiConfig } from "./heidi.server";
import { maskPhone, toE164Digits } from "./phone";
import type { OutboundMessage, ProviderSecrets, WhatsAppProvider } from "./provider";
import {
  bareReception,
  blocksOutbound,
  expireMemory,
  fixPractitionerTypos,
  isCancel,
  isYes,
  normalizePractitionerText,
  prettyTask,
  programmeConfidence,
  PROGRAMME_SENT,
  rankPatients,
  readPractitionerHeidi,
  tidyErrand,
  type PracMemory,
} from "./practitioner-understand";

export { PROGRAMME_SENT };

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type Db = { from: (t: string) => any; auth: Admin["auth"] };
type Outgoing = OutboundMessage extends infer T
  ? T extends unknown
    ? Omit<T, "to">
    : never
  : never;

const WINDOW_MS = 24 * 60 * 60 * 1000 - 2 * 60 * 1000;
const CACHE_MS = 10 * 60 * 1000;
export const JOIN_LINK = "https://wa.me/27675724314?text=JOIN-PEAK";

export interface Practitioner {
  userId: string;
  firstName: string;
}

let cache: { at: number; map: Map<string, Practitioner> } | null = null;

/** Registered practitioner mobiles, by E.164 digits. Cached for 10 minutes. */
export async function practitionerByPhone(
  adminIn: Admin,
  phone: string,
  now = Date.now(),
): Promise<Practitioner | null> {
  if (!cache || now - cache.at > CACHE_MS) {
    const admin = adminIn as unknown as Db;
    const map = new Map<string, Practitioner>();
    try {
      const { data: profs } = await admin
        .from("profiles")
        .select("id, full_name, role")
        // Owners and super admins (Justin) are recognised too.
        .in("role", ["practitioner", "super_admin", "admin"])
        .limit(500);
      const names = new Map(
        ((profs ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [
          p.id,
          String(p.full_name ?? "")
            .trim()
            .split(/\s+/)[0] || "there",
        ]),
      );
      for (let page = 1; page <= 10; page++) {
        const { data } = await adminIn.auth.admin.listUsers({ page, perPage: 1000 });
        const users = data?.users ?? [];
        for (const u of users) {
          const digits = toE164Digits(u.phone ?? null);
          if (digits && names.has(u.id))
            map.set(digits, { userId: u.id, firstName: names.get(u.id)! });
        }
        if (users.length < 1000) break;
      }
    } catch (e) {
      log.warn("practitioner lookup failed", { error: e instanceof Error ? e.message : "unknown" });
    }
    cache = { at: now, map };
  }
  return cache.map.get(phone) ?? null;
}

/** For tests. */
export function resetPractitionerCache(): void {
  cache = null;
}

export interface PatientRow {
  id: string;
  full_name: string | null;
}

/**
 * Which of the practitioner's patients the message names. Full name beats
 * first and last name anywhere, which beats a first name alone. Ties at the
 * best level are returned together so Buddy can ask.
 */
export function matchPatients(text: string, patients: PatientRow[]): PatientRow[] {
  const words = new Set(
    text
      .toLowerCase()
      .replace(/['’]s\b/g, "")
      .split(/[^\p{L}'-]+/u)
      .filter(Boolean),
  );
  const lower = text.toLowerCase();
  const scored = patients
    .map((p) => {
      const parts = String(p.full_name ?? "")
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 2);
      if (!parts.length) return { p, score: 0 };
      const first = parts[0];
      const last = parts.length > 1 ? parts[parts.length - 1] : null;
      let score = 0;
      if (parts.length > 1 && lower.includes(parts.join(" "))) score = 3;
      else if (last && words.has(first) && words.has(last)) score = 2;
      else if (words.has(first)) score = 1;
      return { p, score };
    })
    .filter((x) => x.score > 0);
  const best = Math.max(0, ...scored.map((x) => x.score));
  return scored.filter((x) => x.score === best).map((x) => x.p);
}

const firstOf = (n: string | null | undefined) =>
  String(n ?? "")
    .trim()
    .split(/\s+/)[0] || "there";

/** Short replies so "thanks" or "ok" doesn't get the whole menu back. */
export type SmallTalk = "thanks" | "ack" | "greeting" | "help" | null;

export function smallTalk(text: string): SmallTalk {
  const t = String(text ?? "").trim();
  if (!t) return null;
  if (/\b(help|menu|commands|options)\b|what (else )?can you do|what do you do/i.test(t))
    return "help";
  if (
    t.length <= 60 &&
    /^(thanks?|thank\s*you|thanx|thx|ty|cheers|ta|much appreciated|appreciate it)\b/i.test(t)
  )
    return "thanks";
  if (
    /^(hi|hello|hey|hiya|howzit|yo|morning|good (morning|afternoon|evening))\b[\s,!.]*(buddy)?[\s,!.]*$/i.test(
      t,
    )
  )
    return "greeting";
  if (
    /^(?:ok(?:ay)?|k|great|cool|perfect|nice|awesome|sure|got it|noted|sounds good|good|lovely|brilliant|alright|all good|will do|thumbs up|\u{1F44D}|\u{1F44C}|\u{1F64F})(?:\s+(?:great|cool|perfect|nice|awesome|lovely|brilliant|buddy))?[\s.!\u{1F44D}\u{1F44C}\u{1F64F}]*$/iu.test(
      t,
    )
  )
    return "ack";
  return null;
}

const THANKS_REPLIES = [
  (n: string) => `Any time, ${n}.`,
  (n: string) => `My pleasure, ${n}.`,
  (n: string) => `Happy to help, ${n}.`,
];

export const PRAC_MSG = {
  thanks: (name: string, now: Date) =>
    THANKS_REPLIES[now.getUTCMinutes() % THANKS_REPLIES.length](name),
  ack: "\u{1F44D}",
  notSure: (_name: string) =>
    `Sorry, I didn't quite get that.\nTry "how are my clients doing?", a client's name, "my messages", "who checked in this week?" or "ask reception to…".`,
  confirm: (line: string) => `Did you mean: ${line}?`,
  confirmNo: "Okay, I won't.",
  receptionAsk: "What should I pass on to reception?",
  receptionCancelled: "Okay, I won't pass anything to reception.",
  help: (name: string) =>
    `Hi ${name}, you're messaging Buddy as a practitioner. Here's what I can do:\n\n` +
    `• "How are my clients doing?" for a quick status of all your clients\n` +
    `• "How is Sam Kruger doing?", or just "Sam Kruger", for one client\n` +
    `• "Sam's messages" to read what's open for them in full and mark it reviewed. "My messages" for everything waiting\n` +
    `• "Tell Sam well done on his race" to send Sam a message. I'll show you the words first and pass their reply back to you\n` +
    `• "Who checked in this week?" (or today, yesterday, since Monday)\n` +
    `• "Check in with Sam Kruger" and I'll ask them for a check-in, then send you their answers\n` +
    `• "Update me daily at 7am" (or weekdays, every Monday, every morning, stop updates)\n` +
    `• "I've sent Sam Kruger his programme" and I'll let them know\n` +
    `• "Ask reception to book Sam for Thursday" and I'll pass it to reception\n` +
    `• "What's open with reception?" to see what's still waiting. Just "reception" and I'll ask what to pass on\n\n` +
    `Practice owners can also ask "practice overview", "any red flags?", "who's gone quiet?" or "how many clients are using Buddy?"`,
  notFound: (name: string) =>
    `I couldn't find a patient matching that on your list, ${name}. Try their first and last name, for example "I've sent Sam Kruger his programme".`,
  which: "I found more than one patient with that name. Which one did you mean?",
  willTell: (patient: string) => `Perfect, I'll let ${patient} know.`,
  toldInApp: (patient: string) =>
    `Done, ${patient} isn't on WhatsApp with Buddy, so I've sent them a notification in the Buddy app instead.`,
  notRegistered: (patient: string) =>
    `Sorry, ${patient} isn't registered on Buddy yet, so I can't let them know. If you'd like them to join, forward them this link:\n\n${JOIN_LINK}`,
  cantReachYet: (patient: string) =>
    `${patient} is on Buddy, but hasn't messaged in the last day, so WhatsApp won't let me message them first right now. I'll pass it on as soon as they next check in.`,
  checkinAsked: (patient: string) =>
    `Done, I've asked ${patient} to check in. I'll send you their answers when they reply.`,
  checkinBusy: (patient: string) =>
    `${patient} is in the middle of a check-in with me right now. I'll send you their answers when they finish.`,
  checkinApp: (patient: string) =>
    `${patient} uses the Buddy app, so I've sent them a notification to check in. I'll send you their answers when they do.`,
  checkinUnreachable: (patient: string) =>
    `${patient} hasn't messaged me in over a day, so WhatsApp won't let me message them first. A quick message from you may get them going again.`,
  notRegisteredCheckin: (patient: string) =>
    `${patient} isn't on Buddy yet, so I can't ask them to check in. If you'd like them to join, forward them this link:\n\n${JOIN_LINK}`,
  notFoundAny: (name: string) =>
    `I couldn't find a client matching that on your list, ${name}. Try their first and last name, for example "how is Sam Kruger doing".`,
  failed: (patient: string) =>
    `Sorry, something went wrong sending that to ${patient}. Please try again in a minute.`,
  patient: (patient: string, practitioner: string) =>
    `Hi ${patient}, ${practitioner} has sent you your exercise programme. Have a look when you can, and reply here if anything's unclear.`,
};

export interface PractitionerDeps {
  provider: WhatsAppProvider;
  secrets: ProviderSecrets;
  /** Reply to the practitioner. */
  reply: (message: Outgoing) => Promise<void>;
  now: Date;
  /** Start a check-in for a patient (the worker's reminder path). */
  requestCheckin?: (
    clientId: string,
  ) => Promise<"sent" | "not_whatsapp" | "busy" | "window_closed" | "failed">;
}

async function practitionerPatients(admin: Db, userId: string): Promise<PatientRow[]> {
  const [{ data: owned }, { data: memberOf }] = await Promise.all([
    admin.from("practices").select("id").eq("practitioner_id", userId),
    admin
      .from("practice_members")
      .select("practice_id")
      .eq("user_id", userId)
      .eq("status", "active"),
  ]);
  const practiceIds = [
    ...((owned ?? []) as Array<{ id: string }>).map((p) => p.id),
    ...((memberOf ?? []) as Array<{ practice_id: string }>).map((m) => m.practice_id),
  ];
  const own = await admin
    .from("clients")
    .select("id, full_name")
    .eq("practitioner_id", userId)
    .limit(2000);
  const inPractice = practiceIds.length
    ? await admin.from("clients").select("id, full_name").in("practice_id", practiceIds).limit(5000)
    : { data: [] };
  const all = new Map<string, PatientRow>();
  for (const r of [
    ...((own.data ?? []) as PatientRow[]),
    ...((inPractice.data ?? []) as PatientRow[]),
  ]) {
    all.set(r.id, r);
  }
  return [...all.values()];
}

const CONFIRM_BUTTONS = [
  { id: "prac_cfm_yes", title: "Yes" },
  { id: "prac_cfm_no", title: "No" },
];
const HELP_BUTTONS = [
  { id: "prac_status", title: "How are my clients" },
  { id: "prac_updates", title: "Regular updates" },
];
const NOT_SURE_BUTTONS = [
  { id: "prac_status", title: "How are my clients" },
  { id: "prac_help", title: "What can you do" },
];

function interruptsErrand(text: string): boolean {
  if (smallTalk(text) || smallTalk(normalizePractitionerText(text))) return true;
  if (programmeConfidence(text) === "high") return true;
  return false;
}

type NameKind = "checkin" | "status_one" | "programme";

function confirmLine(kind: NameKind, fullName: string): string {
  if (kind === "checkin") return `check in with ${fullName}`;
  if (kind === "programme") return `tell ${fullName} their programme is ready`;
  return `how is ${fullName} doing`;
}

/**
 * One confident name: use them. A fuzzy name, or a loose outbound phrasing:
 * ask first. Several names: ask which. Nothing is sent until they pick.
 */
async function resolveNamed(
  mem: PracMemory,
  deps: PractitionerDeps,
  kind: NameKind,
  text: string,
  patients: PatientRow[],
  forceMedium: boolean,
): Promise<{ target: PatientRow | null; asked: boolean }> {
  const hits = rankPatients(text, patients);
  if (hits.length > 1) {
    const prefix = kind === "checkin" ? "prac_ci_" : kind === "programme" ? "prog_" : "prac_one_";
    await deps.reply({
      kind: "list",
      body: PRAC_MSG.which,
      buttonLabel: "Choose",
      rows: hits.slice(0, 10).map((h) => ({
        id: `${prefix}${h.patient.id}`,
        title: String(h.patient.full_name ?? "Patient").slice(0, 24),
      })),
    });
    return { target: null, asked: true };
  }
  if (hits.length === 1) {
    const hit = hits[0];
    const medium = forceMedium || hit.confidence === "medium";
    const outbound = kind === "checkin" || kind === "programme";
    if (medium && (outbound || hit.confidence === "medium")) {
      const full = String(hit.patient.full_name ?? "").trim() || "them";
      const line = confirmLine(kind, full);
      mem.confirm = { kind, clientId: hit.patient.id, line };
      mem.confirmAt = deps.now.getTime();
      mem.awaitingReception = false;
      await deps.reply({ kind: "buttons", body: PRAC_MSG.confirm(line), buttons: CONFIRM_BUTTONS });
      return { target: null, asked: true };
    }
    return { target: hit.patient, asked: false };
  }
  return { target: null, asked: false };
}

/** Returns false when the message isn't something for practitioner mode. */
export async function handlePractitionerMessage(
  adminIn: Admin,
  prac: Practitioner,
  msg: { text: string; replyId: string | null },
  deps: PractitionerDeps,
  memory?: PracMemory,
): Promise<boolean> {
  const mem: PracMemory = memory ?? {};
  expireMemory(mem, deps.now.getTime());
  const admin = adminIn as unknown as Db;

  const passErrand = async (task: string) => {
    const rc = await import("./reception.server");
    const result = await rc.sendToReception(
      adminIn,
      { provider: deps.provider, secrets: deps.secrets },
      {
        practitionerId: prac.userId,
        practitionerName: prac.firstName,
        task,
        now: deps.now,
      },
    );
    await deps.reply({ kind: "text", body: rc.RECEPTION_MSG.toPractitioner(result) });
  };

  const accepting =
    msg.replyId === "prac_cfm_yes" || Boolean(mem.confirm && !msg.replyId && isYes(msg.text));
  if (accepting) {
    const c = mem.confirm;
    mem.confirm = null;
    mem.awaitingReception = false;
    if (!c) {
      await deps.reply({
        kind: "buttons",
        body: PRAC_MSG.notSure(prac.firstName),
        buttons: NOT_SURE_BUTTONS,
      });
      return true;
    }
    if (c.kind === "reception") {
      await passErrand(c.task);
      return true;
    }
    const replyId =
      c.kind === "checkin"
        ? `prac_ci_${c.clientId}`
        : c.kind === "programme"
          ? `prog_${c.clientId}`
          : `prac_one_${c.clientId}`;
    return handlePractitionerMessage(adminIn, prac, { text: "", replyId }, deps, mem);
  }
  if (msg.replyId === "prac_cfm_no" || Boolean(mem.confirm && !msg.replyId && isCancel(msg.text))) {
    mem.confirm = null;
    mem.awaitingReception = false;
    await deps.reply({ kind: "text", body: PRAC_MSG.confirmNo });
    return true;
  }
  if (mem.confirm && !msg.replyId) mem.confirm = null;

  // Heidi is a read of a client's notes. Same feature flag as before:
  // nothing here runs until the three Heidi secrets are set. A messy
  // phrase still has to match a Heidi command; a fuzzy name is not enough.
  const heidiCmd = heidiConfig() ? readPractitionerHeidi(msg.text, msg.replyId) : null;
  if (heidiCmd) {
    mem.confirm = null;
    mem.awaitingReception = false;
    const patients = await practitionerPatients(admin, prac.userId);
    await handleHeidiTurn(adminIn, prac, heidiCmd, patients, deps);
    return true;
  }

  // They tapped "Reply to Nicola": this message goes to Nicola as typed.
  if (mem.replyTo && !msg.replyId && msg.text.trim()) {
    const clientId = mem.replyTo;
    mem.replyTo = null;
    if (isCancel(msg.text)) {
      const pq = await import("./patient-questions.server");
      await deps.reply({ kind: "text", body: pq.MESSAGE_MSG.cancelled });
      return true;
    }
    await sendTyped(adminIn, prac, clientId, msg.text.trim(), deps, mem);
    return true;
  }

  // They were asked what to tell reception. The next line is the errand,
  // unless it is clearly a different command or small talk.
  if (mem.awaitingReception && !msg.replyId) {
    const { practitionerIntent } = await import("./practitioner-status.server");
    const pendingIntent = practitionerIntent(msg.text, null);
    const otherCommand =
      interruptsErrand(msg.text) ||
      (pendingIntent.kind !== "other" &&
        pendingIntent.kind !== "reception" &&
        pendingIntent.kind !== "reception_ask" &&
        pendingIntent.kind !== "reception_confirm");
    if (otherCommand) mem.awaitingReception = false;
    else if (isCancel(msg.text)) {
      mem.awaitingReception = false;
      await deps.reply({ kind: "text", body: PRAC_MSG.receptionCancelled });
      return true;
    } else if (bareReception(msg.text) || isYes(msg.text)) {
      mem.awaitingReception = true;
      mem.awaitingReceptionAt = deps.now.getTime();
      await deps.reply({ kind: "text", body: PRAC_MSG.receptionAsk });
      return true;
    } else {
      const task =
        pendingIntent.kind === "reception"
          ? pendingIntent.task
          : tidyErrand(fixPractitionerTypos(msg.text));
      mem.awaitingReception = false;
      if (!task) {
        mem.awaitingReception = true;
        mem.awaitingReceptionAt = deps.now.getTime();
        await deps.reply({ kind: "text", body: PRAC_MSG.receptionAsk });
        return true;
      }
      await passErrand(task);
      return true;
    }
  }

  const picked = msg.replyId?.match(/^prog_([0-9a-f-]{36})$/i)?.[1] ?? null;
  if (!picked) {
    const { practitionerIntent } = await import("./practitioner-status.server");
    const intent = practitionerIntent(msg.text, msg.replyId);
    if (intent.kind === "reception_ask") {
      mem.confirm = null;
      mem.awaitingReception = true;
      mem.awaitingReceptionAt = deps.now.getTime();
      await deps.reply({ kind: "text", body: PRAC_MSG.receptionAsk });
      return true;
    }
    if (intent.kind === "reception_confirm") {
      mem.awaitingReception = false;
      const line = `ask reception to ${prettyTask(intent.task)}`;
      mem.confirm = { kind: "reception", task: intent.task, line };
      mem.confirmAt = deps.now.getTime();
      await deps.reply({ kind: "buttons", body: PRAC_MSG.confirm(line), buttons: CONFIRM_BUTTONS });
      return true;
    }
    if (intent.kind !== "other") {
      await handleStatusIntent(adminIn, prac, msg.text, intent, deps, mem);
      return true;
    }
  }
  const prog = picked ? "high" : programmeConfidence(msg.text);
  if (!picked && prog == null) {
    const talk =
      msg.replyId === "prac_help"
        ? "help"
        : (smallTalk(msg.text) ?? smallTalk(normalizePractitionerText(msg.text)));
    if (talk === "thanks") {
      await deps.reply({ kind: "text", body: PRAC_MSG.thanks(prac.firstName, deps.now) });
    } else if (talk === "ack") {
      await deps.reply({ kind: "text", body: PRAC_MSG.ack });
    } else if (talk === "help" || talk === "greeting") {
      await deps.reply({
        kind: "buttons",
        body: PRAC_MSG.help(prac.firstName) + (heidiConfig() ? `\n${HEIDI_MSG.helpLine}` : ""),
        buttons: HELP_BUTTONS,
      });
    } else if (
      msg.text.trim().split(/\s+/).length >= 2 &&
      !blocksOutbound(msg.text) &&
      (await offerToPassOn(adminIn, prac, msg.text.trim(), deps, mem))
    ) {
      // In a conversation with a client: offered to pass this on.
    } else {
      // A client's name on its own ("Lauren Ogg", "Lauren off") brings up
      // that client. A longer message that only mentions a name asks first.
      // Not for something Buddy can't do or was told not to ("call Thea",
      // "don't check in with Sam"), nor a Heidi request while Heidi is off:
      // those stay a "didn't get that".
      const notJustAName =
        blocksOutbound(msg.text) ||
        Boolean(readPractitionerHeidi(msg.text, null)) ||
        /\b(?:don'?t|do\s+not|never|call|phone|ring|text|sms|e-?mail|book|send|tell|ask|remind|invoice|bill|files?|filez|records?|documents?|chart)\b/i.test(
          msg.text,
        );
      const patients = notJustAName ? [] : await practitionerPatients(admin, prac.userId);
      if (patients.length && rankPatients(msg.text, patients).length) {
        const { isShortMessage } = await import("./practitioner-inbox-text");
        const hits = rankPatients(msg.text, patients);
        if (!isShortMessage(msg.text) && hits.length === 1) {
          // A longer sentence that happens to mention a client: ask first.
          const line = confirmLine(
            "status_one",
            String(hits[0].patient.full_name ?? "").trim() || "them",
          );
          mem.confirm = { kind: "status_one", clientId: hits[0].patient.id, line };
          mem.confirmAt = deps.now.getTime();
          await deps.reply({
            kind: "buttons",
            body: PRAC_MSG.confirm(line),
            buttons: CONFIRM_BUTTONS,
          });
          return true;
        }
        const resolved = await resolveNamed(mem, deps, "status_one", msg.text, patients, false);
        if (resolved.asked) return true;
        if (resolved.target) {
          await handleStatusIntent(
            adminIn,
            prac,
            msg.text,
            { kind: "status_one", clientId: resolved.target.id },
            deps,
            mem,
          );
          return true;
        }
      }
      await deps.reply({
        kind: "buttons",
        body: PRAC_MSG.notSure(prac.firstName),
        buttons: NOT_SURE_BUTTONS,
      });
    }
    return true;
  }

  const patients = await practitionerPatients(admin, prac.userId);
  let target: PatientRow | null = null;
  if (picked) {
    target = patients.find((p) => p.id === picked) ?? null;
  } else {
    const resolved = await resolveNamed(
      mem,
      deps,
      "programme",
      msg.text,
      patients,
      prog === "medium",
    );
    if (resolved.asked) return true;
    target = resolved.target;
  }
  if (!target) {
    await deps.reply({ kind: "text", body: PRAC_MSG.notFound(prac.firstName) });
    return true;
  }

  const name = firstOf(target.full_name);
  const result = await tellPatient(adminIn, target, prac, deps);
  const body =
    result === "whatsapp"
      ? PRAC_MSG.willTell(name)
      : result === "app"
        ? PRAC_MSG.toldInApp(name)
        : result === "not_registered"
          ? PRAC_MSG.notRegistered(name)
          : result === "later"
            ? PRAC_MSG.cantReachYet(name)
            : PRAC_MSG.failed(name);
  await deps.reply({ kind: "text", body });
  return true;
}

type TellResult = "whatsapp" | "app" | "not_registered" | "later" | "failed";

async function tellPatient(
  adminIn: Admin,
  patient: PatientRow,
  prac: Practitioner,
  deps: PractitionerDeps,
): Promise<TellResult> {
  const admin = adminIn as unknown as Db;
  const name = firstOf(patient.full_name);
  const { data: conv } = await admin
    .from("whatsapp_conversations")
    .select("id, phone, opted_out_at, state")
    .eq("client_id", patient.id)
    .maybeSingle();
  const { data: client } = await admin
    .from("clients")
    .select("auth_user_id")
    .eq("id", patient.id)
    .maybeSingle();
  const onWhatsApp = conv && !conv.opted_out_at && conv.state !== "opted_out";

  if (onWhatsApp) {
    const { data: last } = await admin
      .from("whatsapp_inbound")
      .select("received_at")
      .in("from_phone", [`+${conv.phone}`, conv.phone])
      .order("received_at", { ascending: false })
      .limit(1);
    const lastAt = (last as Array<{ received_at: string }> | null)?.[0]?.received_at;
    const open = Boolean(lastAt && deps.now.getTime() - new Date(lastAt).getTime() < WINDOW_MS);
    const template = process.env.WHATSAPP_PROGRAMME_TEMPLATE?.trim();
    const message: Outgoing | null = open
      ? { kind: "text", body: PRAC_MSG.patient(name, prac.firstName) }
      : template
        ? {
            kind: "template",
            templateName: template,
            languageCode: process.env.WHATSAPP_PROGRAMME_TEMPLATE_LANG?.trim() || "en",
            variables: [name, prac.firstName],
          }
        : null;
    if (message) {
      let id: string | null = null;
      let ok = false;
      try {
        id =
          (
            await deps.provider.send(
              { ...message, to: conv.phone } as OutboundMessage,
              deps.secrets,
            )
          ).providerMessageId || null;
        ok = true;
      } catch (e) {
        log.warn("programme notice failed", {
          to: maskPhone(conv.phone),
          error: e instanceof Error ? e.message : "unknown",
        });
      }
      await admin
        .from("whatsapp_outbound")
        .insert({
          phone: conv.phone,
          client_id: patient.id,
          provider: deps.provider.id,
          provider_message_id: id,
          kind: message.kind,
          body: message.kind === "text" ? message.body : `[programme template: ${prac.firstName}]`,
          sent_ok: ok,
        })
        .then(
          () => undefined,
          () => undefined,
        );
      return ok ? "whatsapp" : "failed";
    }
    // No template and the window is closed: hold it for their next message.
    const { data: cur } = await admin
      .from("whatsapp_conversations")
      .select("draft")
      .eq("id", conv.id)
      .maybeSingle();
    await admin
      .from("whatsapp_conversations")
      .update({
        draft: {
          ...((cur?.draft as Record<string, unknown>) ?? {}),
          pendingNotice: PRAC_MSG.patient(name, prac.firstName),
        },
      })
      .eq("id", conv.id)
      .then(
        () => undefined,
        () => undefined,
      );
    return "later";
  }

  if (client?.auth_user_id) {
    try {
      const { sendPushCore } = await import("@/lib/push.functions");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await sendPushCore(supabaseAdmin, {
        userId: client.auth_user_id,
        title: "Your programme is ready",
        body: `${prac.firstName} has sent you your exercise programme.`,
        data: { kind: "programme" },
      });
      return "app";
    } catch {
      return "failed";
    }
  }
  return "not_registered";
}

/** Status, updates and check-in requests (practitioner-status.server.ts). */
/** "Message Tayla and ask her ...": find who, confirm if unsure, then ask. */
async function handleQuestionIntent(
  adminIn: Admin,
  prac: Practitioner,
  text: string,
  intent: Extract<
    import("./practitioner-status.server").PracIntent,
    { kind: "ask_patient" | "ask_pick" | "ask_cancel" }
  >,
  deps: PractitionerDeps,
  mem: PracMemory = {},
): Promise<void> {
  const pq = await import("./patient-questions.server");
  const admin = adminIn as unknown as Db;
  const text1 = (body: string) => deps.reply({ kind: "text", body });
  const env = { provider: deps.provider, secrets: deps.secrets };

  if (intent.kind === "ask_cancel") {
    const q = await pq.loadQuestion(adminIn, intent.questionId);
    await pq.cancelQuestion(adminIn, intent.questionId);
    const { isQuestionText } = await import("./patient-message-text");
    await text1(
      q && !isQuestionText(q.question) ? pq.MESSAGE_MSG.cancelled : pq.QUESTION_MSG.cancelled,
    );
    return;
  }

  const patients = await practitionerPatients(admin, prac.userId);
  let questionId: string | null = null;
  let target: PatientRow | null = null;
  let question = "";

  if (intent.kind === "ask_pick") {
    const q = await pq.loadQuestion(adminIn, intent.questionId);
    target = patients.find((p) => p.id === intent.clientId) ?? null;
    if (!q || q.practitioner_id !== prac.userId || q.status !== "draft" || !target) {
      await text1("That question has already been sent or has closed.");
      return;
    }
    questionId = q.id;
    question = q.question;
  } else {
    question = intent.question;
    const hits = rankPatients(text, patients);
    if (!hits.length) {
      await text1(PRAC_MSG.notFoundAny(prac.firstName));
      return;
    }
    questionId = await pq.saveDraft(adminIn, {
      practitionerId: prac.userId,
      question,
      clientId: hits.length === 1 ? hits[0].patient.id : null,
      now: deps.now,
    });
    if (!questionId) {
      await text1(pq.QUESTION_MSG.failed("them"));
      return;
    }
    if (hits.length > 1) {
      await deps.reply({
        kind: "list",
        body: pq.QUESTION_MSG.which,
        buttonLabel: "Choose",
        rows: hits.slice(0, 10).map((h) => ({
          id: `pq_pick_${questionId}_${h.patient.id}`,
          title: String(h.patient.full_name ?? "Client").slice(0, 24),
        })),
      });
      return;
    }
    if (hits[0].confidence === "medium") {
      const full = String(hits[0].patient.full_name ?? "").trim() || "them";
      await deps.reply({
        kind: "buttons",
        body: pq.QUESTION_MSG.confirm(full, question),
        buttons: [
          { id: `pq_pick_${questionId}_${hits[0].patient.id}`, title: "Yes, ask" },
          { id: `pq_cancel_${questionId}`, title: "No" },
        ],
      });
      return;
    }
    target = hits[0].patient;
  }

  rememberClient(mem, target.id, deps.now);
  await sendStored(adminIn, prac, questionId, target, question, deps);
}

/** After a Reply tap: send what they typed, as typed. */
async function sendTyped(
  adminIn: Admin,
  prac: Practitioner,
  clientId: string,
  text: string,
  deps: PractitionerDeps,
  mem: PracMemory,
): Promise<void> {
  const pq = await import("./patient-questions.server");
  const admin = adminIn as unknown as Db;
  const patients = await practitionerPatients(admin, prac.userId);
  const target = patients.find((p) => p.id === clientId) ?? null;
  if (!target) {
    await deps.reply({ kind: "text", body: PRAC_MSG.notFoundAny(prac.firstName) });
    return;
  }
  const words = text.slice(0, 1000);
  const id = await pq.saveDraft(adminIn, {
    practitionerId: prac.userId,
    question: words,
    clientId: target.id,
    now: deps.now,
  });
  if (!id) {
    await deps.reply({ kind: "text", body: pq.QUESTION_MSG.failed(firstOf(target.full_name)) });
    return;
  }
  rememberClient(mem, target.id, deps.now);
  await sendStored(adminIn, prac, id, target, words, deps);
}

/**
 * Buddy didn't recognise the message, but a client replied to this
 * practitioner in the last 2 hours: it's probably for them. Ask first.
 */
async function offerToPassOn(
  adminIn: Admin,
  prac: Practitioner,
  text: string,
  deps: PractitionerDeps,
  mem: PracMemory,
): Promise<boolean> {
  const clientId = await recentConversationClient(
    adminIn,
    prac.userId,
    deps.now,
    2 * 60 * 60 * 1000,
    true,
  );
  if (!clientId) return false;
  const admin = adminIn as unknown as Db;
  const target = (await practitionerPatients(admin, prac.userId)).find((p) => p.id === clientId);
  if (!target) return false;
  const pq = await import("./patient-questions.server");
  const id = await pq.saveDraft(adminIn, {
    practitionerId: prac.userId,
    question: text.slice(0, 1000),
    clientId,
    now: deps.now,
  });
  if (!id) return false;
  rememberClient(mem, clientId, deps.now);
  await deps.reply({
    kind: "buttons",
    body: pq.MESSAGE_MSG.confirm(String(target.full_name ?? "").trim() || "them", text),
    buttons: [
      { id: `pq_pick_${id}_${clientId}`, title: "Send" },
      { id: `pq_cancel_${id}`, title: "Don't send" },
    ],
  });
  return true;
}

function rememberClient(mem: PracMemory, clientId: string, now: Date): void {
  mem.lastClientId = clientId;
  mem.lastClientAt = now.getTime();
}

/** Send a saved question or message to the client and tell the practitioner how it went. */
async function sendStored(
  adminIn: Admin,
  prac: Practitioner,
  questionId: string,
  target: PatientRow,
  text: string,
  deps: PractitionerDeps,
): Promise<void> {
  const pq = await import("./patient-questions.server");
  const { isQuestionText } = await import("./patient-message-text");
  const name = firstOf(target.full_name);
  const result = await pq.askNow(
    adminIn,
    { provider: deps.provider, secrets: deps.secrets },
    { questionId, clientId: target.id, practitionerName: prac.firstName, now: deps.now },
  );
  const isQ = isQuestionText(text);
  await deps.reply({
    kind: "text",
    body:
      result === "asked"
        ? isQ
          ? pq.QUESTION_MSG.asked(name, text)
          : pq.MESSAGE_MSG.sent(name, text)
        : result === "waiting"
          ? isQ
            ? pq.QUESTION_MSG.waiting(name, text)
            : pq.MESSAGE_MSG.waiting(name, text)
          : result === "not_whatsapp"
            ? pq.QUESTION_MSG.notOnWhatsApp(name)
            : pq.QUESTION_MSG.failed(name),
  });
}

/**
 * The client this practitioner is talking with: the last one a question or
 * message went to, or who replied, within the window. For "tell her ...".
 */
async function recentConversationClient(
  adminIn: Admin,
  practitionerId: string,
  now: Date,
  windowMs: number,
  answeredOnly = false,
): Promise<string | null> {
  const admin = adminIn as unknown as Db;
  const { data } = await admin
    .from("patient_questions")
    .select("client_id, status, asked_at, answered_at")
    .eq("practitioner_id", practitionerId)
    .in("status", answeredOnly ? ["answered"] : ["asked", "answered"])
    .limit(200);
  let best: { id: string; at: number } | null = null;
  for (const r of (data ?? []) as Array<Record<string, string | null>>) {
    const at = Date.parse(String(r.answered_at ?? r.asked_at ?? ""));
    if (!r.client_id || !Number.isFinite(at) || now.getTime() - at > windowMs) continue;
    if (!best || at > best.at) best = { id: r.client_id, at };
  }
  return best?.id ?? null;
}

/**
 * "Tell Nicola well done", "can you tell her I love her", or the Reply
 * button under a client's reply. Buddy shows the exact words the client
 * will get and sends on "Send". After a Reply tap the next message goes
 * as typed.
 */
async function handleMessageIntent(
  adminIn: Admin,
  prac: Practitioner,
  intent: Extract<
    import("./practitioner-status.server").PracIntent,
    { kind: "message_patient" | "message_reply" }
  >,
  deps: PractitionerDeps,
  mem: PracMemory,
): Promise<void> {
  const pq = await import("./patient-questions.server");
  const mt = await import("./patient-message-text");
  const { swapPronouns } = await import("./patient-question-text");
  const { closeName } = await import("./practitioner-understand");
  const admin = adminIn as unknown as Db;
  const text1 = (body: string) => deps.reply({ kind: "text", body });
  const patients = await practitionerPatients(admin, prac.userId);

  if (intent.kind === "message_reply") {
    const target = patients.find((p) => p.id === intent.clientId) ?? null;
    if (!target) {
      await text1(PRAC_MSG.notFoundAny(prac.firstName));
      return;
    }
    rememberClient(mem, target.id, deps.now);
    mem.replyTo = target.id;
    mem.replyToAt = deps.now.getTime();
    mem.confirm = null;
    mem.awaitingReception = false;
    await text1(pq.MESSAGE_MSG.replyAsk(firstOf(target.full_name)));
    return;
  }

  const req = intent.req;
  let targets: PatientRow[] = [];
  let words = "";
  if (req.pronoun) {
    const id =
      mem.lastClientId ?? (await recentConversationClient(adminIn, prac.userId, deps.now, DAY_MS));
    const t = patients.find((p) => p.id === id) ?? null;
    if (!t) {
      await text1(pq.MESSAGE_MSG.whoIsIt(req.who ?? "them"));
      return;
    }
    targets = [t];
    words = req.rest.slice((req.who ?? "").length).trim();
  } else {
    const probe = req.who ?? req.rest.split(/\s+/).slice(0, 3).join(" ");
    const hits = rankPatients(probe, patients);
    if (!hits.length) {
      await text1(PRAC_MSG.notFoundAny(prac.firstName));
      return;
    }
    targets = hits.slice(0, 10).map((h) => h.patient);
    words = req.who
      ? req.rest.slice(req.who.length).trim()
      : mt.stripLeadingName(
          req.rest,
          targets.map((p) => String(p.full_name ?? "")).join(" "),
          closeName,
        );
  }
  const message = mt.toClientMessage(words, swapPronouns);
  if (!message) {
    // "tell Nicola" with nothing after it: ask what to say.
    if (targets.length === 1) {
      return handleMessageIntent(
        adminIn,
        prac,
        { kind: "message_reply", clientId: targets[0].id },
        deps,
        mem,
      );
    }
    await text1(PRAC_MSG.notFoundAny(prac.firstName));
    return;
  }
  const draftId = await pq.saveDraft(adminIn, {
    practitionerId: prac.userId,
    question: message,
    clientId: targets.length === 1 ? targets[0].id : null,
    now: deps.now,
  });
  if (!draftId) {
    await text1(pq.QUESTION_MSG.failed("them"));
    return;
  }
  if (targets.length > 1) {
    await deps.reply({
      kind: "list",
      body: pq.MESSAGE_MSG.which,
      buttonLabel: "Choose",
      rows: targets.map((p) => ({
        id: `pq_pick_${draftId}_${p.id}`,
        title: String(p.full_name ?? "Client").slice(0, 24),
      })),
    });
    return;
  }
  const target = targets[0];
  rememberClient(mem, target.id, deps.now);
  await deps.reply({
    kind: "buttons",
    body: pq.MESSAGE_MSG.confirm(String(target.full_name ?? "").trim() || "them", message),
    buttons: [
      { id: `pq_pick_${draftId}_${target.id}`, title: "Send" },
      { id: `pq_cancel_${draftId}`, title: "Don't send" },
    ],
  });
}

const DAY_MS = 86_400_000;

async function handleStatusIntent(
  adminIn: Admin,
  prac: Practitioner,
  text: string,
  intent: import("./practitioner-status.server").PracIntent,
  deps: PractitionerDeps,
  mem: PracMemory,
): Promise<void> {
  const st = await import("./practitioner-status.server");
  const admin = adminIn as unknown as Db;
  const text1 = (body: string) => deps.reply({ kind: "text", body });

  if (intent.kind === "updates_menu") {
    await deps.reply({
      kind: "buttons",
      body: st.UPDATE_MSG.menu,
      buttons: [
        { id: "prac_upd_daily", title: "Daily, 7:30am" },
        { id: "prac_upd_weekly", title: "Mondays, 7:30am" },
        { id: "prac_upd_off", title: "No updates" },
      ],
    });
    return;
  }
  if (intent.kind === "updates") {
    const ok = await st.saveUpdatePrefs(adminIn, prac.userId, intent, deps.now);
    await text1(
      ok
        ? st.UPDATE_MSG.saved(intent.frequency, intent.weekday, intent.time)
        : st.UPDATE_MSG.failed,
    );
    return;
  }
  if (intent.kind === "reception" || intent.kind === "reception_open") {
    const rc = await import("./reception.server");
    const env = { provider: deps.provider, secrets: deps.secrets };
    if (intent.kind === "reception_open") {
      await text1(await rc.practitionerOpenList(adminIn, prac.userId, deps.now));
      return;
    }
    const result = await rc.sendToReception(adminIn, env, {
      practitionerId: prac.userId,
      practitionerName: prac.firstName,
      task: intent.task,
      now: deps.now,
    });
    await text1(rc.RECEPTION_MSG.toPractitioner(result));
    return;
  }
  if (intent.kind === "ask_patient" || intent.kind === "ask_pick" || intent.kind === "ask_cancel") {
    await handleQuestionIntent(adminIn, prac, text, intent, deps, mem);
    return;
  }
  if (intent.kind === "message_patient" || intent.kind === "message_reply") {
    await handleMessageIntent(adminIn, prac, intent, deps, mem);
    return;
  }
  if (intent.kind === "admin") {
    const { adminAnswer } = await import("./practitioner-admin.server");
    const body = await adminAnswer(adminIn, prac.userId, intent.topic, deps.now);
    await deps.reply(
      intent.topic === "overview"
        ? {
            kind: "buttons",
            body,
            buttons: [
              { id: "prac_adm_redflags", title: "All red flags" },
              { id: "prac_adm_quiet", title: "Who's gone quiet" },
              { id: "prac_adm_usage", title: "Usage details" },
            ],
          }
        : { kind: "text", body },
    );
    return;
  }
  if (intent.kind === "status_all") {
    const list = await st.loadClientList(adminIn, prac.userId, intent.practice);
    const statuses = await st.loadStatuses(adminIn, list, deps.now);
    await text1(st.formatStatusAll(prac.firstName, statuses, deps.now, intent.practice));
    return;
  }
  if (intent.kind === "messages" || intent.kind === "review" || intent.kind === "checked_in") {
    await handleInboxIntent(adminIn, prac, text, intent, deps, mem);
    return;
  }
  if (intent.kind === "other") return;

  // One client: by button id, or by the name in the message.
  const patients = await practitionerPatients(admin, prac.userId);
  let target: PatientRow | null = null;
  if (intent.kind !== "checkin" && intent.kind !== "status_one") return;
  if (intent.clientId) target = patients.find((p) => p.id === intent.clientId) ?? null;
  else {
    const resolved = await resolveNamed(
      mem,
      deps,
      intent.kind,
      text,
      patients,
      intent.kind === "checkin" && intent.confidence === "medium",
    );
    if (resolved.asked) return;
    target = resolved.target;
  }
  if (!target) {
    await text1(PRAC_MSG.notFoundAny(prac.firstName));
    return;
  }
  rememberClient(mem, target.id, deps.now);

  if (intent.kind === "status_one") {
    const { data: row } = await admin
      .from("clients")
      .select("id, full_name, created_at, auth_user_id")
      .eq("id", target.id)
      .maybeSingle();
    const [s] = await st.loadStatuses(adminIn, row ? [row] : [], deps.now);
    if (!s) {
      await text1(PRAC_MSG.notFoundAny(prac.firstName));
      return;
    }
    const inbox = await import("./practitioner-inbox.server");
    const open = await inbox.loadOpenAlerts(adminIn, [target.id], deps.now);
    const body = [st.formatStatusOne(s, deps.now), ...inbox.formatAlertLines(open, deps.now)]
      .join("\n")
      .replace(/\n[^\n]*not reviewed yet\. Open their profile in Buddy to review\./, "");
    const buttons = open.length
      ? [
          { id: `prac_msgs_${target.id}`, title: "Read in full" },
          open.length === 1
            ? { id: `prac_rev_${open[0].id}`, title: "Mark reviewed" }
            : { id: `prac_revall_${target.id}`, title: "Mark all reviewed" },
          { id: `prac_ci_${target.id}`, title: "Ask for a check-in" },
        ]
      : [
          { id: `prac_ci_${target.id}`, title: "Ask for a check-in" },
          { id: `pm_reply_${target.id}`, title: "Send a message" },
        ];
    await deps.reply({ kind: "buttons", body, buttons });
    return;
  }

  // Check-in request.
  const name = firstOf(target.full_name);
  const result = deps.requestCheckin ? await deps.requestCheckin(target.id) : "failed";
  if (result === "sent" || result === "busy") {
    await st.recordCheckinRequest(adminIn, target.id, prac.userId, deps.now);
    await text1(result === "sent" ? PRAC_MSG.checkinAsked(name) : PRAC_MSG.checkinBusy(name));
    return;
  }
  if (result === "failed") {
    await text1(PRAC_MSG.failed(name));
    return;
  }
  // Not reachable on WhatsApp: the app, if they have it.
  const { data: client } = await admin
    .from("clients")
    .select("auth_user_id")
    .eq("id", target.id)
    .maybeSingle();
  if (client?.auth_user_id) {
    try {
      const { sendPushCore } = await import("@/lib/push.functions");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await sendPushCore(supabaseAdmin, {
        userId: client.auth_user_id,
        title: "Buddy check-in",
        body: `${prac.firstName} is checking in. Tap to log how you're doing.`,
        data: { type: "checkin_request" },
      });
      await st.recordCheckinRequest(adminIn, target.id, prac.userId, deps.now);
      await text1(PRAC_MSG.checkinApp(name));
    } catch {
      await text1(PRAC_MSG.failed(name));
    }
    return;
  }
  await text1(
    result === "window_closed"
      ? PRAC_MSG.checkinUnreachable(name)
      : PRAC_MSG.notRegisteredCheckin(name),
  );
}

/** Reading open messages, marking them reviewed, and who checked in (11 Oct). */
async function handleInboxIntent(
  adminIn: Admin,
  prac: Practitioner,
  text: string,
  intent: Extract<
    import("./practitioner-status.server").PracIntent,
    { kind: "messages" } | { kind: "review" } | { kind: "checked_in" }
  >,
  deps: PractitionerDeps,
  mem: PracMemory,
): Promise<void> {
  const admin = adminIn as unknown as Db;
  const inbox = await import("./practitioner-inbox.server");
  const text1 = (body: string) => deps.reply({ kind: "text", body });

  if (intent.kind === "checked_in") {
    const st = await import("./practitioner-status.server");
    const { readCheckedIn } = await import("./practitioner-inbox-text");
    const range =
      readCheckedIn(text || "who checked in this week", deps.now) ??
      readCheckedIn("who checked in this week", deps.now)!;
    const list = await st.loadClientList(adminIn, prac.userId, intent.practice);
    const rows = await inbox.loadCheckins(
      adminIn,
      list.map((c) => c.id),
      range,
      deps.now,
    );
    const statuses = await st.loadStatuses(adminIn, list, deps.now);
    const active = new Set(
      statuses.filter((x) => st.bucketOf(x, deps.now) !== "inactive").map((x) => x.id),
    );
    await text1(inbox.formatCheckedIn(range, list, rows, active, deps.now, intent.practice));
    return;
  }

  const patients = await practitionerPatients(admin, prac.userId);
  const ids = patients.map((p) => p.id);
  const nameOf = (id: string) =>
    String(patients.find((p) => p.id === id)?.full_name ?? "").trim() || "this client";

  if (intent.kind === "review") {
    let alertIds: string[] = [];
    let clientId = intent.clientId;
    if (intent.alertId) {
      const { data } = await admin
        .from("alerts")
        .select("id, client_id")
        .eq("id", intent.alertId)
        .maybeSingle();
      if (data && ids.includes(data.client_id)) {
        alertIds = [data.id];
        clientId = data.client_id;
      }
    } else if (clientId && ids.includes(clientId)) {
      alertIds = (await inbox.loadOpenAlerts(adminIn, [clientId], deps.now)).map((a) => a.id);
    }
    if (!clientId || !ids.includes(clientId)) {
      await text1(PRAC_MSG.notFoundAny(prac.firstName));
      return;
    }
    const n = await inbox.markReviewed(adminIn, alertIds, ids, prac.userId, deps.now);
    const left = await inbox.loadOpenAlerts(adminIn, [clientId], deps.now);
    const name = nameOf(clientId);
    const done = n
      ? `Done, ${n === 1 ? "marked as reviewed" : `marked ${n} as reviewed`} for ${name}.`
      : `That was already reviewed.`;
    await text1(
      left.length ? `${done} ${left.length} still open.` : `${done} Nothing else open for ${name}.`,
    );
    return;
  }

  // Messages: one client's, by button id or a name in the text, else all of them.
  let clientId = intent.clientId && ids.includes(intent.clientId) ? intent.clientId : null;
  if (!clientId && !intent.clientId) {
    const hits = rankPatients(text, patients);
    if (hits.length > 1) {
      await deps.reply({
        kind: "list",
        body: PRAC_MSG.which,
        buttonLabel: "Choose",
        rows: hits.slice(0, 10).map((h) => ({
          id: `prac_msgs_${h.patient.id}`,
          title: String(h.patient.full_name ?? "Patient").slice(0, 24),
        })),
      });
      return;
    }
    if (hits.length === 1) clientId = hits[0].patient.id;
    else if (/\bred[\s-]?flags?\b/i.test(text)) {
      // "show me the red flags": the practice list for owners, theirs otherwise.
      const { adminAnswer } = await import("./practitioner-admin.server");
      await text1(await adminAnswer(adminIn, prac.userId, "redflags", deps.now));
      return;
    }
  }
  if (intent.clientId && !clientId) {
    await text1(PRAC_MSG.notFoundAny(prac.firstName));
    return;
  }
  if (!clientId) {
    // "My messages" is their own clients; owners can ask for the practice's.
    const st = await import("./practitioner-status.server");
    const practiceWide =
      /\b(practice|everyone|everybody|whole team|all (the )?(clients|patients))\b/i.test(text);
    const mine = await st.loadClientList(adminIn, prac.userId, practiceWide);
    const open = await inbox.loadOpenAlerts(
      adminIn,
      mine.map((c) => c.id),
      deps.now,
    );
    await text1(inbox.formatInbox(prac.firstName, mine, open, deps.now));
    return;
  }
  const open = await inbox.loadOpenAlerts(adminIn, [clientId], deps.now);
  const body = inbox.formatClientMessages(nameOf(clientId), open, deps.now);
  if (!open.length) {
    await deps.reply({
      kind: "buttons",
      body,
      buttons: [{ id: `prac_one_${clientId}`, title: "Client details" }],
    });
    return;
  }
  await deps.reply({
    kind: "buttons",
    body,
    buttons: [
      open.length === 1
        ? { id: `prac_rev_${open[0].id}`, title: "Mark reviewed" }
        : { id: `prac_revall_${clientId}`, title: "Mark all reviewed" },
      { id: `prac_ci_${clientId}`, title: "Ask for a check-in" },
      { id: `prac_one_${clientId}`, title: "Client details" },
    ],
  });
  void mem;
}
