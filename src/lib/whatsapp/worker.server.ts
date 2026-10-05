import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import { currentConsent, renderConsentText } from "@/lib/consent/wording";
import { toSast } from "./clinic-hours";
import {
  decide,
  readPain,
  MSG,
  type CheckinDraft,
  type ConversationState,
  type Decision,
  type InboundForDecision,
} from "./conversation";
import { maskPhone, matchPhone, toE164Digits } from "./phone";
import { getProvider, type ProviderSecrets, type WhatsAppProvider } from "./provider";
import { runRedFlagRules, type RuleLayerResult } from "./red-flag-rules";

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
}

interface ClientRow {
  id: string;
  full_name: string | null;
  practitioner_id: string;
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
      "id, provider, provider_message_id, from_phone, kind, body, reply_id, reply_title, received_at",
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

async function loadConversation(admin: Admin, phone: string): Promise<ConversationRow> {
  const cols =
    "id, phone, client_id, state, draft, checkin_started_at, opted_out_at, unmatched_notice_at";
  const { data: existing } = await admin
    .from("whatsapp_conversations")
    .select(cols)
    .eq("phone", phone)
    .maybeSingle();
  if (existing) return existing as ConversationRow;

  const { data: created, error } = await admin
    .from("whatsapp_conversations")
    .insert({ phone, state: "new" })
    .select(cols)
    .single();
  if (created) return created as ConversationRow;

  // Lost a race with a parallel worker. The row exists now.
  const { data: again } = await admin
    .from("whatsapp_conversations")
    .select(cols)
    .eq("phone", phone)
    .maybeSingle();
  if (again) return again as ConversationRow;
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

  // Link to a profile. Retried on every message until it succeeds, because the
  // practitioner may add the number after the patient first writes in.
  let clientId = conv.client_id;
  if (!clientId) clientId = await findClientIdByPhone(admin, phone);

  let client: ClientRow | null = null;
  if (clientId) {
    const { data } = await admin
      .from("clients")
      .select("id, full_name, practitioner_id")
      .eq("id", clientId)
      .maybeSingle();
    client = (data as ClientRow | null) ?? null;
    if (!client) clientId = null;
  }

  const message: InboundForDecision = {
    text: row.body || row.reply_title || "",
    replyId: row.reply_id ?? undefined,
    kind: row.kind,
  };

  // A conversation that was unmatched and has just been matched starts fresh.
  let state: ConversationState = conv.state;
  if (client && state === "unmatched") state = "new";

  const [consent, today, prevPain] = client
    ? await Promise.all([
        hasCurrentConsent(admin, client.id),
        checkedInToday(admin, client.id, now),
        previousPain(admin, client.id),
      ])
    : [false, false, null];

  // Layer 1 safety runs on every message, whatever the conversation state,
  // before anything else is decided.
  const painNow = state === "awaiting_pain" ? readPain(message) : null;
  const redFlags = runRedFlagRules({
    text: row.body ?? "",
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

  let sent = 0;
  for (const reply of replies) {
    try {
      await env.provider.send(
        { ...reply, to: phone } as Parameters<WhatsAppProvider["send"]>[0],
        env.secrets,
      );
      sent++;
    } catch (e) {
      // Status only, never the text.
      log.warn("whatsapp worker: send failed", {
        to: maskPhone(phone),
        error: e instanceof Error ? e.message.slice(0, 120) : "unknown",
      });
    }
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

  if (decision.contactRequest) {
    await raiseContactAlert(
      admin,
      client,
      `${firstNameOf(client.full_name)} asked on WhatsApp to be contacted.`,
    ).catch(() => {});
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
      await sendPushCore(supabaseAdmin, {
        userId: client.practitioner_id,
        title: "Buddy alert",
        body: `${firstName} reported symptoms on WhatsApp that may need review`,
        data: { clientId: client.id, kind: "whatsapp" },
      });
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
