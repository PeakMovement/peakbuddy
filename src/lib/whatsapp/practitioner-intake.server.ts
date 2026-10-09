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
 * Off until WHATSAPP_INTAKE_TEMPLATE is set (after Meta approves it).
 * Practitioner messages are never attached to a patient's WhatsApp history.
 */
import { log } from "@/lib/log";
import { maskPhone, toE164Digits } from "./phone";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type Db = { from: (t: string) => any; auth: Admin["auth"] };

const COLLECT_WINDOW_MS = 2 * 60 * 60 * 1000;
const OFFER_VALID_MS = 14 * 24 * 60 * 60 * 1000;

export const INTAKE_MSG = {
  askBrief: (name: string) =>
    `Great, tell me about ${name}. One message or a voice note is perfect, covering anything that helps me check in well:\n\n` +
    "• what you're treating\n• any surgery and the date\n• their goals\n• what to watch for\n• limits for now (e.g. no running yet)\n\n" +
    "I'll add it to their profile notes. Reply DONE when you're finished.",
  saved: (name: string) => `Got it, added to ${name}'s profile notes. Send more, or reply DONE.`,
  done: (name: string) =>
    `Thanks. I'll use this when checking in with ${name}, and it's on their profile in the app. I never share your notes with the patient.`,
  declined: () => "No problem. You can add notes on the patient's profile in the app any time.",
  expired: () => "That request has closed. You can add notes on the patient's profile in the app any time.",
};

/** "Sam Kruger" -> "Sam K." Enough for the practitioner to know who, little else. */
export function shortName(fullName: string | null | undefined): string {
  const parts = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
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

export async function notifyPractitionerOfNewPatient(
  adminIn: Admin,
  clientId: string,
): Promise<"sent" | "exists" | "off" | "no_phone" | "failed"> {
  const admin = adminIn as unknown as Db;
  const templateName = process.env.WHATSAPP_INTAKE_TEMPLATE?.trim();
  if (!templateName) return "off";
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

    const { data: intake, error } = await admin
      .from("practitioner_intakes")
      .insert({
        client_id: clientId,
        practitioner_id: client.practitioner_id,
        phone,
        status: phone ? "sent" : "no_phone",
      })
      .select("id")
      .single();
    // A unique clash means another path got there first.
    if (error || !intake) return "exists";
    if (!phone) return "no_phone";

    const { whatsappConfigFromEnv } = await import("./worker.server");
    const cfg = whatsappConfigFromEnv();
    if (!cfg) return "off";
    try {
      await cfg.provider.send(
        {
          kind: "template",
          to: phone,
          templateName,
          languageCode: process.env.WHATSAPP_INTAKE_TEMPLATE_LANG?.trim() || "en",
          variables: [shortName(client.full_name)],
          buttonPayloads: [`intake_add:${intake.id}`, `intake_skip:${intake.id}`],
        },
        cfg.secrets,
      );
      return "sent";
    } catch (e) {
      await admin.from("practitioner_intakes").update({ status: "failed" }).eq("id", intake.id);
      log.warn("practitioner intake template failed", {
        to: maskPhone(phone),
        error: e instanceof Error ? e.message : "unknown",
      });
      return "failed";
    }
  } catch (e) {
    log.warn("practitioner intake failed", { error: e instanceof Error ? e.message : "unknown" });
    return "failed";
  }
}

export interface PractitionerInbound {
  phone: string;
  text: string;
  replyId: string | null;
  isAudio: boolean;
}

export interface IntakeDeps {
  send: (body: string) => Promise<void>;
  /** Voice note to text, when the message is audio. */
  transcribe: () => Promise<string | null>;
  now: Date;
}

/**
 * Handles a message from a practitioner answering an intake. Returns false
 * when the message is not part of an intake, so the normal patient flow
 * carries on (a practitioner may also test Buddy as a patient).
 */
export async function handlePractitionerReply(
  adminIn: Admin,
  msg: PractitionerInbound,
  deps: IntakeDeps,
): Promise<boolean> {
  const admin = adminIn as unknown as Db;
  const button = msg.replyId?.match(/^intake_(add|skip):([0-9a-f-]{36})$/i);

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
    const last = new Date(intake.last_message_at ?? intake.opened_at ?? intake.created_at).getTime();
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
  const text = msg.isAudio ? await deps.transcribe() : msg.text.trim();
  if (!text) {
    await deps.send("I couldn't read that one. Please type it, or send the voice note again.");
    return true;
  }
  await admin
    .from("clients")
    .update({ notes: appendNote(client?.notes, text.slice(0, 3000), deps.now) })
    .eq("id", intake.client_id);
  await admin.from("practitioner_intakes").update({ last_message_at: stamp }).eq("id", intake.id);
  await deps.send(INTAKE_MSG.saved(name));
  return true;
}
