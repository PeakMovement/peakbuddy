/**
 * Practitioner questions for a patient (11 Oct 2026, Justin).
 *
 *   Justin: Can you message Tayla and ask her when her sporting events are happening?
 *   Buddy:  (to Tayla) Hi Tayla, Justin asked me to check with you: when are your
 *           sporting events happening? Just reply here and I'll pass it on.
 *   Tayla:  Saturday the 18th and the 2nd of November
 *   Buddy:  (to Tayla) Thanks, I've passed that on to Justin.
 *           (to Justin) Tayla F. answered: ... I've added it to their notes.
 *
 * Inside the patient's 24 hour window the question goes as text. Outside it
 * the template WHATSAPP_QUESTION_TEMPLATE ({{1}} patient first name, {{2}}
 * practitioner first name, quick reply "See question") opens the window and
 * the tap brings the question. Without the template the question waits and
 * goes out with Buddy's next reply to the patient.
 *
 * The patient's next free-text message while idle is the answer. It still
 * runs through the red flag rules in the worker. Answers go to the profile
 * notes and back to the practitioner who asked. Logs: ids and counts only.
 */
import { log } from "@/lib/log";
import { appendNote } from "./practitioner-intake.server";
export { readPatientQuestion, toPatient } from "./patient-question-text";
import {
  practitionerContact,
  sendLogged,
  windowOpen,
  type SendEnv,
} from "./practitioner-status.server";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type Db = { from: (t: string) => any };

const DAY = 86_400_000;
/** An asked question takes the next message as its answer for this long. */
export const ANSWER_TTL_MS = 3 * DAY;

export type QuestionStatus = "draft" | "pending" | "asked" | "answered" | "cancelled";

export interface PatientQuestion {
  id: string;
  client_id: string | null;
  practitioner_id: string;
  question: string;
  status: QuestionStatus;
  created_at: string;
  asked_at: string | null;
  answer: string | null;
  answered_at: string | null;
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export const QUESTION_MSG = {
  toPatient: (patient: string, prac: string, question: string) =>
    `Hi ${patient}, ${prac} asked me to check with you: ${question}\n\nJust reply here and I'll pass it on.`,
  thanks: (prac: string) => `Thanks, I've passed that on to ${prac}.`,
  asked: (patient: string, question: string) =>
    `Done, I've asked ${patient}: "${question}" I'll add the answer to their notes and send it to you.`,
  waiting: (patient: string, question: string) =>
    `Got it. ${patient} hasn't messaged me in the last day, so WhatsApp won't let me message them first. I've saved "${question}" and they'll get it the moment they next message Buddy.`,
  notOnWhatsApp: (patient: string) =>
    `${patient} isn't on WhatsApp with Buddy, so I can't ask them there. You could add the question to their profile in the app.`,
  failed: (patient: string) =>
    `Sorry, something went wrong asking ${patient}. Please try again in a minute.`,
  cancelled: "No problem, I haven't asked anyone.",
  confirm: (patient: string, question: string) => `Ask ${patient}: "${question}"?`,
  which: "I found more than one client with that name. Who should I ask?",
  answerToPrac: (patient: string, question: string, answer: string) =>
    `${patient} answered your question "${question}":\n\n${answer}\n\nI've added it to their notes.`,
  answerNote: (prac: string, question: string, answer: string) =>
    `${prac} asked "${question}" Answer: ${answer}`,
};

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

export async function saveDraft(
  adminIn: Admin,
  args: { practitionerId: string; question: string; clientId: string | null; now: Date },
): Promise<string | null> {
  const admin = adminIn as unknown as Db;
  const id = crypto.randomUUID();
  const { error } = await admin.from("patient_questions").insert({
    id,
    client_id: args.clientId,
    practitioner_id: args.practitionerId,
    question: args.question.slice(0, 1000),
    status: "draft",
    created_at: args.now.toISOString(),
  });
  if (error) {
    log.warn("patient question not saved", { error: String(error.message ?? error) });
    return null;
  }
  return id;
}

export async function loadQuestion(adminIn: Admin, id: string): Promise<PatientQuestion | null> {
  const admin = adminIn as unknown as Db;
  const { data } = await admin.from("patient_questions").select("*").eq("id", id).maybeSingle();
  return (data as PatientQuestion | null) ?? null;
}

async function setQuestion(adminIn: Admin, id: string, patch: Partial<PatientQuestion>) {
  const admin = adminIn as unknown as Db;
  await admin.from("patient_questions").update(patch).eq("id", id).select("id").limit(1);
}

export async function cancelQuestion(adminIn: Admin, id: string): Promise<void> {
  await setQuestion(adminIn, id, { status: "cancelled" });
}

/* ------------------------------------------------------------------ */
/* Asking                                                              */
/* ------------------------------------------------------------------ */

export type AskResult = "asked" | "waiting" | "not_whatsapp" | "failed";

const firstOf = (n: string | null | undefined) =>
  String(n ?? "")
    .trim()
    .split(/\s+/)[0] || "there";

/** Put the question to the patient now if WhatsApp allows, else queue it. */
export async function askNow(
  adminIn: Admin,
  env: SendEnv,
  args: { questionId: string; clientId: string; practitionerName: string; now: Date },
): Promise<AskResult> {
  const admin = adminIn as unknown as Db;
  const q = await loadQuestion(adminIn, args.questionId);
  if (!q) return "failed";
  const [{ data: client }, { data: convs }] = await Promise.all([
    admin.from("clients").select("id, full_name").eq("id", args.clientId).maybeSingle(),
    admin
      .from("whatsapp_conversations")
      .select("phone, opted_out_at, state")
      .eq("client_id", args.clientId)
      .limit(1),
  ]);
  const conv = (
    (convs ?? []) as Array<{ phone: string; opted_out_at: string | null; state: string }>
  )[0];
  await setQuestion(adminIn, q.id, { client_id: args.clientId, status: "pending" });
  if (!conv || conv.opted_out_at || conv.state === "opted_out") return "not_whatsapp";
  const name = firstOf((client as { full_name?: string | null } | null)?.full_name);

  if (await windowOpen(adminIn, conv.phone, args.now)) {
    const ok = await sendLogged(
      adminIn,
      env,
      {
        kind: "text",
        to: conv.phone,
        body: QUESTION_MSG.toPatient(name, args.practitionerName, q.question),
      },
      "[practitioner question]",
    );
    if (!ok) return "failed";
    await setQuestion(adminIn, q.id, { status: "asked", asked_at: args.now.toISOString() });
    return "asked";
  }
  const template = process.env.WHATSAPP_QUESTION_TEMPLATE?.trim();
  if (!template) return "waiting";
  const ok = await sendLogged(
    adminIn,
    env,
    {
      kind: "template",
      to: conv.phone,
      templateName: template,
      languageCode: process.env.WHATSAPP_QUESTION_TEMPLATE_LANG?.trim() || "en",
      variables: [name, args.practitionerName],
      buttonPayloads: [`pq_show_${q.id}`],
    },
    `[question template ${template}]`,
  );
  // The question itself goes when they tap "See question" (or message Buddy).
  return ok ? "asked" : "failed";
}

/* ------------------------------------------------------------------ */
/* The patient's side, called from the worker                          */
/* ------------------------------------------------------------------ */

async function practitionerFirst(adminIn: Admin, userId: string): Promise<string> {
  const admin = adminIn as unknown as Db;
  const { data } = await admin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return firstOf((data as { full_name?: string | null } | null)?.full_name) === "there"
    ? "your practitioner"
    : firstOf((data as { full_name?: string | null } | null)?.full_name);
}

async function openQuestions(adminIn: Admin, clientId: string): Promise<PatientQuestion[]> {
  const admin = adminIn as unknown as Db;
  const { data } = await admin
    .from("patient_questions")
    .select("*")
    .eq("client_id", clientId)
    .in("status", ["pending", "asked"])
    .limit(20);
  return ((data ?? []) as PatientQuestion[]).sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
}

const GREETING =
  /^(hi|hello|hey|hiya|howzit|morning|good\s+(morning|afternoon|evening)|ok|okay|k)\b[\s,!.]*(buddy)?[\s,!.]*$/i;

export interface QuestionStep {
  /** Replaces Buddy's normal reply to this message. */
  replies: Array<{ kind: "text"; body: string }>;
}

/**
 * Before Buddy decides its normal reply. A "See question" tap shows the
 * question; while idle, a typed message after a question is its answer.
 * Returns null when this message has nothing to do with a question.
 */
export async function questionStepForPatient(
  adminIn: Admin,
  env: SendEnv,
  args: {
    client: { id: string; full_name: string | null; notes?: string | null };
    text: string;
    replyId: string | null;
    idle: boolean;
    now: Date;
  },
): Promise<QuestionStep | null> {
  const admin = adminIn as unknown as Db;
  const name = firstOf(args.client.full_name);
  const show = args.replyId?.match(/^pq_show_([0-9a-f-]{36})$/i)?.[1];
  if (show) {
    const q = await loadQuestion(adminIn, show);
    if (!q || q.client_id !== args.client.id || (q.status !== "pending" && q.status !== "asked"))
      return {
        replies: [{ kind: "text", body: "That question has already been answered, thanks." }],
      };
    const prac = await practitionerFirst(adminIn, q.practitioner_id);
    await setQuestion(adminIn, q.id, { status: "asked", asked_at: args.now.toISOString() });
    return { replies: [{ kind: "text", body: QUESTION_MSG.toPatient(name, prac, q.question) }] };
  }
  if (!args.idle || args.replyId) return null;
  const text = args.text.trim();
  if (!text || GREETING.test(text)) return null;
  const asked = (await openQuestions(adminIn, args.client.id))
    .filter(
      (q) =>
        q.status === "asked" &&
        q.asked_at &&
        args.now.getTime() - new Date(q.asked_at).getTime() < ANSWER_TTL_MS,
    )
    .sort((a, b) => String(b.asked_at).localeCompare(String(a.asked_at)))[0];
  if (!asked) return null;

  const prac = await practitionerFirst(adminIn, asked.practitioner_id);
  const answer = text.slice(0, 2000);
  await setQuestion(adminIn, asked.id, {
    status: "answered",
    answer,
    answered_at: args.now.toISOString(),
  });
  // Profile notes, read fresh so nothing written meanwhile is lost.
  const { data: fresh } = await admin
    .from("clients")
    .select("notes")
    .eq("id", args.client.id)
    .maybeSingle();
  await admin
    .from("clients")
    .update({
      notes: appendNote(
        (fresh as { notes?: string | null } | null)?.notes,
        QUESTION_MSG.answerNote(prac, asked.question, answer),
        args.now,
      ),
    })
    .eq("id", args.client.id);
  // In the app as well, so the answer is never only in WhatsApp.
  await admin
    .from("alerts")
    .insert({
      practitioner_id: asked.practitioner_id,
      client_id: args.client.id,
      alert_type: "client_contact_request",
      message: `Answer to your question "${asked.question}": ${answer}`.slice(0, 1000),
      urgency: "routine",
      is_read: false,
      webhook_fired: false,
    })
    .then(
      () => undefined,
      () => undefined,
    );
  // The answer is saved whatever happens here; the relay is best effort.
  await tellPractitioner(
    adminIn,
    env,
    asked.practitioner_id,
    QUESTION_MSG.answerToPrac(shortName(args.client.full_name), asked.question, answer),
    args.now,
  ).catch((e) =>
    log.warn("question answer relay failed", { error: e instanceof Error ? e.message : "unknown" }),
  );
  return { replies: [{ kind: "text", body: QUESTION_MSG.thanks(prac) }] };
}

/**
 * Questions that waited for the patient's window: shown after Buddy's normal
 * reply, once the conversation is idle again. Returns the messages to add.
 */
export async function deliverWaiting(
  adminIn: Admin,
  args: { client: { id: string; full_name: string | null }; idleAfter: boolean; now: Date },
): Promise<Array<{ kind: "text"; body: string }>> {
  if (!args.idleAfter) return [];
  const open = await openQuestions(adminIn, args.client.id);
  if (open.some((q) => q.status === "asked")) return [];
  const next = open.find((q) => q.status === "pending");
  if (!next) return [];
  const prac = await practitionerFirst(adminIn, next.practitioner_id);
  await setQuestion(adminIn, next.id, { status: "asked", asked_at: args.now.toISOString() });
  return [
    {
      kind: "text",
      body: QUESTION_MSG.toPatient(firstOf(args.client.full_name), prac, next.question),
    },
  ];
}

function shortName(full: string | null | undefined): string {
  const parts = String(full ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "Your client";
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}

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
      "[question answer relay]",
    );
    if (ok) return;
  }
  try {
    const { sendPushCore } = await import("@/lib/push.functions");
    await sendPushCore(adminIn as never, {
      userId,
      title: "Buddy",
      body: "A client answered your question. Open Buddy to see it.",
      data: { kind: "patient_question" },
    });
  } catch (e) {
    log.warn("question answer push failed", { error: e instanceof Error ? e.message : "unknown" });
  }
}
