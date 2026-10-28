/**
 * Red flag escalation (28 Oct 2026, Justin: 2 hours).
 *
 * A red flag alert nobody has opened (not read, not reviewed, no outcome)
 * two hours after it was raised goes to the practice owner, and to the Buddy
 * admin when the owner is the treating physio. Escalations only go out on
 * clinic days between 08:00 and 18:00 SAST; anything that comes due outside
 * that waits for 08:00 on the next clinic day.
 *
 * This changes who is told and when, never what counts as a red flag.
 * alerts.escalation_fired is the claim, shared with the manual sweep in
 * detection.functions.ts, so an alert is escalated at most once.
 */
import { log } from "@/lib/log";
import { OPEN_WEEKDAYS, PUBLIC_HOLIDAYS, toSast } from "./clinic-hours";
import type { SendEnv } from "./practitioner-status.server";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type Db = { from: (t: string) => any };

export const ESCALATE_AFTER_MS = 2 * 3600_000;
const LOOKBACK_MS = 4 * 24 * 3600_000;
const WINDOW_START = 8 * 60;
const WINDOW_END = 18 * 60;

/** May an escalation go out right now? Clinic days, 08:00 to 18:00 SAST. */
export function escalationWindowOpen(now: Date): boolean {
  const m = toSast(now);
  if (PUBLIC_HOLIDAYS.has(m.date) || !OPEN_WEEKDAYS.has(m.weekday)) return false;
  return m.minuteOfDay >= WINDOW_START && m.minuteOfDay < WINDOW_END;
}

export function escalationDue(createdAt: string, now: Date): boolean {
  return (
    now.getTime() - new Date(createdAt).getTime() >= ESCALATE_AFTER_MS && escalationWindowOpen(now)
  );
}

export function escalationText(input: {
  patient: string;
  physio: string;
  raisedAt: string;
  reason: string;
}): string {
  const when = new Date(input.raisedAt).toLocaleString("en-ZA", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  });
  return `A red flag for ${input.patient} (raised ${when}) still hasn't been opened. ${input.physio} has it.\n\n${input.reason}\n\nOpen their profile in Buddy to review.`;
}

export async function runRedFlagEscalation(
  adminIn: Admin,
  env: SendEnv,
  now: Date,
): Promise<number> {
  if (!escalationWindowOpen(now)) return 0;
  const admin = adminIn as unknown as Db;
  const { data } = await admin
    .from("alerts")
    .select(
      "id, client_id, practitioner_id, message, urgency, created_at, is_read, reviewed_at, outcome",
    )
    .eq("alert_type", "red_flag")
    .eq("escalation_fired", false)
    .gte("created_at", new Date(now.getTime() - LOOKBACK_MS).toISOString())
    .lte("created_at", new Date(now.getTime() - ESCALATE_AFTER_MS).toISOString())
    .limit(50);
  const open = ((data ?? []) as Array<Record<string, any>>).filter(
    (a) => !a.is_read && !a.reviewed_at && !a.outcome,
  );
  let sent = 0;
  const { practitionerContact, sendLogged, windowOpen } =
    await import("./practitioner-status.server");
  for (const a of open) {
    const { data: claimed } = await admin
      .from("alerts")
      .update({ escalation_fired: true })
      .eq("id", a.id)
      .eq("escalation_fired", false)
      .select("id");
    if (!(claimed ?? []).length) continue;

    const { data: client } = await admin
      .from("clients")
      .select("id, full_name, practice_id")
      .eq("id", a.client_id)
      .maybeSingle();
    const c = client as { id: string; full_name: string | null; practice_id: string | null } | null;
    let owner: string | null = null;
    if (c?.practice_id) {
      const { data: p } = await admin
        .from("practices")
        .select("practitioner_id")
        .eq("id", c.practice_id)
        .maybeSingle();
      owner = (p as { practitioner_id?: string } | null)?.practitioner_id ?? null;
    }
    const recipients = new Set<string>();
    if (owner && owner !== a.practitioner_id) recipients.add(owner);
    else {
      const { data: admins } = await admin
        .from("profiles")
        .select("id")
        .eq("role", "super_admin")
        .limit(5);
      for (const r of (admins ?? []) as Array<{ id: string }>) {
        if (r.id !== a.practitioner_id) recipients.add(r.id);
      }
      if (!recipients.size && owner) recipients.add(owner);
    }
    const physio =
      (await practitionerContact(adminIn, a.practitioner_id)).firstName || "The physio";
    const patient = String(c?.full_name ?? "").trim() || "a patient";
    const reason = String(a.message ?? "")
      .replace(/^WhatsApp check-in:\s*/, "")
      .slice(0, 300);
    const body = escalationText({ patient, physio, raisedAt: a.created_at, reason });

    for (const userId of recipients) {
      try {
        const { sendPushCore } = await import("@/lib/push.functions");
        await sendPushCore(adminIn, {
          userId,
          title: "Unopened red flag",
          body: `${patient}'s red flag from 2+ hours ago hasn't been opened.`,
          data: { type: "escalation", alertId: a.id, clientId: a.client_id },
        });
      } catch {
        /* WhatsApp below still goes */
      }
      const contact = await practitionerContact(adminIn, userId);
      if (!contact.phone) continue;
      if (await windowOpen(adminIn, contact.phone, now)) {
        await sendLogged(
          adminIn,
          env,
          { kind: "text", to: contact.phone, body },
          "[red flag escalation]",
        );
      } else {
        const { sendPractitionerWhatsAppAlert } = await import("./practitioner-alert.server");
        await sendPractitionerWhatsAppAlert(
          adminIn,
          [userId],
          a.urgency,
          undefined,
          patient,
          `Not opened after 2 hours. ${reason}`,
        ).catch(() => 0);
      }
    }
    sent++;
    log.info("red flag escalated", { recipients: recipients.size });
  }
  return sent;
}
