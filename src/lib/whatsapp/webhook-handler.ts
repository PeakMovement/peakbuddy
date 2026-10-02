import {
  getProvider,
  type InboundMessage,
  type ProviderSecrets,
  type RawWebhookRequest,
  type StatusUpdate,
  type WhatsAppProviderId,
} from "./provider";

/**
 * The provider-agnostic half of the webhook. Kept out of the route file so it
 * can be tested without standing up a server, because the two things that
 * matter here are both easy to get silently wrong:
 *
 *   1. A forged request must never be accepted. Signature verification happens
 *      before anything is parsed, and a failure returns 403 without telling the
 *      caller why.
 *   2. A genuine request must never be lost. Providers retry on any non-2xx,
 *      so this returns 200 even when our own storage fails, and records the
 *      failure instead of inviting a redelivery storm. Duplicate deliveries are
 *      expected and are made harmless by the provider's own message id.
 *
 * Nothing here logs message content. A patient's words go to storage and
 * nowhere else.
 */

export interface InboundStore {
  /**
   * Persist a message. Returns "stored" or "duplicate". Must be idempotent on
   * providerMessageId: the same id twice is the normal case, not an error.
   */
  enqueue(message: InboundMessage): Promise<"stored" | "duplicate">;
  recordStatus(update: StatusUpdate): Promise<void>;
}

export interface WebhookEnv {
  provider: WhatsAppProviderId;
  secrets: ProviderSecrets;
  store: InboundStore;
}

export interface WebhookOutcome {
  status: number;
  body: string;
  /** Counts only, safe to log. Never message content. */
  summary: {
    accepted: number;
    duplicates: number;
    statuses: number;
    failed: number;
    rejected?: "signature" | "provider" | "unparseable";
  };
}

/**
 * Meta's GET handshake. Twilio has no equivalent, so this is only ever reached
 * when the configured provider is Meta.
 */
export function verifyHandshake(
  params: URLSearchParams,
  secrets: ProviderSecrets,
): { status: number; body: string } {
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge") ?? "";
  const expected = secrets.verifyToken ?? "";

  // No token configured means the handshake can never be satisfied. Fail shut
  // rather than echoing the challenge back to anyone who asks.
  if (!expected) return { status: 403, body: "" };
  if (mode !== "subscribe") return { status: 403, body: "" };
  if (token !== expected) return { status: 403, body: "" };
  return { status: 200, body: challenge };
}

export async function handleWebhook(
  req: RawWebhookRequest,
  env: WebhookEnv,
): Promise<WebhookOutcome> {
  const empty = { accepted: 0, duplicates: 0, statuses: 0, failed: 0 };
  let provider;
  try {
    provider = getProvider(env.provider);
  } catch {
    return { status: 500, body: "", summary: { ...empty, rejected: "provider" } };
  }

  let signatureOk = false;
  try {
    signatureOk = await provider.verifySignature(req, env.secrets);
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) {
    // 403, no detail. An attacker learns nothing about why it failed, and a
    // 403 is not retried, so a genuinely misconfigured secret surfaces as a
    // flat wall rather than as silence.
    return { status: 403, body: "", summary: { ...empty, rejected: "signature" } };
  }

  let payload;
  try {
    payload = provider.parseWebhook(req);
  } catch {
    // Verified but unreadable. Still 200: retrying will not make it readable.
    return { status: 200, body: "", summary: { ...empty, rejected: "unparseable" } };
  }

  let accepted = 0;
  let duplicates = 0;
  let statuses = 0;
  let failed = 0;

  for (const message of payload.messages) {
    if (!message.providerMessageId || !message.from) {
      failed++;
      continue;
    }
    try {
      const result = await env.store.enqueue(message);
      if (result === "duplicate") duplicates++;
      else accepted++;
    } catch {
      // Swallowed on purpose. See the note at the top: a 500 here would make
      // the provider redeliver the whole batch, including the messages that
      // did store, and WhatsApp's backoff is aggressive.
      failed++;
    }
  }

  for (const update of payload.statuses) {
    try {
      await env.store.recordStatus(update);
      statuses++;
    } catch {
      failed++;
    }
  }

  return {
    status: 200,
    body: "",
    summary: { accepted, duplicates, statuses, failed },
  };
}
