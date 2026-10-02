import type { InboundMessage, StatusUpdate } from "./provider";
import type { InboundStore } from "./webhook-handler";

/**
 * Database-backed inbound queue.
 *
 * The webhook's only job is to get the message onto disk and answer the
 * provider. Everything after that (matching a phone number to a patient,
 * extraction, red flag rules, alerting) runs from this table, so a slow model
 * call can never cause WhatsApp to retry a delivery.
 *
 * The raw payload is stored because a clinical record of what the patient
 * actually sent is worth more than the storage it costs, and because any bug
 * in extraction is only diagnosable if the original survived. It is also why
 * this table needs a retention period set before any real patient uses it.
 */

const TABLE = "whatsapp_inbound";
const STATUS_TABLE = "whatsapp_message_status";

type Admin = {
  from: (t: string) => {
    insert: (rows: unknown) => Promise<{ error: { code?: string; message?: string } | null }>;
    upsert: (
      rows: unknown,
      opts?: Record<string, unknown>,
    ) => Promise<{ error: { code?: string; message?: string } | null }>;
  };
};

/** Postgres unique_violation. Means the provider redelivered, which is normal. */
const UNIQUE_VIOLATION = "23505";

export function createInboundStore(admin: Admin): InboundStore {
  return {
    async enqueue(message: InboundMessage) {
      const { error } = await admin.from(TABLE).insert({
        provider: message.providerId,
        provider_message_id: message.providerMessageId,
        from_phone: message.from,
        to_phone: message.to,
        kind: message.kind,
        body: message.text,
        reply_id: message.reply?.id ?? null,
        reply_title: message.reply?.title ?? null,
        media_id: message.media?.id ?? null,
        media_mime_type: message.media?.mimeType ?? null,
        sent_at: message.sentAt.toISOString(),
        status: "pending",
      });

      if (!error) return "stored";
      if (error.code === UNIQUE_VIOLATION) return "duplicate";
      // Anything else is a real failure. Throw so the handler counts it and
      // the route logs a count, never the message.
      throw new Error(`inbound insert failed: ${error.code ?? "unknown"}`);
    },

    async recordStatus(update: StatusUpdate) {
      const { error } = await admin.from(STATUS_TABLE).upsert(
        {
          provider: update.providerId,
          provider_message_id: update.providerMessageId,
          status: update.status,
          error_text: update.error ?? null,
          occurred_at: update.at.toISOString(),
        },
        { onConflict: "provider,provider_message_id,status" },
      );
      if (error && error.code !== UNIQUE_VIOLATION) {
        throw new Error(`status upsert failed: ${error.code ?? "unknown"}`);
      }
    },
  };
}
