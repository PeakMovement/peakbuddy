import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import { currentConsent, renderConsentText } from "@/lib/consent/wording";
import { toSast } from "./clinic-hours";
import {
  decide,
  pendingQuestionText,
  readPain,
  readReminderTime,
  readScale,
  type AiAssist,
  MSG,
  type CheckinDraft,
  type ConversationState,
  type Decision,
  type InboundForDecision,
} from "./conversation";
import { maskPhone, matchPhone, toE164Digits } from "./phone";
import { getProvider, type ProviderSecrets, type WhatsAppProvider } from "./provider";
import { runRedFlagRules, type RuleLayerResult } from "./red-flag-rules";
import {
  converseWithAi,
  readAnswerWithAi,
  routeWithAi,
  transcribeVoiceNote,
  type AnswerField,
} from "./ai.server";
import { type ConverseResult, type ConverseTurn } from "./converse";
import { progressSummary, routeByKeywords, routeFromMenu, type AssistRoute } from "./assistant";
import { hasAiConsent } from "@/lib/ai-consent";
import { ONBOARD_MSG, parseJoinCode } from "./onboarding";
import {
  createSelfSignupClient,
  currentConsentTypes,
  findInvite,
  mintConsentLink,
  practiceName as practiceNameOf,
  practiceRoster,
  setupAppAccount,
} from "./onboarding.server";

/**
 * Drains whatsapp_inbound: one pending message at a time, oldest first.
 *
 * For each message it finds the WhatsApp conversation for that number, links
 * it to the Buddy profile with that phone number, runs the red flag rules,
 * asks `decide` what to do, does it, and replies.
 *
 * Called two ways:
 *   - straight after the webhook stores a message, so the patient gets an
 *     answer in seconds;
 *   - from the whatsapp-worker cron hook, as the backstop for anything the
 *     inline call did not finish.
 * The claim (pending -> processing, conditional on still being pending) is
 * what makes both safe to run at once: a message is only ever handled once.
 *
 * Logging: counts, rule ids and the last four digits of a number. Never the
 * message text, never a full number, never a name.
 */

type Admin = SupabaseClient;

interface InboundRow {
  id: string;
  provider: string;
  provider_message_id: string;
  from_phone: string;
  kind: InboundForDecision["kind"];
  body: string;
  reply_id: string | null;
  reply_title: string | null;
  media_id?: string | null;
  media_mime_type?: string | null;
  received_at: string;
}

interface ConversationRow {
  id: string;
  phone: string;
  client_id: string | null;
  state: ConversationState;
  draft: CheckinDraft | null;
  checkin_started_at: string | null;
  opted_out_at: string | null;
  unmatched_notice_at: string | null;
  wearable_offer_at?: string | null;
  app_offer_at?: string | null;
}

interface ClientRow {
  id: string;
  full_name: string | null;
  practitioner_id: string;
  practice_id?: string | null;
  yves_ai_consent?: boolean | null;
  auth_user_id?: string | null;
  phone?: string | null;
}

export interface WorkerResult {
  processed: number;
  failed: number;
  skipped: number;
}

export interface WorkerEnv {
  admin: Admin;
  provider: WhatsAppProvider;
  secrets: ProviderSecrets;
  now?: () => Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A message claimed longer ago than this, and still processing, was abandoned. */
export const STUCK_CLAIM_MS = 3 * 60 * 1000;

/** Reads the provider config from the environment. Null when WhatsApp is not configured. */
export function whatsappConfigFromEnv(): {
  provider: WhatsAppProvider;
  secrets: ProviderSecrets;
} | null {
  const id = process.env.WHATSAPP_PROVIDER;
  if (id !== "meta" && id !== "twilio") return null;
  const signingSecret = id === "meta" ? process.env.META_APP_SECRET : process.env.TWILIO_AUTH_TOKEN;
  const senderId =
    id === "meta" ? process.env.META_PHONE_NUMBER_ID : process.env.TWILIO_WHATSAPP_FROM;
  if (!signingSecret || !senderId) return null;
  return {
    provider: getProvider(id),
    secrets: {
      signingSecret,
      senderId,
      accessToken: id === "meta" ? process.env.META_ACCESS_TOKEN : process.env.TWILIO_ACCOUNT_SID,
      verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN,
    },
  };
}

export async function processPendingInbound(env: WorkerEnv, limit = 20): Promise<WorkerResult> {
  const { admin } = env;
  const result: WorkerResult = { processed: 0, failed: 0, skipped: 0 };

  // Release claims that never finished. The webhook bounds its inline call at
  // 8 seconds, and a Worker that has already answered can be stopped mid
  // message. Without this, that message would sit in "processing" forever and
  // the patient would never get an answer.
  const stuckBefore = new Date(Date.now() - STUCK_CLAIM_MS).toISOString();
  await admin
    .from("whatsapp_inbound")
    .update({ status: "pending", processed_at: null })
    .eq("status", "processing")
    .lt("processed_at", stuckBefore);

  const { data: rows, error } = await admin
    .from("whatsapp_inbound")
    .select(
      "id, provider, provider_message_id, from_phone, kind, body, reply_id, reply_title, media_id, media_mime_type, received_at",
    )
    .eq("status", "pending")
    .order("received_at", { ascending: true })
    .limit(limit);
  if (error) {
    log.warn("whatsapp worker: pending read failed", { code: error.code });
    return result;
  }

  for (const row of (rows ?? []) as InboundRow[]) {
    // Claim. Only the caller that flips pending -> processing handles it.
    const { data: claimed } = await admin
      .from("whatsapp_inbound")
      // processed_at doubles as "claimed at" while processing, so a claim that
      // never finished can be found and released (see STUCK_CLAIM_MS).
      .update({ status: "processing", processed_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) {
      result.skipped++;
      continue;
    }

    try {
      const clientId = await processOne(env, row);
      await admin
        .from("whatsapp_inbound")
        .update({
          status: "processed",
          processed_at: new Date().toISOString(),
          client_id: clientId,
        })
        .eq("id", row.id);
      result.processed++;
    } catch (e) {
      const reason = e instanceof Error ? e.message.slice(0, 200) : "unknown";
      await admin
        .from("whatsapp_inbound")
        .update({
          status: "failed",
          processed_at: new Date().toISOString(),
          failure_reason: reason,
        })
        .eq("id", row.id);
      log.warn("whatsapp worker: message failed", { reason, from: maskPhone(row.from_phone) });
      result.failed++;
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */

const BASE_CONV_COLS =
  "id, phone, client_id, state, draft, checkin_started_at, opted_out_at, unmatched_notice_at";

async function loadConversation(admin: Admin, phone: string): Promise<ConversationRow> {
  // wearable_offer_at arrives with migration 0014. Until it is applied, read
  // without it rather than failing every message.
  let cols = `${BASE_CONV_COLS}, wearable_offer_at, app_offer_at`;
  const first = await admin
    .from("whatsapp_conversations")
    .select(cols)
    .eq("phone", phone)
    .maybeSingle();
  let existing = first.data;
  if (first.error) {
    cols = BASE_CONV_COLS;
    ({ data: existing } = await admin
      .from("whatsapp_conversations")
      .select(cols)
      .eq("phone", phone)
      .maybeSingle());
  }
  if (existing) return existing as unknown as ConversationRow;

  const { data: created, error } = await admin
    .from("whatsapp_conversations")
    .insert({ phone, state: "new" })
    .select(cols)
    .single();
  if (created) return created as unknown as ConversationRow;

  // Lost a race with a parallel worker. The row exists now.
  const { data: again } = await admin
    .from("whatsapp_conversations")
    .select(cols)
    .eq("phone", phone)
    .maybeSingle();
  if (again) return again as unknown as ConversationRow;
  throw new Error(`conversation load failed: ${error?.code ?? "unknown"}`);
}

async function findClientIdByPhone(admin: Admin, phone: string): Promise<string | null> {
  // Pilot scale: read the numbers and compare in code, because practitioners
  // type numbers in every format and SQL cannot normalise them reliably. The
  // result is stored on the conversation, so this only runs until a match.
  const { data } = await admin
    .from("clients")
    .select("id, phone")
    .not("phone", "is", null)
    .limit(5000);
  const match = matchPhone(phone, (data ?? []) as Array<{ id: string; phone: string | null }>);
  if (match.kind === "ambiguous") {
    log.warn("whatsapp worker: number on more than one profile", {
      from: maskPhone(phone),
      count: match.ids.length,
    });
    return null;
  }
  return match.kind === "matched" ? match.id : null;
}

async function hasCurrentConsent(admin: Admin, clientId: string): Promise<boolean> {
  const { data } = await admin
    .from("consent_records")
    .select("id")
    .eq("client_id", clientId)
    .eq("consent_type", "whatsapp_checkins")
    .is("withdrawn_at", null)
    .is("superseded_by", null)
    .limit(1);
  return (data ?? []).length > 0;
}

async function checkedInToday(admin: Admin, clientId: string, now: Date): Promise<boolean> {
  const dayStart = new Date(`${toSast(now).date}T00:00:00+02:00`).toISOString();
  const { count } = await admin
    .from("check_ins")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .gte("created_at", dayStart);
  return (count ?? 0) > 0;
}

async function previousPain(admin: Admin, clientId: string): Promise<number | null> {
  const { data } = await admin
    .from("check_ins")
    .select("pain_level")
    .eq("client_id", clientId)
    .not("pain_level", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const p = (data?.[0] as { pain_level?: number | null } | undefined)?.pain_level;
  return typeof p === "number" ? p : null;
}

/* ------------------------------------------------------------------ */

async function processOne(env: WorkerEnv, row: InboundRow): Promise<string | null> {
  const { admin } = env;
  const now = env.now?.() ?? new Date();
  const phone = toE164Digits(row.from_phone);
  if (!phone) throw new Error("unusable sender number");

  const conv = await loadConversation(admin, phone);

  // A "Chat to Buddy" link carries a join code in its pre-typed message.
  const code = parseJoinCode(row.body ?? "");
  let inviteWelcome: { practiceName: string } | undefined;
  let inviteInvalid = false;
  let signupPracticeId: string | null =
    (conv.draft as CheckinDraft | null)?.signupPracticeId ?? null;

  // Link to a profile. Retried on every message until it succeeds, because the
  // practitioner may add the number after the patient first writes in.
  let clientId = conv.client_id;
  if (code) {
    const invite = await findInvite(admin, code).catch(() => null);
    if (
      invite?.kind === "client" &&
      invite.client_id &&
      (!invite.used_at || invite.client_id === conv.client_id)
    ) {
      // Their own invite: this number now belongs to that profile.
      clientId = invite.client_id;
      await admin
        .from("whatsapp_invites")
        .update({ used_at: now.toISOString() })
        .eq("id", invite.id)
        .is("used_at", null);
      inviteWelcome = { practiceName: await practiceNameOf(admin, invite.practice_id) };
    } else if (invite?.kind === "practice" && invite.practice_id) {
      signupPracticeId = invite.practice_id;
    } else if (!invite || invite.kind === "client") {
      inviteInvalid = true;
    }
  }
  if (!clientId) clientId = await findClientIdByPhone(admin, phone);

  let client: ClientRow | null = null;
  if (clientId) {
    const { data } = await admin
      .from("clients")
      .select("id, full_name, practitioner_id, practice_id, yves_ai_consent, auth_user_id, phone")
      .eq("id", clientId)
      .maybeSingle();
    client = (data as ClientRow | null) ?? null;
    if (!client) clientId = null;
  }
  if (client && inviteWelcome) {
    // Fill in what the practitioner may not have had when adding them.
    await admin
      .from("clients")
      .update({ ...(client.phone ? {} : { phone: `+${phone}` }) })
      .eq("id", client.id);
    await admin
      .from("clients")
      .update({ onboarding_source: "whatsapp_invite" })
      .eq("id", client.id)
      .is("onboarding_source", null);
  }
  if (client) inviteInvalid = false;

  // Self sign-up: a practice link, and no profile for this number yet.
  let signup: Parameters<typeof decide>[0]["signup"];
  if (!client && signupPracticeId) {
    const roster = await practiceRoster(admin, signupPracticeId).catch(() => null);
    if (roster) signup = { practiceId: signupPracticeId, ...roster };
  }

  // Blue ticks and "typing..." straight away, so the patient knows we have it.
  if (env.provider.markRead) {
    env.provider.markRead(row.provider_message_id, env.secrets).catch(() => {});
  }

  const aiAllowed = client ? hasAiConsent(client) : false;
  const isAudio = row.kind === "media" && (row.media_mime_type ?? "").startsWith("audio/");

  const message: InboundForDecision = {
    // A join message is a hello, whoever sends it. Someone already on Buddy
    // gets their normal greeting (or consent link), never a "note" saying
    // they'd like to join.
    text: (code ? "hi" : row.body) || row.reply_title || "",
    replyId: row.reply_id ?? undefined,
    kind: row.kind,
    mediaType: row.kind === "media" ? (isAudio ? "audio" : "other") : undefined,
  };

  // Voice notes become text, then go down exactly the same path as typing,
  // red flags included. The transcript is kept on the inbound row so the
  // practitioner can read what was said.
  if (isAudio && aiAllowed && row.media_id && env.provider.fetchMedia) {
    const transcript = await transcribe(env, row.media_id).catch(() => null);
    if (transcript) {
      message.text = transcript;
      message.kind = "text";
      await admin
        .from("whatsapp_inbound")
        .update({ body: `[voice note] ${transcript}` })
        .eq("id", row.id);
    } else {
      log.warn("whatsapp worker: voice note not transcribed", { from: maskPhone(phone) });
    }
  }

  // A conversation that was unmatched and has just been matched starts fresh.
  let state: ConversationState = conv.state;
  if (
    client &&
    (state === "unmatched" || state === "awaiting_name" || state === "awaiting_practitioner")
  ) {
    state = "new";
  }
  if (!client && signup && code) state = "new"; // a fresh tap on the practice link restarts sign-up

  const [legacyConsent, today, prevPain] = client
    ? await Promise.all([
        hasCurrentConsent(admin, client.id),
        checkedInToday(admin, client.id, now),
        previousPain(admin, client.id),
      ])
    : [false, false, null];

  // Consent is cross-checked on every message: POPIA and WhatsApp check-ins,
  // current wording. Missing either means a personal link to the consent page.
  // If links can't be made yet (migration 0016 not applied), fall back to the
  // in-chat WhatsApp consent so nothing breaks.
  let consent = legacyConsent;
  let consentUrl: string | undefined;
  if (client) {
    const signed = await currentConsentTypes(admin, client.id).catch(() => null);
    const strict = signed !== null && signed.has("popia_core") && signed.has("whatsapp_checkins");
    if (!strict) {
      const url = await mintConsentLink(admin, client.id, phone).catch(() => null);
      if (url) {
        consent = false;
        consentUrl = url;
      }
    } else {
      consent = true;
    }
  }

  // Layer 1 safety runs on every message, whatever the conversation state,
  // before anything else is decided.
  // When the plain reader can't find the answer to the question we asked,
  // and the patient allows AI, let the model try. Never overrides a number
  // the patient typed.
  const assist = aiAllowed ? await aiAssist(state, message) : undefined;

  // A message outside a check-in question: work out what it is for. The AI
  // router answers practice questions from the approved sheet only; without AI
  // consent the keyword router decides and nothing leaves Buddy.
  let route: AssistRoute | undefined;
  let progressText: string | undefined;
  if (
    client &&
    consent &&
    (state === "idle" || state === "awaiting_wearable") &&
    message.text.trim()
  ) {
    route =
      routeFromMenu(message.replyId) ??
      (message.replyId
        ? undefined
        : ((aiAllowed ? await routeWithAi(message.text) : null) ?? routeByKeywords(message.text)));
    if (route?.intent === "progress") progressText = await progressFor(admin, client.id);
  }

  // Nothing fixed fits: let the conversational layer interpret it (AI consent
  // only). Outside a check-in that is a message the router called "other";
  // inside one, an answer neither the plain reader nor the answer reader
  // could place.
  const clientHasWearable = client ? await hasWearable(admin, client.id) : false;
  let converse: ConverseResult | undefined;
  const midCheckin =
    state === "awaiting_pain" || state === "awaiting_sleep" || state === "awaiting_energy";
  const typed = message.text.trim();
  const unplacedMid =
    midCheckin &&
    !message.replyId &&
    !assist &&
    (state === "awaiting_pain"
      ? readPain(message) === null
      : readScale(message, state === "awaiting_sleep" ? "wsleep_" : "wenergy_") === null);
  const unplacedIdle = route?.intent === "other" && !readReminderTime(typed);
  if (client && consent && aiAllowed && typed && (unplacedMid || unplacedIdle)) {
    const history = await recentTurns(admin, row.from_phone, phone, row.id);
    if (!progressText && unplacedIdle) progressText = await progressFor(admin, client.id);
    converse =
      (await converseWithAi({
        firstName: firstNameOf(client.full_name),
        message: typed,
        history,
        pendingQuestion: midCheckin ? pendingQuestionText(state) : null,
        checkedInToday: today,
        hasWearable: clientHasWearable,
      })) ?? undefined;
  }

  const painNow =
    state === "awaiting_pain" ? (readPain(message) ?? assist?.painScore ?? null) : null;
  const redFlags = runRedFlagRules({
    text: message.text ?? "",
    painScore: painNow,
    previousPainScore: prevPain,
  });

  const decision = decide({
    message,
    conversation: {
      state,
      draft: conv.draft ?? {},
      checkinStartedAt: conv.checkin_started_at ? new Date(conv.checkin_started_at) : null,
    },
    client: client ? { firstName: firstNameOf(client.full_name) } : null,
    hasConsent: consent,
    checkedInToday: today,
    redFlags,
    now,
    hasWearable: clientHasWearable,
    converse,
    route,
    progressText,
    wearableOffered: Boolean(conv.wearable_offer_at),
    assist,
    consentUrl,
    inviteWelcome: client ? inviteWelcome : undefined,
    inviteInvalid: !client && inviteInvalid,
    signup,
    hasAppAccount: Boolean(client?.auth_user_id),
    appOfferDue: Boolean(client && !client.auth_user_id && !conv.app_offer_at),
  });

  // Unknown numbers are told once a day, not on every message.
  let replies = decision.replies;
  let unmatchedNoticeAt = conv.unmatched_notice_at;
  if (!client) {
    const recently =
      conv.unmatched_notice_at &&
      now.getTime() - new Date(conv.unmatched_notice_at).getTime() < DAY_MS;
    if (recently) {
      replies = replies.filter((r) => !("body" in r) || r.body !== MSG.unmatched);
    } else {
      unmatchedNoticeAt = now.toISOString();
    }
  }

  if (client) await applyEffects(env, decision, client, row, redFlags, now);

  // Self sign-up finished: create the profile, tell the practitioner, and send
  // the consent link so nothing is collected before it is signed.
  if (!client && decision.createClient) {
    const id = await createSelfSignupClient(admin, { ...decision.createClient, phone });
    const { data } = await admin
      .from("clients")
      .select("id, full_name, practitioner_id, practice_id, yves_ai_consent, auth_user_id, phone")
      .eq("id", id)
      .maybeSingle();
    client = (data as ClientRow | null) ?? null;
    if (client) {
      await raiseContactAlert(
        admin,
        client,
        `New patient joined Buddy on WhatsApp: ${decision.createClient.fullName}. They chose you as their practitioner. Please check this is right.`,
        "routine",
      ).catch(() => {});
      const url = await mintConsentLink(admin, client.id, phone).catch(() => null);
      if (url) {
        replies = [
          ...replies,
          { kind: "text", body: ONBOARD_MSG.consentLink(firstNameOf(client.full_name), url) },
        ];
        decision.next = { state: "awaiting_consent", draft: {}, checkinStartedAt: null };
      }
    }
  }

  // App login requested by email: the outcome decides the reply.
  if (client && decision.accountEmail) {
    const outcome = await setupAppAccount(admin, client, decision.accountEmail).catch(
      () => "error" as const,
    );
    replies = [
      ...replies,
      {
        kind: "text",
        body:
          outcome === "ok"
            ? ONBOARD_MSG.appSetUp(decision.accountEmail)
            : outcome === "taken"
              ? ONBOARD_MSG.appEmailTaken
              : "Sorry, I couldn't set that up just now. Please ask the practice to help.",
      },
    ];
  }

  // Save where the conversation is BEFORE replying, so a failed send never
  // leaves the patient's answers unrecorded.
  const optedOutAt = decision.optOut
    ? now.toISOString()
    : decision.optIn
      ? null
      : conv.opted_out_at;
  await admin
    .from("whatsapp_conversations")
    .update({
      client_id: client?.id ?? null,
      state: decision.next.state,
      draft: decision.next.draft,
      checkin_started_at: decision.next.checkinStartedAt?.toISOString() ?? null,
      opted_out_at: optedOutAt,
      unmatched_notice_at: unmatchedNoticeAt,
      last_inbound_at: row.received_at,
      updated_at: now.toISOString(),
    })
    .eq("id", conv.id);

  if (decision.markAppOffered) {
    // Separate write: the column arrives with migration 0016.
    await admin
      .from("whatsapp_conversations")
      .update({ app_offer_at: now.toISOString() })
      .eq("id", conv.id);
  }

  if (decision.markWearableOffered) {
    // Separate write: the column arrives with migration 0014.
    await admin
      .from("whatsapp_conversations")
      .update({ wearable_offer_at: now.toISOString() })
      .eq("id", conv.id);
  }

  let sent = 0;
  for (const reply of replies) {
    let providerMessageId: string | null = null;
    let ok = false;
    try {
      const r = await env.provider.send(
        { ...reply, to: phone } as Parameters<WhatsAppProvider["send"]>[0],
        env.secrets,
      );
      providerMessageId = r.providerMessageId || null;
      ok = true;
      sent++;
    } catch (e) {
      // Status only, never the text.
      log.warn("whatsapp worker: send failed", {
        to: maskPhone(phone),
        error: e instanceof Error ? e.message.slice(0, 120) : "unknown",
      });
    }
    // Keep Buddy's side of the conversation for the practitioner's view.
    // Best effort: a logging failure never affects the patient.
    await admin
      .from("whatsapp_outbound")
      .insert({
        phone,
        client_id: client?.id ?? null,
        provider: env.provider.id,
        provider_message_id: providerMessageId,
        kind: reply.kind,
        body: flattenReply(reply),
        sent_ok: ok,
      })
      .then(
        () => undefined,
        () => undefined,
      );
  }
  if (sent > 0) {
    await admin
      .from("whatsapp_conversations")
      .update({ last_outbound_at: new Date().toISOString() })
      .eq("id", conv.id);
  }
  if (replies.length > 0 && sent === 0) throw new Error("all replies failed to send");

  return client?.id ?? null;
}

/** Buddy's words as the practitioner should read them, choices included. */
export function flattenReply(reply: Decision["replies"][number]): string {
  if (reply.kind === "text") return reply.body;
  if (reply.kind === "buttons")
    return `${reply.body}\n[${reply.buttons.map((b) => b.title).join(" | ")}]`;
  if (reply.kind === "list")
    return `${reply.body}\n[${reply.rows.map((r) => r.title).join(" | ")}]`;
  return `[template ${reply.templateName}]`;
}

async function transcribe(env: WorkerEnv, mediaId: string): Promise<string | null> {
  const media = await env.provider.fetchMedia!(mediaId, env.secrets);
  if (!media) return null;
  return transcribeVoiceNote(media.bytes, media.mimeType);
}

const ASSIST_FIELD: Partial<Record<ConversationState, AnswerField>> = {
  awaiting_pain: "painScore",
  awaiting_sleep: "sleep",
  awaiting_energy: "energy",
};

async function aiAssist(
  state: ConversationState,
  message: InboundForDecision,
): Promise<AiAssist | undefined> {
  const field = ASSIST_FIELD[state];
  if (!field || !message.text.trim() || message.replyId) return undefined;
  // Only when the plain reader found nothing.
  if (field === "painScore" && readPain(message) !== null) return undefined;
  if (field === "sleep" && readScale(message, "wsleep_") !== null) return undefined;
  if (field === "energy" && readScale(message, "wenergy_") !== null) return undefined;
  const value = await readAnswerWithAi(field, message.text);
  return value === null ? undefined : { [field]: value };
}

async function progressFor(admin: Admin, clientId: string): Promise<string> {
  const { data } = await admin
    .from("check_ins")
    .select("created_at, pain_level")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(7);
  return progressSummary(
    ((data ?? []) as Array<{ created_at: string; pain_level: number | null }>).map((r) => ({
      at: r.created_at,
      pain: r.pain_level,
    })),
  );
}

/** The last few turns with this number, oldest first, excluding the message being handled. */
async function recentTurns(
  admin: Admin,
  fromPhone: string,
  phone: string,
  currentId: string,
): Promise<ConverseTurn[]> {
  const since = new Date(Date.now() - 2 * DAY_MS).toISOString();
  const [inbound, outbound] = await Promise.all([
    admin
      .from("whatsapp_inbound")
      .select("id, received_at, body, reply_title")
      .eq("from_phone", fromPhone)
      .gte("received_at", since)
      .order("received_at", { ascending: false })
      .limit(8),
    admin
      .from("whatsapp_outbound")
      .select("created_at, body")
      .eq("phone", phone)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);
  const turns: Array<ConverseTurn & { at: string }> = [
    ...(
      (inbound.data ?? []) as Array<{
        id: string;
        received_at: string;
        body: string | null;
        reply_title: string | null;
      }>
    )
      .filter((r) => r.id !== currentId)
      .map((r) => ({
        at: r.received_at,
        from: "patient" as const,
        text: r.body || r.reply_title || "",
      })),
    ...(
      (outbound.error ? [] : (outbound.data ?? [])) as Array<{ created_at: string; body: string }>
    ).map((r) => ({ at: r.created_at, from: "buddy" as const, text: r.body })),
  ];
  return turns
    .filter((t) => t.text)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-8)
    .map(({ from, text }) => ({ from, text }));
}

async function hasWearable(admin: Admin, clientId: string): Promise<boolean> {
  const { data } = await admin
    .from("wearable_tokens")
    .select("client_id")
    .eq("client_id", clientId)
    .limit(1);
  return (data ?? []).length > 0;
}

function firstNameOf(fullName: string | null): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  return first || "there";
}

/* ------------------------------------------------------------------ */
/* Effects                                                             */
/* ------------------------------------------------------------------ */

async function applyEffects(
  env: WorkerEnv,
  decision: Decision,
  client: ClientRow,
  row: InboundRow,
  redFlags: RuleLayerResult,
  now: Date,
): Promise<void> {
  const { admin } = env;

  if (decision.recordConsent) {
    const v = currentConsent("whatsapp_checkins");
    const { error } = await admin.from("consent_records").insert({
      client_id: client.id,
      consent_type: "whatsapp_checkins",
      version: v.version,
      wording_snapshot: renderConsentText(v),
      channel: "whatsapp",
      evidence: { provider: row.provider, provider_message_id: row.provider_message_id },
    });
    if (error) throw new Error(`consent insert failed: ${error.code ?? "unknown"}`);
  }

  if (decision.optOut) {
    await admin
      .from("consent_records")
      .update({ withdrawn_at: now.toISOString() })
      .eq("client_id", client.id)
      .eq("consent_type", "whatsapp_checkins")
      .is("withdrawn_at", null);
  }

  if (decision.saveCheckin) {
    const c = decision.saveCheckin;
    const { error } = await admin.from("check_ins").insert({
      client_id: client.id,
      practitioner_id: client.practitioner_id,
      pain_level: c.pain,
      sleep_quality: c.sleep,
      energy_level: c.energy,
      notes: c.notes || null,
      flagged: c.flagged,
      source: "whatsapp",
    });
    if (error) throw new Error(`check-in insert failed: ${error.code ?? "unknown"}`);
  }

  // Each of these is best effort: the check-in and consent above are the
  // record, and a failed notification must not undo them.
  if (
    redFlags.triggered &&
    (redFlags.urgency === "emergency" ||
      redFlags.urgency === "urgent" ||
      redFlags.urgency === "soon")
  ) {
    await raiseRedFlagAlert(admin, client, redFlags).catch((e) =>
      log.warn("whatsapp worker: red flag alert failed", {
        error: e instanceof Error ? e.message : "unknown",
      }),
    );
  }

  if (decision.setReminderTime) {
    // Same row the app's reminder screen writes, so the two never disagree.
    await admin
      .from("checkin_reminders")
      .upsert(
        {
          client_id: client.id,
          enabled: true,
          frequency: "daily",
          time_of_day: decision.setReminderTime,
          days_of_week: [0, 1, 2, 3, 4, 5, 6],
          timezone: "Africa/Johannesburg",
        },
        { onConflict: "client_id" },
      )
      .then(
        () => undefined,
        () => undefined,
      );
  }

  if (decision.contactRequest) {
    await raiseContactAlert(
      admin,
      client,
      `${firstNameOf(client.full_name)} asked on WhatsApp to be contacted.`,
    ).catch(() => {});
  }
  if (decision.clinicalQuestion) {
    await raiseClinicalQuestion(admin, client, decision.clinicalQuestion).catch((e) =>
      log.warn("whatsapp worker: clinical question alert failed", {
        error: e instanceof Error ? e.message : "unknown",
      }),
    );
  }

  if (decision.noteForPractitioner) {
    await raiseContactAlert(
      admin,
      client,
      `WhatsApp message from ${firstNameOf(client.full_name)}: ${decision.noteForPractitioner}`,
      "routine",
    ).catch(() => {});
  }
}

/** Same chain as the app's check-in and the triage safety net: alert row, push, email, webhook. */
async function raiseRedFlagAlert(
  admin: Admin,
  client: ClientRow,
  flags: RuleLayerResult,
): Promise<void> {
  // 24 hour dedup, except emergencies, which always alert. Same rule as the app.
  if (flags.urgency !== "emergency") {
    const since = new Date(Date.now() - DAY_MS).toISOString();
    const { data: existing } = await admin
      .from("alerts")
      .select("id")
      .eq("client_id", client.id)
      .eq("alert_type", "red_flag")
      .eq("is_read", false)
      .gte("created_at", since)
      .limit(1);
    if (existing && existing.length > 0) return;
  }

  const detail = flags.hits.map((h) => h.detail).join("; ");
  const { data: alertRow } = await admin
    .from("alerts")
    .insert({
      practitioner_id: client.practitioner_id,
      client_id: client.id,
      alert_type: "red_flag",
      message: `WhatsApp check-in: ${detail}`.slice(0, 1000),
      urgency: flags.urgency,
      red_flag_category: flags.category,
    })
    .select("id")
    .single();
  const alertId = (alertRow as { id?: string } | null)?.id;
  if (!alertId) return;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const firstName = firstNameOf(client.full_name);

  try {
    const { data: claimed } = await admin
      .from("alerts")
      .update({ push_fired: true })
      .eq("id", alertId)
      .eq("push_fired", false)
      .select("id")
      .maybeSingle();
    if (claimed) {
      const { sendPushCore } = await import("@/lib/push.functions");
      const push = {
        title: "Buddy alert",
        body: `${firstName} reported symptoms on WhatsApp that may need review`,
        data: { clientId: client.id, kind: "whatsapp" },
      };
      await sendPushCore(supabaseAdmin, { userId: client.practitioner_id, ...push });
      // Red flags also reach the practice owner, when that is someone else.
      const owner = await practiceOwnerId(admin, client);
      if (owner && owner !== client.practitioner_id) {
        await sendPushCore(supabaseAdmin, { userId: owner, ...push });
      }
    }
  } catch (e) {
    log.warn("whatsapp worker: push failed", { error: e instanceof Error ? e.message : "unknown" });
  }

  try {
    const { sendAlertEmailCore } = await import("@/lib/notify-practitioner.functions");
    await sendAlertEmailCore(supabaseAdmin, alertId);
  } catch (e) {
    log.warn("whatsapp worker: email failed", {
      error: e instanceof Error ? e.message : "unknown",
    });
  }

  try {
    const { fireAlertWebhookCore } = await import("@/lib/webhooks.functions");
    const wh = await fireAlertWebhookCore({
      practitionerId: client.practitioner_id,
      clientName: client.full_name || "Your client",
      clientId: client.id,
      alertMessage: `Red flag in WhatsApp check-in: ${detail}`.slice(0, 300),
      urgency: flags.urgency,
      redFlagDetected: true,
    });
    if (wh.fired) await admin.from("alerts").update({ webhook_fired: true }).eq("id", alertId);
  } catch (e) {
    log.warn("whatsapp worker: webhook failed", {
      error: e instanceof Error ? e.message : "unknown",
    });
  }
}

/**
 * A clinical question Buddy will not answer. Justin (practice manager) is told
 * Buddy promised him: an alert on the client, push to the treating
 * practitioner and the practice owner, and the alert email to the practice
 * inbox.
 */
async function raiseClinicalQuestion(
  admin: Admin,
  client: ClientRow,
  question: string,
): Promise<void> {
  const firstName = firstNameOf(client.full_name);
  const { data: alertRow } = await admin
    .from("alerts")
    .insert({
      practitioner_id: client.practitioner_id,
      client_id: client.id,
      alert_type: "client_contact_request",
      message: `Clinical question on WhatsApp, waiting for an answer: ${question}`.slice(0, 1000),
      urgency: "soon",
      is_read: false,
      webhook_fired: false,
    })
    .select("id")
    .single();
  const alertId = (alertRow as { id?: string } | null)?.id;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { sendPushCore } = await import("@/lib/push.functions");
  const push = {
    title: "Question for you",
    body: `${firstName} asked a clinical question on WhatsApp. Buddy said you'd answer shortly.`,
    data: { clientId: client.id, kind: "whatsapp_question" },
  };
  const owner = await practiceOwnerId(admin, client);
  const recipients = [...new Set([client.practitioner_id, owner].filter(Boolean) as string[])];
  for (const userId of recipients) {
    await sendPushCore(supabaseAdmin, { userId, ...push }).catch(() => undefined);
  }
  if (alertId) {
    const { sendAlertEmailCore } = await import("@/lib/notify-practitioner.functions");
    await sendAlertEmailCore(supabaseAdmin, alertId).catch(() => undefined);
  }
}

async function practiceOwnerId(admin: Admin, client: ClientRow): Promise<string | null> {
  if (!client.practice_id) return null;
  const { data } = await admin
    .from("practices")
    .select("practitioner_id")
    .eq("id", client.practice_id)
    .maybeSingle();
  return (data as { practitioner_id?: string } | null)?.practitioner_id ?? null;
}

async function raiseContactAlert(
  admin: Admin,
  client: ClientRow,
  message: string,
  urgency: "soon" | "routine" = "soon",
): Promise<void> {
  await admin.from("alerts").insert({
    practitioner_id: client.practitioner_id,
    client_id: client.id,
    alert_type: "client_contact_request",
    message: message.slice(0, 1000),
    urgency,
    is_read: false,
    webhook_fired: false,
  });
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendPushCore } = await import("@/lib/push.functions");
    await sendPushCore(supabaseAdmin, {
      userId: client.practitioner_id,
      title: "Buddy",
      body: `${firstNameOf(client.full_name)} sent a WhatsApp message for you`,
      data: { clientId: client.id, kind: "whatsapp_contact" },
    });
  } catch {
    /* best effort */
  }
}

/**
 * Called by the consent page once the patient has signed: thank them on
 * WhatsApp and start their first check-in. They messaged Buddy moments ago,
 * so this is inside WhatsApp's 24 hour window.
 */
export async function continueAfterConsent(
  admin: Admin,
  clientId: string,
  phone: string,
  firstName: string,
): Promise<void> {
  const cfg = whatsappConfigFromEnv();
  if (!cfg) return;
  const { data } = await admin
    .from("whatsapp_conversations")
    .select("id, state")
    .eq("phone", phone)
    .maybeSingle();
  const conv = data as { id: string; state: ConversationState } | null;
  if (!conv || !["awaiting_consent", "new", "idle"].includes(conv.state)) return;

  const now = new Date();
  const done = await checkedInToday(admin, clientId, now);
  const replies: Array<{ kind: "text"; body: string }> = done
    ? [
        {
          kind: "text",
          body: `Thank you ${firstName}, your consent is signed and saved to your profile.`,
        },
      ]
    : [
        { kind: "text", body: ONBOARD_MSG.consentDone(firstName) },
        { kind: "text", body: MSG.askPain },
      ];

  await admin
    .from("whatsapp_conversations")
    .update({
      client_id: clientId,
      state: done ? "idle" : "awaiting_pain",
      draft: done ? {} : { notes: [] },
      checkin_started_at: done ? null : now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", conv.id);

  for (const reply of replies) {
    let id: string | null = null;
    let ok = false;
    try {
      id =
        (await cfg.provider.send({ ...reply, to: phone }, cfg.secrets)).providerMessageId || null;
      ok = true;
    } catch {
      /* logged as not delivered below */
    }
    await admin
      .from("whatsapp_outbound")
      .insert({
        phone,
        client_id: clientId,
        provider: cfg.provider.id,
        provider_message_id: id,
        kind: "text",
        body: reply.body,
        sent_ok: ok,
      })
      .then(
        () => undefined,
        () => undefined,
      );
  }
}
