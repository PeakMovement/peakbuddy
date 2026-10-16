/**
 * Quiet patients: tell the physio the same day, and send the existing
 * check-in reminder only after they confirm. Capped at three sends per
 * 30 days, and not more than once a week. Off unless QUIET_PATIENT_NUDGE=1.
 */
import { log } from "@/lib/log";
import { quietNudgeDecision } from "@/lib/capabilities";
import { morningCheckinDate } from "./morning-checkin";
import { maskPhone } from "./phone";
import type { ProviderSecrets, WhatsAppProvider } from "./provider";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type SendEnv = { provider: WhatsAppProvider; secrets: ProviderSecrets };

interface Chain extends PromiseLike<{ data: unknown; error: { message?: string } | null }> {
  select: (columns?: string) => Chain;
  eq: (column: string, value: unknown) => Chain;
  in: (column: string, value: unknown[]) => Chain;
  order: (column: string, opts?: { ascending: boolean }) => Chain;
  limit: (count: number) => Chain;
  update: (values: Record<string, unknown>) => Chain;
  insert: (values: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>;
}

function db(admin: Admin) {
  return admin as unknown as { from: (table: string) => Chain };
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

type Nudge = {
  client_id: string;
  last_physio_notified_on: string | null;
  last_patient_sent_on: string | null;
  nudges_in_window: number;
  window_started_on: string | null;
  pending_confirm: boolean;
};

export async function runQuietNudges(adminIn: Admin, env: SendEnv, now = new Date()): Promise<void> {
  if (process.env.QUIET_PATIENT_NUDGE !== "1") return;
  const admin = db(adminIn);
  const today = morningCheckinDate(now);
  try {
    const { data: clientRows, error } = await admin
      .from("clients")
      .select("id, full_name, practitioner_id, created_at")
      .limit(1000);
    if (error) {
      log.warn("quiet nudge skipped: clients unavailable");
      return;
    }
    const clients = rows<{
      id: string;
      full_name: string | null;
      practitioner_id: string | null;
      created_at: string | null;
    }>(clientRows);
    const discharged = new Set<string>();
    const episode = await admin.from("clients").select("id, discharged_at").limit(1000);
    if (!episode.error) {
      for (const row of rows<{ id: string; discharged_at?: string | null }>(episode.data)) {
        if (row.discharged_at) discharged.add(row.id);
      }
    }
    const { data: checkRows } = await admin
      .from("check_ins")
      .select("client_id, created_at")
      .order("created_at", { ascending: false })
      .limit(3000);
    const latest = new Map<string, string>();
    for (const row of rows<{ client_id: string; created_at: string }>(checkRows)) {
      if (!latest.has(row.client_id)) latest.set(row.client_id, row.created_at);
    }
    const { data: nudgeRows } = await admin
      .from("quiet_patient_nudges")
      .select(
        "client_id, last_physio_notified_on, last_patient_sent_on, nudges_in_window, window_started_on, pending_confirm",
      )
      .limit(1000);
    const nudges = new Map(rows<Nudge>(nudgeRows).map((n) => [n.client_id, n]));
    const tell = new Map<string, string[]>();
    const { windowOpen, practitionerContact, sendLogged } = await import(
      "./practitioner-status.server"
    );
    for (const client of clients) {
      if (!client.practitioner_id) continue;
      if (discharged.has(client.id)) continue;
      const at = latest.get(client.id) ?? client.created_at;
      const quietDays = at ? Math.floor((now.getTime() - new Date(at).getTime()) / 86_400_000) : 99;
      const nudge = nudges.get(client.id);
      const decision = quietNudgeDecision({
        quietDays,
        lastPhysioNotifiedOn: nudge?.last_physio_notified_on ?? null,
        lastPatientSentOn: nudge?.last_patient_sent_on ?? null,
        nudgesInWindow: nudge?.nudges_in_window ?? 0,
        today,
        featureEnabled: true,
        practitionerConfirmed: false,
        windowOpen: true,
        reminderTemplateSet: Boolean(process.env.WHATSAPP_REMINDER_TEMPLATE?.trim()),
      });
      if (!decision.tellPhysio) {
        if (decision.skipReason === "no_template") {
          log.warn("quiet nudge skipped: window closed and no template", {
            to: maskPhone("0000"),
          });
        }
        continue;
      }
      const name = (client.full_name || "A client").trim();
      const list = tell.get(client.practitioner_id) ?? [];
      list.push(`${name} (${quietDays} days)`);
      tell.set(client.practitioner_id, list);
      await upsertNudge(admin, client.id, {
        last_physio_notified_on: today,
        pending_confirm: true,
        nudges_in_window: nudge?.nudges_in_window ?? 0,
        window_started_on: nudge?.window_started_on ?? today,
        last_patient_sent_on: nudge?.last_patient_sent_on ?? null,
      });
    }
    for (const [practitionerId, names] of tell) {
      const contact = await practitionerContact(adminIn, practitionerId);
      const body = `Quiet patients: ${names.slice(0, 8).join("; ")}. Reply yes if you want me to send today's usual check-in reminder. I won't message them until you do.`;
      const open = contact.phone ? await windowOpen(adminIn, contact.phone, now) : false;
      if (contact.phone && open) {
        await sendLogged(adminIn, env, { kind: "text", to: contact.phone, body }, body);
      } else if (contact.phone && process.env.WHATSAPP_PRAC_UPDATE_TEMPLATE?.trim()) {
        const template = process.env.WHATSAPP_PRAC_UPDATE_TEMPLATE.trim();
        await sendLogged(
          adminIn,
          env,
          {
            kind: "template",
            to: contact.phone,
            templateName: template,
            languageCode: process.env.WHATSAPP_PRAC_UPDATE_TEMPLATE_LANG?.trim() || "en",
            variables: [contact.firstName || "there", String(names.length)],
            buttonPayloads: ["prac_status"],
          },
          `[quiet nudge template ${template}]`,
        );
      } else {
        log.warn("quiet nudge physio note skipped: window closed and no template");
      }
    }
  } catch (e) {
    log.warn("quiet nudge failed", { error: e instanceof Error ? e.message : "unknown" });
  }
}

export async function sendPendingQuietNudges(
  adminIn: Admin,
  _env: SendEnv,
  practitionerId: string,
  now: Date,
): Promise<number> {
  const admin = db(adminIn);
  const today = morningCheckinDate(now);
  const { data: clientRows } = await admin
    .from("clients")
    .select("id")
    .eq("practitioner_id", practitionerId)
    .limit(1000);
  const ids = rows<{ id: string }>(clientRows).map((c) => c.id);
  if (!ids.length) return 0;
  const { data: nudgeRows } = await admin
    .from("quiet_patient_nudges")
    .select("client_id, nudges_in_window, window_started_on, pending_confirm")
    .in("client_id", ids)
    .limit(1000);
  const pending = rows<Nudge>(nudgeRows).filter((n) => n.pending_confirm);
  const { sendWhatsAppReminder } = await import("./worker.server");
  let sent = 0;
  for (const nudge of pending) {
    const result = await sendWhatsAppReminder(adminIn, nudge.client_id, now).catch(() => "failed" as const);
    if (result === "window_closed") {
      log.warn("quiet nudge skipped: window closed and no template");
    }
    if (result !== "sent") continue;
    const window = nudge.window_started_on ?? today;
    const reset = window < daysBefore(today, 30);
    await upsertNudge(admin, nudge.client_id, {
      pending_confirm: false,
      last_patient_sent_on: today,
      nudges_in_window: reset ? 1 : (nudge.nudges_in_window ?? 0) + 1,
      window_started_on: reset ? today : window,
      last_physio_notified_on: today,
    });
    sent += 1;
  }
  return sent;
}

async function upsertNudge(
  admin: { from: (table: string) => Chain },
  clientId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const { data } = await admin
    .from("quiet_patient_nudges")
    .select("client_id")
    .eq("client_id", clientId)
    .limit(1);
  if (rows(data).length) {
    await admin.from("quiet_patient_nudges").update(values).eq("client_id", clientId);
    return;
  }
  await admin.from("quiet_patient_nudges").insert({ client_id: clientId, ...values });
}

function daysBefore(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
