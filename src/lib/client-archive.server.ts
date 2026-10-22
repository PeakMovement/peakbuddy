/**
 * Archiving clients who have stopped responding (22 Oct 2026, Justin).
 *
 * Archive, not delete: clinical records are kept (HPCSA retention), the
 * client drops off practitioner lists, updates and digests, and Buddy sends
 * them no more reminders, nudges or programme reminders. "Unarchive" brings
 * them back. If an archived client writes to Buddy themselves they are
 * unarchived automatically, and red flags are always handled.
 *
 * Only practice owners (and super admins) archive, from WhatsApp.
 *
 * Column clients.archived_at comes from migration 0042_client_archive. Until
 * it is applied every read here falls back to the unfiltered query, so a
 * publish before the migration cannot empty anyone's client list.
 */
import { log } from "@/lib/log";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type Db = { from: (t: string) => any };
type Result<T> = { data: T | null; error: { message?: string; code?: string } | null };

const DAY = 86_400_000;

/** Default for "archive the ones who've stopped responding": Buddy's own "inactive". */
export const DEFAULT_IDLE_DAYS = 60;
export const MAX_ARCHIVE = 50;

export function archiveColumnMissing(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || /archived_at/i.test(String(error.message ?? ""));
}

/**
 * Run a client read without archived clients. `filtered` is true when the
 * query should add `.is("archived_at", null)`. Falls back to the plain query
 * if the column isn't there yet.
 */
export async function withoutArchived<T>(
  run: (filtered: boolean) => PromiseLike<Result<T>>,
): Promise<Result<T>> {
  let first: Result<T>;
  try {
    first = await run(true);
  } catch {
    // A query builder without .is (some test doubles): read unfiltered.
    return run(false);
  }
  if (archiveColumnMissing(first.error)) return run(false);
  return first;
}

/** Owner of a practice, a practice member with the owner role, or a super admin. */
export async function canArchive(adminIn: Admin, userId: string): Promise<boolean> {
  const admin = adminIn as unknown as Db;
  const [{ data: owned }, { data: member }, { data: prof }] = await Promise.all([
    admin.from("practices").select("id").eq("practitioner_id", userId).limit(1),
    admin
      .from("practice_members")
      .select("role")
      .eq("user_id", userId)
      .eq("status", "active")
      .eq("role", "owner")
      .limit(1),
    admin.from("profiles").select("role").eq("id", userId).maybeSingle(),
  ]);
  if (((owned ?? []) as unknown[]).length) return true;
  if (((member ?? []) as unknown[]).length) return true;
  return (prof as { role?: string } | null)?.role === "super_admin";
}

export async function archiveClients(
  adminIn: Admin,
  ids: string[],
  byUserId: string,
  now: Date,
): Promise<{ ok: boolean; count: number }> {
  if (!ids.length) return { ok: true, count: 0 };
  const admin = adminIn as unknown as Db;
  const { data, error } = await admin
    .from("clients")
    .update({ archived_at: now.toISOString(), archived_by: byUserId })
    .in("id", ids)
    .is("archived_at", null)
    .select("id");
  if (error) {
    log.warn("archive clients failed", { code: error.code, missing: archiveColumnMissing(error) });
    return { ok: false, count: 0 };
  }
  return { ok: true, count: ((data ?? []) as unknown[]).length };
}

export async function unarchiveClients(
  adminIn: Admin,
  ids: string[],
): Promise<{ ok: boolean; count: number }> {
  if (!ids.length) return { ok: true, count: 0 };
  const admin = adminIn as unknown as Db;
  const { data, error } = await admin
    .from("clients")
    .update({ archived_at: null, archived_by: null })
    .in("id", ids)
    .not("archived_at", "is", null)
    .select("id");
  if (error) {
    log.warn("unarchive clients failed", { code: error.code });
    return { ok: false, count: 0 };
  }
  return { ok: true, count: ((data ?? []) as unknown[]).length };
}

/** An archived client wrote in: they're back. Best effort, never throws. */
export async function unarchiveOnContact(adminIn: Admin, clientId: string): Promise<boolean> {
  try {
    const r = await unarchiveClients(adminIn, [clientId]);
    return r.count > 0;
  } catch {
    return false;
  }
}

/** Archived clients the owner can bring back: their practices, or everyone for a super admin. */
export async function loadArchivedInScope(
  adminIn: Admin,
  userId: string,
): Promise<Array<{ id: string; full_name: string | null }>> {
  const admin = adminIn as unknown as Db;
  const [{ data: owned }, { data: member }, { data: prof }] = await Promise.all([
    admin.from("practices").select("id").eq("practitioner_id", userId),
    admin
      .from("practice_members")
      .select("practice_id, role")
      .eq("user_id", userId)
      .eq("status", "active"),
    admin.from("profiles").select("role").eq("id", userId).maybeSingle(),
  ]);
  const practiceIds = [
    ...((owned ?? []) as Array<{ id: string }>).map((p) => p.id),
    ...((member ?? []) as Array<{ practice_id: string; role: string }>)
      .filter((m) => m.role === "owner")
      .map((m) => m.practice_id),
  ];
  const superAdmin = (prof as { role?: string } | null)?.role === "super_admin";
  let q = admin.from("clients").select("id, full_name").not("archived_at", "is", null);
  if (practiceIds.length) q = q.in("practice_id", practiceIds);
  else if (!superAdmin) return [];
  const { data, error } = await q.limit(1000);
  if (error) return [];
  return (data ?? []) as Array<{ id: string; full_name: string | null }>;
}

export interface IdleResult {
  idle: Array<{ id: string; full_name: string | null }>;
  /** Idle but with an open alert: left alone so nothing urgent is hidden. */
  heldBack: Array<{ id: string; full_name: string | null }>;
}

/**
 * Clients with no check-in and no WhatsApp message from them for `days`,
 * who joined more than `days` ago.
 */
export async function findIdleClients(
  adminIn: Admin,
  clients: Array<{ id: string; full_name: string | null }>,
  days: number,
  now: Date,
): Promise<IdleResult> {
  const admin = adminIn as unknown as Db;
  const span = Math.min(365, Math.max(7, Math.round(days))) * DAY;
  const since = new Date(now.getTime() - span).toISOString();
  const ids = clients.map((c) => c.id);
  if (!ids.length) return { idle: [], heldBack: [] };
  const active = new Set<string>();
  const open = new Set<string>();
  const joined = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const [ci, wa, al, cl] = await Promise.all([
      admin
        .from("check_ins")
        .select("client_id")
        .in("client_id", chunk)
        .gte("created_at", since)
        .limit(5000),
      admin
        .from("whatsapp_inbound")
        .select("client_id")
        .in("client_id", chunk)
        .gte("received_at", since)
        .limit(5000),
      admin
        .from("alerts")
        .select("client_id, is_read, reviewed_at")
        .in("client_id", chunk)
        .gte("created_at", new Date(now.getTime() - 14 * DAY).toISOString())
        .limit(2000),
      admin.from("clients").select("id, created_at").in("id", chunk).limit(1000),
    ]);
    for (const r of (ci.data ?? []) as Array<{ client_id: string }>) active.add(r.client_id);
    for (const r of (wa.data ?? []) as Array<{ client_id: string | null }>)
      if (r.client_id) active.add(r.client_id);
    for (const r of (al.data ?? []) as Array<{
      client_id: string;
      is_read: boolean | null;
      reviewed_at: string | null;
    }>)
      if (!r.is_read && !r.reviewed_at) open.add(r.client_id);
    for (const r of (cl.data ?? []) as Array<{ id: string; created_at: string | null }>)
      joined.set(r.id, r.created_at);
  }
  const idle: IdleResult["idle"] = [];
  const heldBack: IdleResult["heldBack"] = [];
  for (const c of clients) {
    if (active.has(c.id)) continue;
    const at = joined.get(c.id);
    if (at && now.getTime() - new Date(at).getTime() < span) continue;
    if (open.has(c.id)) heldBack.push(c);
    else idle.push(c);
  }
  return { idle, heldBack };
}
