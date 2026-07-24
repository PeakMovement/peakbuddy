import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { log } from "@/lib/log";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SUPABASE_URL = process.env.SUPABASE_URL!;

const APP_BASE_URL = process.env.BUDDY_APP_BASE_URL || "https://peakbuddy.lovable.app";

const inputSchema = z.object({
  clientId: z.string().uuid(),
  symptomDescription: z.string().trim().min(1).max(4000),
  symptomScore: z.number().min(0).max(10),
  urgency: z.enum(["emergency", "urgent", "soon", "monitor", "routine"]),
});

export const notifyAssignedPractitioner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const serviceKey = process.env.SEED_SERVICE_ROLE_KEY;
    if (!serviceKey) return { ok: false as const, error: "Server missing SEED_SERVICE_ROLE_KEY" };

    const admin = createClient(SUPABASE_URL, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Load client
    const { data: client, error: clErr } = await admin
      .from("clients")
      .select("id, full_name, practitioner_id, auth_user_id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (clErr || !client) return { ok: false as const, error: "Client not found" };
    if (!client.practitioner_id) {
      return { ok: false as const, error: "No practitioner assigned" };
    }

    // Authz: only the client themselves, their practitioner, or a super admin.
    if (
      client.auth_user_id !== context.userId &&
      client.practitioner_id !== context.userId
    ) {
      const { data: prof } = await admin
        .from("profiles")
        .select("role")
        .eq("id", context.userId)
        .maybeSingle();
      if ((prof as { role?: string } | null)?.role !== "super_admin") {
        return { ok: false as const, error: "Not authorized" };
      }
    }

    // Practitioner profile (name) + auth user (email)
    const [{ data: prof }, { data: userRes }] = await Promise.all([
      admin.from("profiles").select("full_name").eq("id", client.practitioner_id).maybeSingle(),
      admin.auth.admin.getUserById(client.practitioner_id),
    ]);
    const practitionerEmail = userRes?.user?.email;
    const practitionerName = prof?.full_name || "Practitioner";
    if (!practitionerEmail) {
      return { ok: false as const, error: "Practitioner email not found" };
    }

    // Insert alert row so it shows in-app too (best-effort).
    try {
      await admin.from("alerts").insert({
        practitioner_id: client.practitioner_id,
        client_id: client.id,
        alert_type: "client_contact_request",
        message: `${client.full_name} requested contact: ${data.symptomDescription}`.slice(0, 1000),
        urgency: data.urgency,
        is_read: false,
        webhook_fired: false,
      });
    } catch (e) {
      log.error("[notifyPractitioner] alert insert failed", e);
    }

    const clientLink = `${APP_BASE_URL}/practitioner/app/client-detail/${client.id}`;

    // Notify the practitioner via Buddy's internal email system (the healthy
    // notify.buddy-health.co.za path that also powers the welcome email).
    const { sendTransactionalEmailServer } = await import("@/lib/email/send-server");
    const send = await sendTransactionalEmailServer({
      templateName: "practitioner-contact",
      recipientEmail: practitionerEmail,
      idempotencyKey: `contact-${client.id}-${Date.now()}`,
      templateData: {
        clientName: client.full_name,
        practitionerName,
        symptomDescription: data.symptomDescription,
        symptomScore: data.symptomScore,
        urgency: data.urgency,
        clientLink,
      },
    });
    if (!send.ok) {
      log.error("[notifyPractitioner] internal email failed", send.error);
      return { ok: false as const, error: send.error };
    }
    return { ok: true as const };
  });

type EmailAdminClient =
  (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

/**
 * Service-role core for the practitioner-alert email. Loads the alert, gates on
 * `email_fired` (idempotent), builds + sends the email, marks it fired. Does NOT
 * check caller ownership — callers that reach this are already trusted (the
 * auth-gated `notifyAlertEmail` wrapper, or the server-side red-flag safety net
 * in triage-query which has just authenticated the user and detected the flag).
 */
export async function sendAlertEmailCore(
  supabaseAdmin: EmailAdminClient,
  alertId: string,
): Promise<
  | { ok: true; skipped?: "already_sent" }
  | { ok: false; reason: "not_found" | "client_not_found" | "no_practitioner_email" | "send_failed" }
> {
  const { mintAlertActionToken } = await import("@/lib/alert-actions.server");

  const { data: alert } = await supabaseAdmin
    .from("alerts")
    .select("id, practitioner_id, client_id, message, urgency, email_fired, created_at")
    .eq("id", alertId)
    .maybeSingle();
  if (!alert) return { ok: false as const, reason: "not_found" as const };
  if (alert.email_fired) return { ok: true as const, skipped: "already_sent" as const };

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, full_name, phone")
    .eq("id", alert.client_id)
    .maybeSingle();
  if (!client) return { ok: false as const, reason: "client_not_found" as const };

  const [{ data: prof }, { data: userRes }] = await Promise.all([
    supabaseAdmin.from("profiles").select("full_name").eq("id", alert.practitioner_id).maybeSingle(),
    supabaseAdmin.auth.admin.getUserById(alert.practitioner_id),
  ]);
  const practitionerEmail = userRes?.user?.email;
  if (!practitionerEmail) {
    return { ok: false as const, reason: "no_practitioner_email" as const };
  }
  const practitionerName = (prof as { full_name?: string } | null)?.full_name || "Practitioner";

  const [checkinToken, reviewedToken] = await Promise.all([
    mintAlertActionToken({ alertId: alert.id, practitionerId: alert.practitioner_id, action: "checkin" }),
    mintAlertActionToken({ alertId: alert.id, practitionerId: alert.practitioner_id, action: "reviewed" }),
  ]);

  const firstName = (client.full_name || "Your client").trim().split(/\s+/)[0];
  const viewUrl = `${APP_BASE_URL}/practitioner/app/client-detail/${client.id}`;
  const checkinUrl = `${APP_BASE_URL}/api/public/alerts/action?token=${encodeURIComponent(checkinToken)}`;
  const reviewedUrl = `${APP_BASE_URL}/api/public/alerts/action?token=${encodeURIComponent(reviewedToken)}`;

  const phoneDigits = (client.phone || "").replace(/\D/g, "");
  const whatsappUrl = phoneDigits
    ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(
        `Hi ${firstName}, this is ${practitionerName} following up on your recent Buddy check-in.`,
      )}`
    : null;

  const timestamp = new Date(alert.created_at || Date.now()).toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const { sendTransactionalEmailServer } = await import("@/lib/email/send-server");
  const send = await sendTransactionalEmailServer({
    templateName: "practitioner-alert",
    recipientEmail: practitionerEmail,
    idempotencyKey: `alert-${alert.id}`,
    templateData: {
      clientName: client.full_name,
      clientFirstName: firstName,
      practitionerName,
      alertMessage: alert.message,
      urgency: alert.urgency,
      timestamp,
      viewUrl,
      checkinUrl,
      reviewedUrl,
      whatsappUrl,
    },
  });

  if (!send.ok) {
    log.error("[notifyAlertEmail] send failed", send.error);
    return { ok: false as const, reason: "send_failed" as const };
  }

  await supabaseAdmin.from("alerts").update({ email_fired: true }).eq("id", alert.id);
  return { ok: true as const };
}

/**
 * Fires the "practitioner alert" email when a patient logs a symptom that
 * trips the risk profile. Idempotent on `alerts.email_fired`. Called
 * server-side from the same client paths that already call `notifyAlertPush`
 * (checkin, yves red-flag). No auth middleware: the alert row is the
 * capability — we validate the caller against the alert's client.
 */
export const notifyAlertEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ alertId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Ownership check: the caller must own the alert's client, or be super_admin.
    const { data: alert } = await supabaseAdmin
      .from("alerts")
      .select("client_id")
      .eq("id", data.alertId)
      .maybeSingle();
    if (!alert) return { ok: false as const, reason: "not_found" as const };
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("auth_user_id")
      .eq("id", alert.client_id)
      .maybeSingle();
    if (!client) return { ok: false as const, reason: "client_not_found" as const };
    if (client.auth_user_id !== context.userId) {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", context.userId)
        .maybeSingle();
      if ((prof as { role?: string } | null)?.role !== "super_admin") {
        return { ok: false as const, reason: "forbidden" as const };
      }
    }

    return sendAlertEmailCore(supabaseAdmin, data.alertId);
  });

