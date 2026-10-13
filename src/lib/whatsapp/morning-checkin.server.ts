/**
 * Sends the weekday morning check-in from the WhatsApp minute job.
 *
 * One row in practitioner_morning_checkins per practitioner: enabled is the
 * opt-out (no row means on), last_sent_on is the South African date of the
 * last attempt so a second tick the same morning does not send again.
 *
 * Inside the practitioner's 24 hour window the note is an interactive message
 * with the three buttons. Outside it, the approved template
 * WHATSAPP_MORNING_CHECKIN_TEMPLATE ({{1}} first name, quick replies in
 * MORNING_BUTTONS order). If that env var is unset, the send is skipped and
 * logged. It is not an error, and the template is not submitted from here.
 */
import { log } from "@/lib/log";
import { maskPhone } from "./phone";
import {
  MORNING_BUTTONS,
  MORNING_MSG,
  morningCheckinDate,
  morningCheckinDue,
} from "./morning-checkin";
import {
  bucketOf,
  loadClientList,
  loadStatuses,
  practitionerContact,
  sendLogged,
  windowOpen,
  type SendEnv,
} from "./practitioner-status.server";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type DbError = { code?: string; message?: string } | null;
type DbResult = { data: unknown; error: DbError };

interface Query extends PromiseLike<DbResult> {
  select: (columns?: string) => Query;
  eq: (column: string, value: unknown) => Query;
  is: (column: string, value: unknown) => Query;
  limit: (count: number) => Query;
  maybeSingle: () => Promise<DbResult>;
  update: (values: Record<string, unknown>) => Query;
  insert: (values: Record<string, unknown>) => Promise<DbResult>;
}

type Db = { from: (table: string) => Query };

function rowsOf<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

type PrefRow = {
  practitioner_id: string;
  enabled: boolean;
  last_sent_on: string | null;
};

function sentOn(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value).slice(0, 10);
}

export async function saveMorningCheckinEnabled(
  adminIn: Admin,
  userId: string,
  enabled: boolean,
  now: Date,
): Promise<boolean> {
  const admin = adminIn as unknown as Db;
  const { data, error: readError } = await admin
    .from("practitioner_morning_checkins")
    .select("last_sent_on")
    .eq("practitioner_id", userId)
    .maybeSingle();
  if (readError) {
    log.warn("morning check-in preference not saved", { code: readError.code });
    return false;
  }
  const row = {
    practitioner_id: userId,
    enabled,
    last_sent_on: sentOn((data as { last_sent_on?: unknown } | null)?.last_sent_on),
    updated_at: now.toISOString(),
  };
  if (data) {
    const { error } = await admin
      .from("practitioner_morning_checkins")
      .update({ enabled, updated_at: row.updated_at })
      .eq("practitioner_id", userId);
    if (error) log.warn("morning check-in preference not saved", { code: error.code });
    return !error;
  }
  const { error } = await admin.from("practitioner_morning_checkins").insert(row);
  if (error) log.warn("morning check-in preference not saved", { code: error.code });
  return !error;
}

async function claim(
  admin: Db,
  id: string,
  today: string,
  now: Date,
  existing: PrefRow | undefined,
): Promise<boolean> {
  if (existing?.enabled === false) return false;
  if (existing && sentOn(existing.last_sent_on) === today) return false;
  if (!existing) {
    const { error } = await admin.from("practitioner_morning_checkins").insert({
      practitioner_id: id,
      enabled: true,
      last_sent_on: today,
      updated_at: now.toISOString(),
    });
    return !error;
  }
  const update = admin
    .from("practitioner_morning_checkins")
    .update({ last_sent_on: today, updated_at: now.toISOString() })
    .eq("practitioner_id", id)
    .eq("enabled", true);
  const filtered = existing.last_sent_on
    ? update.eq("last_sent_on", sentOn(existing.last_sent_on))
    : update.is("last_sent_on", null);
  const { data, error } = await filtered.select("practitioner_id");
  if (error) return false;
  return rowsOf(data).length > 0;
}

async function release(admin: Db, id: string, previous: string | null): Promise<void> {
  await admin
    .from("practitioner_morning_checkins")
    .update({ last_sent_on: previous })
    .eq("practitioner_id", id);
}

type Deliver = "sent" | "skipped" | "failed";

async function deliver(adminIn: Admin, env: SendEnv, userId: string, now: Date): Promise<Deliver> {
  const contact = await practitionerContact(adminIn, userId);
  if (!contact.phone) {
    log.warn("morning check-in skipped: no phone");
    return "skipped";
  }
  const body = MORNING_MSG.ask(contact.firstName);
  if (await windowOpen(adminIn, contact.phone, now)) {
    const ok = await sendLogged(
      adminIn,
      env,
      { kind: "buttons", to: contact.phone, body, buttons: MORNING_BUTTONS },
      body,
    );
    return ok ? "sent" : "failed";
  }
  const template = process.env.WHATSAPP_MORNING_CHECKIN_TEMPLATE?.trim();
  if (!template) {
    log.warn("morning check-in skipped: window closed and no template", {
      to: maskPhone(contact.phone),
    });
    return "skipped";
  }
  const ok = await sendLogged(
    adminIn,
    env,
    {
      kind: "template",
      to: contact.phone,
      templateName: template,
      languageCode: process.env.WHATSAPP_MORNING_CHECKIN_TEMPLATE_LANG?.trim() || "en",
      variables: [contact.firstName],
      buttonPayloads: MORNING_BUTTONS.map((b) => b.id),
    },
    `[morning check-in template ${template}]`,
  );
  return ok ? "sent" : "failed";
}

/**
 * Practitioners with at least one current patient. Best effort: a missing
 * table or one bad row waits for the next minute instead of failing the worker.
 */
export async function runMorningCheckins(
  adminIn: Admin,
  env: SendEnv,
  now = new Date(),
): Promise<void> {
  if (!morningCheckinDue(now)) return;
  const admin = adminIn as unknown as Db;
  const today = morningCheckinDate(now);
  try {
    const { data: prefRows, error: prefError } = await admin
      .from("practitioner_morning_checkins")
      .select("practitioner_id, enabled, last_sent_on")
      .limit(2000);
    if (prefError) {
      log.warn("morning check-in skipped: preferences unavailable", { code: prefError.code });
      return;
    }
    const prefs = new Map<string, PrefRow>();
    for (const row of rowsOf<PrefRow>(prefRows)) {
      prefs.set(row.practitioner_id, {
        practitioner_id: row.practitioner_id,
        enabled: row.enabled !== false,
        last_sent_on: sentOn(row.last_sent_on),
      });
    }

    const { data: clientRows, error: clientError } = await admin
      .from("clients")
      .select("practitioner_id")
      .limit(5000);
    if (clientError) {
      log.warn("morning check-in skipped: clients unavailable", { code: clientError.code });
      return;
    }
    const ids = [
      ...new Set(
        rowsOf<{ practitioner_id: string | null }>(clientRows)
          .map((c) => c.practitioner_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    for (const id of ids) {
      const pref = prefs.get(id);
      if (pref?.enabled === false) continue;
      if (pref && sentOn(pref.last_sent_on) === today) continue;
      try {
        const list = await loadClientList(adminIn, id, false);
        const statuses = await loadStatuses(adminIn, list, now);
        if (!statuses.some((s) => bucketOf(s, now) !== "inactive")) continue;
        const claimed = await claim(admin, id, today, now, pref);
        if (!claimed) continue;
        const result = await deliver(adminIn, env, id, now);
        if (result === "failed") await release(admin, id, pref?.last_sent_on ?? null);
      } catch (e) {
        await release(admin, id, pref?.last_sent_on ?? null).catch(() => undefined);
        log.warn("morning check-in failed", {
          error: e instanceof Error ? e.message : "unknown",
        });
      }
    }
  } catch (e) {
    log.warn("morning check-in failed", {
      error: e instanceof Error ? e.message : "unknown",
    });
  }
}
