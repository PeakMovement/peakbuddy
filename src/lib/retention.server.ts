/**
 * Retention rule, the same one in the current consent (version 2026-10-07.1)
 * and on /data-deletion:
 *
 * WhatsApp messages stay with the clinical record for as long as that record
 * is kept. They are not deleted on a 90 day timer. When the patient record is
 * gone, the messages go with it. This job removes rows that are no longer
 * attached to a patient (account delete, or a number that never became one)
 * after a day, so a half-finished sign-up is not wiped mid-conversation.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { CLINICAL_RECORD_RETENTION } from "@/lib/consent/wording";
import { toE164Digits } from "@/lib/whatsapp/phone";

export const WHATSAPP_ORPHAN_AFTER_MS = 24 * 60 * 60 * 1000;

export const RETENTION_RULE = CLINICAL_RECORD_RETENTION;

type Admin = SupabaseClient;

export function orphanCutoff(now: Date = new Date()): string {
  return new Date(now.getTime() - WHATSAPP_ORPHAN_AFTER_MS).toISOString();
}

async function deleteCount(
  admin: Admin,
  table: string,
  apply: (q: any) => any,
): Promise<number> {
  const { error, count } = await apply(
    admin.from(table).delete({ count: "exact" } as never),
  );
  if (error) throw new Error(`${table} retention delete failed: ${error.code ?? error.message}`);
  return count ?? 0;
}

export async function runWhatsAppRetention(
  admin: Admin,
  now: Date = new Date(),
): Promise<{ inbound: number; outbound: number; conversations: number }> {
  const cutoff = orphanCutoff(now);
  const inbound = await deleteCount(admin, "whatsapp_inbound", (q) =>
    q.is("client_id", null).lt("received_at", cutoff),
  );
  const outbound = await deleteCount(admin, "whatsapp_outbound", (q) =>
    q.is("client_id", null).lt("created_at", cutoff),
  );
  const conversations = await deleteCount(admin, "whatsapp_conversations", (q) =>
    q.is("client_id", null).eq("state", "unmatched").lt("updated_at", cutoff),
  );
  return { inbound, outbound, conversations };
}

/** Phone spellings stored on WhatsApp tables for one patient number. */
export function phoneKeys(phone: string | null | undefined): string[] {
  if (!phone) return [];
  const digits = phone.replace(/\D/g, "");
  const keys = new Set<string>();
  if (phone.trim()) keys.add(phone.trim());
  if (digits) {
    keys.add(digits);
    keys.add(`+${digits}`);
  }
  const e164 = toE164Digits(phone);
  if (e164) {
    keys.add(e164);
    keys.add(`+${e164}`);
  }
  return [...keys];
}

/**
 * Removes WhatsApp rows for this patient before the client row is deleted.
 * The foreign key would only clear client_id and leave the phone and the text.
 */
export async function deleteWhatsAppForPatient(
  admin: Admin,
  client: { id: string; phone: string | null },
): Promise<void> {
  const keys = phoneKeys(client.phone);
  await admin.from("whatsapp_inbound").delete().eq("client_id", client.id);
  await admin.from("whatsapp_outbound").delete().eq("client_id", client.id);
  await admin.from("whatsapp_conversations").delete().eq("client_id", client.id);
  for (const key of keys) {
    await admin.from("whatsapp_inbound").delete().eq("from_phone", key);
    await admin.from("whatsapp_outbound").delete().eq("phone", key);
    await admin.from("whatsapp_conversations").delete().eq("phone", key);
  }
}
