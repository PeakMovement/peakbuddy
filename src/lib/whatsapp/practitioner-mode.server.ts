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
import { maskPhone, toE164Digits } from "./phone";
import type { OutboundMessage, ProviderSecrets, WhatsAppProvider } from "./provider";
import {
  bareReception,
  expireMemory,
  fixPractitionerTypos,
  isCancel,
  isYes,
  normalizePractitionerText,
  prettyTask,
  programmeConfidence,
  PROGRAMME_SENT,
  rankPatients,
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
    `Sorry, I didn't quite get that.\nTry "how are my clients doing?", "check in with a client", or "ask reception to…".`,
  confirm: (line: string) => `Did you mean: ${line}?`,
  confirmNo: "Okay, I won't.",
  receptionAsk: "What should I pass on to reception?",
  receptionCancelled: "Okay, I won't pass anything to reception.",
  help: (name: string) =>
    `Hi ${name}, you're messaging Buddy as a practitioner. Here's what I can do:\n\n` +
    `• "How are my clients doing?" for a quick status of all your clients\n` +
    `• "How is Sam Kruger doing?" for one client\n` +
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
        body: PRAC_MSG.help(prac.firstName),
        buttons: HELP_BUTTONS,
      });
    } else {
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
    await deps.reply({
      kind: "buttons",
      body: st.formatStatusOne(s, deps.now),
      buttons: [{ id: `prac_ci_${target.id}`, title: "Ask for a check-in" }],
    });
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
