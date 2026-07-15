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
