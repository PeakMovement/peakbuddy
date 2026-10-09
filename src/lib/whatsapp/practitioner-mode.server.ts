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

/** "sent", "emailed", "shared"... plus "programme", "program", "exercises", "rehab plan". */
export const PROGRAMME_SENT =
  /\b(sent|send|emailed|shared|uploaded|given|gave|done|finished|ready)\b[\s\S]{0,80}\b(programme|program|exercises?|rehab|plan|hep)\b|\b(programme|program|exercises?|rehab|plan|hep)\b[\s\S]{0,40}\b(sent|emailed|shared|uploaded|done|ready)\b/i;

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
        .eq("role", "practitioner")
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

export const PRAC_MSG = {
  help: (name: string) =>
    `Hi ${name}, you're messaging Buddy as a practitioner. When you've sent a patient their exercise programme, tell me here, for example "I've sent Sam Kruger his programme", and I'll let them know.`,
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

/** Returns false when the message isn't something for practitioner mode. */
export async function handlePractitionerMessage(
  adminIn: Admin,
  prac: Practitioner,
  msg: { text: string; replyId: string | null },
  deps: PractitionerDeps,
): Promise<boolean> {
  const admin = adminIn as unknown as Db;
  const picked = msg.replyId?.match(/^prog_([0-9a-f-]{36})$/i)?.[1] ?? null;
  if (!picked && !PROGRAMME_SENT.test(msg.text)) {
    await deps.reply({ kind: "text", body: PRAC_MSG.help(prac.firstName) });
    return true;
  }

  const patients = await practitionerPatients(admin, prac.userId);
  let target: PatientRow | null = null;
  if (picked) {
    target = patients.find((p) => p.id === picked) ?? null;
  } else {
    const hits = matchPatients(msg.text, patients);
    if (hits.length === 1) target = hits[0];
    else if (hits.length > 1) {
      await deps.reply({
        kind: "list",
        body: PRAC_MSG.which,
        buttonLabel: "Choose",
        rows: hits
          .slice(0, 10)
          .map((p) => ({
            id: `prog_${p.id}`,
            title: String(p.full_name ?? "Patient").slice(0, 24),
          })),
      });
      return true;
    }
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
