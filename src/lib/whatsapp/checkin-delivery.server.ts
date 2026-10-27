/**
 * Loads today's check-in delivery picture and, once per South African day,
 * tells the super admin when a run was due and delivered nobody.
 * Counts only. Patient message text is not included in the alert.
 */
import { log } from "@/lib/log";
import { toSast } from "./clinic-hours";
import { maskPhone } from "./phone";
import {
  CHECKIN_ALERT_BUTTON,
  CHECKIN_ALERT_TEMPLATE,
  formatDeliveryReply,
  shouldAlertDelivery,
  summariseDelivery,
  type DeliveryMessage,
  type DeliveryReminder,
  type DeliverySummary,
} from "./checkin-delivery";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type Db = { from: (table: string) => any };

function sastStart(date: string): string {
  return new Date(`${date}T00:00:00+02:00`).toISOString();
}

export async function loadDeliverySummary(adminIn: Admin, now: Date): Promise<DeliverySummary> {
  const admin = adminIn as unknown as Db;
  const moment = toSast(now);
  const weekday = new Date(`${moment.date}T12:00:00Z`).getUTCDay();
  const since = sastStart(moment.date);
  const { data: reminders } = await admin
    .from("checkin_reminders")
    .select("client_id, days_of_week, time_of_day, last_sent_on, enabled")
    .eq("enabled", true)
    .limit(2000);
  const rows = (reminders ?? []) as Array<{
    client_id: string;
    days_of_week: unknown;
    time_of_day: string;
    last_sent_on: string | null;
  }>;
  const ids = rows.map((row) => row.client_id);
  const { data: clients } = ids.length
    ? await admin.from("clients").select("id, full_name, archived_at").in("id", ids).limit(2000)
    : { data: [] };
  const names = new Map<string, string>();
  const archived = new Set<string>();
  for (const client of (clients ?? []) as Array<{
    id: string;
    full_name: string | null;
    archived_at?: string | null;
  }>) {
    names.set(client.id, client.full_name ?? "");
    if (client.archived_at) archived.add(client.id);
  }
  const [{ data: outbound }, { data: inbound }] = await Promise.all([
    admin
      .from("whatsapp_outbound")
      .select("client_id, body, sent_ok, created_at")
      .gte("created_at", since)
      .limit(5000),
    admin
      .from("whatsapp_inbound")
      .select("client_id, received_at")
      .gte("received_at", since)
      .limit(5000),
  ]);
  const remindersIn: DeliveryReminder[] = rows
    .filter((row) => !archived.has(row.client_id))
    .map((row) => ({
      clientId: row.client_id,
      name: names.get(row.client_id) || "A patient",
      days: row.days_of_week,
      time: row.time_of_day,
      lastSentOn: row.last_sent_on,
    }));
  return summariseDelivery({
    date: moment.date,
    weekday,
    minuteOfDay: moment.minuteOfDay,
    reminders: remindersIn,
    outbound: (
      (outbound ?? []) as Array<{
        client_id: string | null;
        body: string | null;
        sent_ok: boolean | null;
        created_at: string;
      }>
    )
      .filter((row) => row.client_id)
      .map(
        (row): DeliveryMessage => ({
          clientId: row.client_id as string,
          body: row.body ?? "",
          sentOk: row.sent_ok !== false,
          at: row.created_at,
        }),
      ),
    inbound: ((inbound ?? []) as Array<{ client_id: string | null; received_at: string }>)
      .filter((row) => row.client_id)
      .map((row) => ({
        clientId: row.client_id as string,
        body: "",
        sentOk: true,
        at: row.received_at,
      })),
  });
}

export async function alertUndeliveredCheckins(
  adminIn: Admin,
  input: { undelivered: number; delivered: number; now: Date },
): Promise<void> {
  const admin = adminIn as unknown as Db;
  const moment = toSast(input.now);
  const { count } = await admin
    .from("job_runs")
    .select("id", { count: "exact", head: true })
    .eq("job", "checkin-delivery-alert")
    .gte("ran_at", sastStart(moment.date));
  const already = (count ?? 0) > 0;
  if (
    !shouldAlertDelivery({
      undelivered: input.undelivered,
      delivered: input.delivered,
      alreadyAlerted: already,
    })
  )
    return;

  const { recordJobRun } = await import("@/lib/job-runs.server");
  await recordJobRun("checkin-delivery-alert", {
    ok: false,
    status: 200,
    durationMs: 0,
    detail: `${input.undelivered} due, 0 delivered`,
  });

  try {
    const { sendTransactionalEmailServer } = await import("@/lib/email/send-server");
    await sendTransactionalEmailServer({
      templateName: "checkin-delivery",
      recipientEmail: process.env.JOB_HEALTH_EMAIL || "hello@peakmovement.co.za",
      idempotencyKey: `checkin-delivery-${moment.date}`,
      templateData: { date: moment.date, undelivered: input.undelivered },
    });
  } catch (e) {
    log.warn("check-in delivery email failed", {
      error: e instanceof Error ? e.message : "unknown",
    });
  }

  const { data: admins } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "super_admin")
    .limit(5);
  const { whatsappConfigFromEnv } = await import("./worker.server");
  const cfg = whatsappConfigFromEnv();
  if (!cfg) return;
  const { practitionerContact, sendLogged, windowOpen } =
    await import("./practitioner-status.server");
  for (const row of (admins ?? []) as Array<{ id: string }>) {
    const contact = await practitionerContact(adminIn, row.id);
    if (!contact.phone) continue;
    const open = await windowOpen(adminIn, contact.phone, input.now);
    if (open) {
      const summary = await loadDeliverySummary(adminIn, input.now);
      await sendLogged(
        adminIn,
        cfg,
        { kind: "text", to: contact.phone, body: formatDeliveryReply(summary) },
        formatDeliveryReply(summary),
      );
      continue;
    }
    const template = process.env.WHATSAPP_CHECKIN_ALERT_TEMPLATE?.trim();
    if (!template) {
      log.warn("check-in delivery alert skipped: window closed and no template", {
        to: maskPhone(contact.phone),
      });
      continue;
    }
    await sendLogged(
      adminIn,
      cfg,
      {
        kind: "template",
        to: contact.phone,
        templateName: template,
        languageCode: process.env.WHATSAPP_CHECKIN_ALERT_TEMPLATE_LANG?.trim() || "en",
        variables: [contact.firstName, String(input.undelivered), moment.date],
        buttonPayloads: [CHECKIN_ALERT_BUTTON],
      },
      `[check-in delivery template ${template}]`,
    );
  }
}

export { formatDeliveryReply, CHECKIN_ALERT_TEMPLATE };
