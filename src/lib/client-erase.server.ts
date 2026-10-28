/**
 * Permanently erasing a client (28 Oct 2026, Justin: "the latter").
 *
 * Super admins only. Used by the admin site and by WhatsApp ("delete Sam").
 * WhatsApp rows for the patient go first (they are keyed by phone as well as
 * client id), then the client row, which cascades to check-ins, alerts and the
 * rest. The login is removed last. client_admin_audit keeps the id, the
 * channel and who did it, never any patient text.
 *
 * Practice owners who are not super admins archive instead (client-archive).
 */
import { log } from "@/lib/log";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type Db = { from: (t: string) => any };

/** WhatsApp erases at most this many in one confirmation. */
export const MAX_ERASE = 10;

export async function isSuperAdmin(adminIn: Admin, userId: string): Promise<boolean> {
  const admin = adminIn as unknown as Db;
  const { data } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  return (data as { role?: string } | null)?.role === "super_admin";
}

/** Check-in counts, so the confirmation says what is about to go. */
export async function checkinCounts(adminIn: Admin, ids: string[]): Promise<Map<string, number>> {
  const admin = adminIn as unknown as Db;
  const counts = new Map<string, number>();
  if (!ids.length) return counts;
  try {
    const { data } = await admin
      .from("check_ins")
      .select("client_id")
      .in("client_id", ids)
      .limit(20000);
    for (const r of (data ?? []) as Array<{ client_id: string }>) {
      counts.set(r.client_id, (counts.get(r.client_id) ?? 0) + 1);
    }
  } catch {
    // Counts are only for the readback.
  }
  return counts;
}

export type EraseResult = { ok: true } | { ok: false; error: string };

export async function eraseClient(
  adminIn: Admin,
  clientId: string,
  actorId: string,
  channel: "whatsapp" | "admin",
): Promise<EraseResult> {
  const admin = adminIn as unknown as Db;
  const { data: client, error: cErr } = await admin
    .from("clients")
    .select("id, auth_user_id, email, phone")
    .eq("id", clientId)
    .maybeSingle();
  if (cErr) return { ok: false, error: cErr.message ?? "read failed" };
  if (!client) return { ok: false, error: "Client not found." };
  const row = client as {
    id: string;
    auth_user_id: string | null;
    email: string | null;
    phone: string | null;
  };

  const { deleteWhatsAppForPatient } = await import("@/lib/retention.server");
  await deleteWhatsAppForPatient(adminIn, { id: row.id, phone: row.phone });

  const { error: delErr } = await admin.from("clients").delete().eq("id", row.id);
  if (delErr) return { ok: false, error: delErr.message ?? "delete failed" };

  try {
    const { error: auditErr } = await admin.from("client_admin_audit").insert({
      client_id: row.id,
      action: "erase",
      channel,
      actor_id: actorId,
    });
    if (auditErr) log.warn("client erase audit failed", { code: auditErr.code });
  } catch {
    log.warn("client erase audit failed", { code: "throw" });
  }

  let authUserId: string | null = row.auth_user_id ?? null;
  if (!authUserId && row.email) {
    const { findAuthUserIdByEmail } = await import("@/lib/find-auth-user");
    authUserId = await findAuthUserIdByEmail(adminIn as never, row.email);
  }
  if (authUserId) {
    try {
      await adminIn.auth.admin.deleteUser(authUserId);
    } catch {
      log.warn("client erase login delete failed", { code: "auth" });
    }
  }
  return { ok: true };
}
