/**
 * New patient -> their practitioner, on WhatsApp (stage 2, 9 Oct 2026).
 *
 * 1. A patient joins Buddy (web join link or WhatsApp sign-up) and picks a
 *    practitioner. Buddy sends that practitioner the approved template
 *    buddy_new_patient: "<Sam K.> has joined Buddy with you", with two
 *    buttons, Add details and Not now.
 * 2. Add details: Buddy asks for a short brief (what you're treating, surgery
 *    and date, goals, what to watch for, limits). Every message or voice note
 *    the practitioner sends until DONE (or 2 hours of quiet) is appended to
 *    the patient's practitioner notes on their profile, dated.
 * 3. Buddy's patient context card reads those notes, so check-ins and chat
 *    are informed by them. Buddy never repeats them to the patient.
 *
 * WhatsApp is off until WHATSAPP_INTAKE_TEMPLATE is set (after Meta approves
 * it); until then, and whenever WhatsApp can't reach them, they get an email.
 * Practitioner messages are never attached to a patient's WhatsApp history.
 */
import { log } from "@/lib/log";
import { maskPhone, toE164Digits } from "./phone";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type Db = { from: (t: string) => any; auth: Admin["auth"] };

/** Note taking closes after this long with nothing from the practitioner. */
const COLLECT_WINDOW_MS = 20 * 60 * 1000;
const OFFER_VALID_MS = 14 * 24 * 60 * 60 * 1000;

export const INTAKE_MSG = {
  askBrief: (name: string) =>
    `Great, tell me about ${name}. One message or a voice note is perfect, covering anything that helps me check in well:\n\n` +
    "• what you're treating\n• any surgery and the date\n• their goals\n• what to watch for\n• limits for now (e.g. no running yet)\n\n" +
    "I'll add it to their profile notes. Reply DONE when you're finished.",
  saved: (name: string) =>
    `Got it, added to ${name}'s profile notes. Send more, or tap Done.\n\nTip: start with "note" to add to their notes, or "task" for anything you want me to do.`,
  closedForTask: (name: string) => `Notes on ${name} saved and closed.`,
  which: (name: string) => `Is that a note for ${name}'s profile, or something you want me to do?`,
  nothingPending: "That message has already been handled.",
  done: (name: string) =>
    `Thanks. I'll use this when checking in with ${name}, and it's on their profile in the app. I never share your notes with the patient.`,
  declined: () => "No problem. You can add notes on the patient's profile in the app any time.",
  expired: () =>
    "That request has closed. You can add notes on the patient's profile in the app any time.",
};

/** "Sam Kruger" -> "Sam K." Enough for the practitioner to know who, little else. */
export function shortName(fullName: string | null | undefined): string {
  const parts = String(fullName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "A new patient";
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}

/** Appended note, dated, kept apart from what was there. */
export function appendNote(existing: string | null | undefined, text: string, now: Date): string {
  const date = new Date(now.getTime() + 2 * 3_600_000).toISOString().slice(0, 10);
  const entry = `[${date}, via WhatsApp] ${text.trim()}`;
  const prev = String(existing ?? "").trim();
  return (prev ? `${prev}\n\n${entry}` : entry).slice(-8000);
}

/**
 * Tell the practitioner a patient has picked them. WhatsApp first (template,
 * with Add details / Not now). If that can't go out (template not switched
 * on, no mobile on their profile, or the send fails), an email instead, with
 * a link to the patient's profile where they can add notes. Once per patient.
 */
export async function notifyPractitionerOfNewPatient(
  adminIn: Admin,
  clientId: string,
): Promise<"sent" | "emailed" | "exists" | "unreachable" | "failed"> {
  const admin = adminIn as unknown as Db;
  try {
    const { data: existing } = await admin
      .from("practitioner_intakes")
      .select("id")
      .eq("client_id", clientId)
      .maybeSingle();
    if (existing) return "exists";

    const { data: client } = await admin
      .from("clients")
      .select("id, full_name, practitioner_id")
      .eq("id", clientId)
      .maybeSingle();
    if (!client?.practitioner_id) return "failed";

    const { data: user } = await adminIn.auth.admin.getUserById(client.practitioner_id);
    const phone = toE164Digits(user?.user?.phone ?? null);
    const email = user?.user?.email ?? null;

    const templateName = process.env.WHATSAPP_INTAKE_TEMPLATE?.trim() || null;
    let cfg: Awaited<ReturnType<typeof loadCfg>> = null;
    if (templateName && phone) cfg = await loadCfg();
    const viaWhatsApp = Boolean(templateName && phone && cfg);

    const { data: intake, error } = await admin
      .from("practitioner_intakes")
      .insert({
        client_id: clientId,
        practitioner_id: client.practitioner_id,
        phone,
        status: viaWhatsApp ? "sent" : email ? "emailed" : "no_phone",
      })
      .select("id")
      .single();
    // A unique clash means another path got there first.
    if (error || !intake) return "exists";

    const patient = shortName(client.full_name);

    if (viaWhatsApp && cfg && templateName && phone) {
      try {
        await cfg.provider.send(
          {
            kind: "template",
            to: phone,
            templateName,
            languageCode: process.env.WHATSAPP_INTAKE_TEMPLATE_LANG?.trim() || "en",
            variables: [patient],
            buttonPayloads: [`intake_add:${intake.id}`, `intake_skip:${intake.id}`],
          },
          cfg.secrets,
        );
        return "sent";
      } catch (e) {
        log.warn("practitioner intake template failed, emailing instead", {
          to: maskPhone(phone),
          error: e instanceof Error ? e.message : "unknown",
        });
        await admin
          .from("practitioner_intakes")
          .update({ status: email ? "emailed" : "failed" })
          .eq("id", intake.id);
      }
    }

    if (!email) return "unreachable";
    const { sendTransactionalEmailServer } = await import("@/lib/email/send-server");
    const { appBaseUrl } = await import("@/lib/app-url");
    const sent = await sendTransactionalEmailServer({
      templateName: "practitioner-new-patient",
      recipientEmail: email,
      idempotencyKey: `new-patient-${clientId}`,
      templateData: {
        practitionerName: await practitionerFirstName(admin, client.practitioner_id),
        patientName: patient,
        profileUrl: `${appBaseUrl()}/practitioner/app/client-detail/${clientId}`,
      },
    });
    return sent.ok ? "emailed" : "failed";
  } catch (e) {
    log.warn("practitioner intake failed", { error: e instanceof Error ? e.message : "unknown" });
    return "failed";
  }
}

async function practitionerFirstName(admin: Db, id: string): Promise<string> {
  try {
    const { data } = await admin.from("profiles").select("full_name").eq("id", id).maybeSingle();
    return (
      String(data?.full_name ?? "")
        .trim()
        .split(/\s+/)[0] ?? ""
    );
  } catch {
    return "";
  }
}

async function loadCfg() {
  const { whatsappConfigFromEnv } = await import("./worker.server");
  return whatsappConfigFromEnv();
}

export interface PractitionerInbound {
  phone: string;
  text: string;
  replyId: string | null;
  isAudio: boolean;
}

export interface IntakeDeps {
  send: (body: string) => Promise<void>;
  /** Quick reply buttons. Falls back to plain text when absent. */
  sendButtons?: (body: string, buttons: Array<{ id: string; title: string }>) => Promise<void>;
  /** Voice note to text, when the message is audio. */
  transcribe: () => Promise<string | null>;
  now: Date;
}

/**
 * Handles a message from a practitioner answering an intake. Returns false
 * when the message is not part of an intake, so the normal patient flow
 * carries on (a practitioner may also test Buddy as a patient).
 */
/** What a message during note taking is: a note, an instruction, or unclear. */
export type IntakeKind = "note" | "task" | "unclear";

const NOTE_PREFIX =
  /^\s*(?:please\s+)?(?:add\s+(?:a\s+)?)?notes?\b\s*(?:for\s+\S+\s*)?[:,.;-]*\s*/i;
const TASK_PREFIX = /^\s*(?:tasks?|todo|to\s+do)\b\s*[:,.;-]*\s*/i;
/** Requests addressed to Buddy, not facts about the patient. */
const REQUEST =
  /^\s*(?:(?:hi|hey|hello|ok|okay)\s+buddy[\s,!.]*)?(?:(?:can|could|would|will)\s+you\b|(?:please|pls|plz|buddy)[\s,]+(?!note)|(?:message|text|whatsapp|remind|send|book|call|phone|contact|email|let|check\s+in|find\s+out|update\s+me|stop)\b|(?:ask|tell)\s+(?!her\b|him\b|them\b))/i;

/** Strips the "task" keyword, so the rest reads as a command. */
export function stripTaskPrefix(text: string): string {
  return TASK_PREFIX.test(text) ? text.replace(TASK_PREFIX, "") : text;
}

export async function classifyIntakeMessage(text: string): Promise<IntakeKind> {
  const t = String(text ?? "").trim();
  if (NOTE_PREFIX.test(t) && !/^\s*notes?\s+(?:on|about)\s+\w+\s*\??$/i.test(t)) return "note";
  if (TASK_PREFIX.test(t)) return "task";
  const { practitionerIntent } = await import("./practitioner-status.server");
  const { PROGRAMME_SENT } = await import("./practitioner-understand");
  if (practitionerIntent(t, null).kind !== "other" || PROGRAMME_SENT.test(t) || REQUEST.test(t))
    return "task";
  // A question that names nobody in particular, e.g. "what time is it?"
  if (/\?\s*$/.test(t)) return "unclear";
  return "note";
}

export async function handlePractitionerReply(
  adminIn: Admin,
  msg: PractitionerInbound,
  deps: IntakeDeps,
): Promise<boolean | { reroute: string }> {
  const admin = adminIn as unknown as Db;
  const button = msg.replyId?.match(/^intake_(add|skip|done|note|task):([0-9a-f-]{36})$/i);

  type Intake = {
    id: string;
    client_id: string;
    phone: string | null;
    status: string;
    created_at: string;
    last_message_at: string | null;
    opened_at: string | null;
  };
  let intake: Intake | null = null;

  if (button) {
    const { data } = await admin
      .from("practitioner_intakes")
      .select("id, client_id, phone, status, created_at, last_message_at, opened_at")
      .eq("id", button[2])
      .maybeSingle();
    intake = data as Intake | null;
    // Only the practitioner it was sent to can answer it.
    if (!intake || intake.phone !== msg.phone) return false;
    const action = button[1].toLowerCase();
    if (action === "done" || action === "note" || action === "task") {
      return await collectingButton(adminIn, intake, action, deps);
    }
  } else {
    const { data } = await admin
      .from("practitioner_intakes")
      .select("id, client_id, phone, status, created_at, last_message_at, opened_at")
      .eq("phone", msg.phone)
      .eq("status", "collecting")
      .order("last_message_at", { ascending: false })
      .limit(1);
    intake = ((data ?? []) as Intake[])[0] ?? null;
    if (!intake) return false;
    const last = new Date(
      intake.last_message_at ?? intake.opened_at ?? intake.created_at,
    ).getTime();
    if (deps.now.getTime() - last > COLLECT_WINDOW_MS) {
      await admin
        .from("practitioner_intakes")
        .update({ status: "done", completed_at: deps.now.toISOString() })
        .eq("id", intake.id);
      return false;
    }
  }

  const { data: client } = await admin
    .from("clients")
    .select("id, full_name, notes")
    .eq("id", intake.client_id)
    .maybeSingle();
  const name = shortName(client?.full_name);
  const stamp = deps.now.toISOString();

  const buttons = async (body: string, list: Array<{ id: string; title: string }>) =>
    deps.sendButtons ? deps.sendButtons(body, list) : deps.send(body);

  if (button) {
    const fresh = deps.now.getTime() - new Date(intake.created_at).getTime() < OFFER_VALID_MS;
    if (!fresh || !["sent", "collecting", "failed"].includes(intake.status)) {
      await deps.send(INTAKE_MSG.expired());
      return true;
    }
    if (button[1].toLowerCase() === "skip") {
      await admin
        .from("practitioner_intakes")
        .update({ status: "declined", completed_at: stamp })
        .eq("id", intake.id);
      await deps.send(INTAKE_MSG.declined());
      return true;
    }
    await admin
      .from("practitioner_intakes")
      .update({ status: "collecting", opened_at: stamp, last_message_at: stamp })
      .eq("id", intake.id);
    await deps.send(INTAKE_MSG.askBrief(name));
    return true;
  }

  // Collecting.
  if (/^\s*(done|finished|that'?s all|klaar)\s*[.!]*\s*$/i.test(msg.text)) {
    await admin
      .from("practitioner_intakes")
      .update({ status: "done", completed_at: stamp })
      .eq("id", intake.id);
    await deps.send(INTAKE_MSG.done(name));
    return true;
  }
  const raw = msg.isAudio ? await deps.transcribe() : msg.text.trim();
  if (!raw) {
    await deps.send("I couldn't read that one. Please type it, or send the voice note again.");
    return true;
  }
  // 11 Oct: "Can you message Tayla and ask her..." was filed as a note.
  // Instructions close note taking and go on to practitioner mode.
  const kind = msg.isAudio ? "note" : await classifyIntakeMessage(raw);
  if (kind === "task") {
    await admin
      .from("practitioner_intakes")
      .update({ status: "done", completed_at: stamp })
      .eq("id", intake.id);
    await deps.send(INTAKE_MSG.closedForTask(name));
    return { reroute: stripTaskPrefix(raw) };
  }
  if (kind === "unclear") {
    await admin
      .from("practitioner_intakes")
      .update({ pending_text: raw.slice(0, 3000), last_message_at: stamp })
      .eq("id", intake.id);
    await buttons(INTAKE_MSG.which(name), [
      { id: `intake_note:${intake.id}`, title: "Save as note" },
      { id: `intake_task:${intake.id}`, title: "Do it" },
    ]);
    return true;
  }
  const text = raw.replace(NOTE_PREFIX, "").trim() || raw;
  await saveNote(adminIn, intake, client?.notes ?? null, text, deps.now);
  await buttons(INTAKE_MSG.saved(name), [{ id: `intake_done:${intake.id}`, title: "Done" }]);
  return true;
}

async function saveNote(
  adminIn: Admin,
  intake: { id: string; client_id: string },
  notes: string | null,
  text: string,
  now: Date,
): Promise<void> {
  const admin = adminIn as unknown as Db;
  await admin
    .from("clients")
    .update({ notes: appendNote(notes, text.slice(0, 3000), now) })
    .eq("id", intake.client_id);
  await admin
    .from("practitioner_intakes")
    .update({ last_message_at: now.toISOString(), pending_text: null })
    .eq("id", intake.id);
}

/** Done, Save as note, Do it. */
async function collectingButton(
  adminIn: Admin,
  intake: { id: string; client_id: string; status: string },
  action: "done" | "note" | "task",
  deps: IntakeDeps,
): Promise<boolean | { reroute: string }> {
  const admin = adminIn as unknown as Db;
  const stamp = deps.now.toISOString();
  const [{ data: client }, { data: row }] = await Promise.all([
    admin.from("clients").select("id, full_name, notes").eq("id", intake.client_id).maybeSingle(),
    admin.from("practitioner_intakes").select("pending_text").eq("id", intake.id).maybeSingle(),
  ]);
  const name = shortName(client?.full_name);
  if (action === "done") {
    if (intake.status === "collecting") {
      await admin
        .from("practitioner_intakes")
        .update({ status: "done", completed_at: stamp, pending_text: null })
        .eq("id", intake.id);
    }
    await deps.send(INTAKE_MSG.done(name));
    return true;
  }
  const pending = String(
    (row as { pending_text?: string | null } | null)?.pending_text ?? "",
  ).trim();
  if (!pending) {
    await deps.send(INTAKE_MSG.nothingPending);
    return true;
  }
  if (action === "note") {
    await saveNote(adminIn, intake, client?.notes ?? null, pending, deps.now);
    const send = deps.sendButtons
      ? deps.sendButtons(INTAKE_MSG.saved(name), [
          { id: `intake_done:${intake.id}`, title: "Done" },
        ])
      : deps.send(INTAKE_MSG.saved(name));
    await send;
    return true;
  }
  await admin
    .from("practitioner_intakes")
    .update({ status: "done", completed_at: stamp, pending_text: null })
    .eq("id", intake.id);
  await deps.send(INTAKE_MSG.closedForTask(name));
  return { reroute: stripTaskPrefix(pending) };
}
