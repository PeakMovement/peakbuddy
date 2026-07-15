import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { log } from "@/lib/log";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

// Default sender. Works out of the box via Resend's sandbox address — note
// that Resend's sandbox only delivers to the verified Resend account owner.
// For production, verify peakmovement.co.za (or a notify. subdomain) in
// Resend and change this to e.g. "Buddy <notify@peakmovement.co.za>".
const FROM_ADDRESS = process.env.BUDDY_EMAIL_FROM || "Buddy <noreply@buddy-health.co.za>";
const APP_BASE_URL = process.env.BUDDY_APP_BASE_URL || "https://peakbuddy.lovable.app";

const inputSchema = z.object({
  clientId: z.string().uuid(),
  symptomDescription: z.string().trim().min(1).max(4000),
  symptomScore: z.number().min(0).max(10),
  urgency: z.enum(["emergency", "urgent", "soon", "monitor", "routine"]),
});

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const URGENCY_COLOR: Record<string, string> = {
  emergency: "#b00020",
  urgent: "#c2680a",
  soon: "#8a7a0a",
  monitor: "#1e4a7a",
  routine: "#1e7a3a",
};

function renderEmail(opts: {
  clientName: string;
  practitionerName: string;
  symptomDescription: string;
  symptomScore: number;
  urgency: string;
  clientLink: string;
}) {
  const color = URGENCY_COLOR[opts.urgency] || "#333";
  const subject = `[Buddy] ${opts.clientName} requested contact (${opts.urgency.toUpperCase()})`;
  const html = `
<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f6f6f8;margin:0;padding:24px;color:#111">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #e6e6ea">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#666">Buddy · Client Contact Request</div>
    <h1 style="font-size:20px;margin:8px 0 16px">${escapeHtml(opts.clientName)} requested contact</h1>
    <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:${color};color:#fff;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">${escapeHtml(opts.urgency)}</div>
    <p style="margin:16px 0 4px;color:#555;font-size:13px;text-transform:uppercase;letter-spacing:.06em">Symptom description</p>
    <p style="margin:0 0 16px;white-space:pre-wrap;font-size:15px;line-height:1.5">${escapeHtml(opts.symptomDescription)}</p>
    <p style="margin:0 0 24px;color:#555;font-size:13px">Severity score: <strong>${opts.symptomScore}/10</strong></p>
    <a href="${opts.clientLink}" style="display:inline-block;background:#0a66ff;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600">Open client in Buddy</a>
    <p style="margin:24px 0 0;color:#888;font-size:12px;line-height:1.5">Hi ${escapeHtml(opts.practitionerName)} — this is an automated notification from Buddy. This is <strong>not</strong> an emergency channel. If your client is in immediate danger they should call emergency services.</p>
  </div>
</body></html>`;
  const text = `${opts.clientName} requested contact (${opts.urgency.toUpperCase()})

Symptom: ${opts.symptomDescription}
Severity: ${opts.symptomScore}/10

Open in Buddy: ${opts.clientLink}

This is not an emergency channel.`;
  return { subject, html, text };
}

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

    // Preferred: the central Buddy automation (your own email + WhatsApp channel).
    // When it's enabled, Lovable's internal email is bypassed entirely.
    const [{ data: ps }, { data: prac }] = await Promise.all([
      admin
        .from("platform_settings")
        .select("central_webhook_url, central_webhook_enabled")
        .limit(1)
        .maybeSingle(),
      admin
        .from("practices")
        .select("whatsapp_number")
        .eq("practitioner_id", client.practitioner_id)
        .maybeSingle(),
    ]);
    const centralUrl = ((ps as { central_webhook_url?: string } | null)?.central_webhook_url ?? "").trim();
    const centralEnabled = (ps as { central_webhook_enabled?: boolean } | null)?.central_webhook_enabled === true;
    if (centralEnabled && centralUrl) {
      try {
        const res = await fetch(centralUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "buddy_contact",
            channel: "central",
            practitioner_id: client.practitioner_id,
            practitioner_name: practitionerName,
            practitioner_email: practitionerEmail,
            practitioner_whatsapp: (prac as { whatsapp_number?: string } | null)?.whatsapp_number ?? null,
            client_id: client.id,
            client_name: client.full_name,
            symptom_description: data.symptomDescription,
            symptom_score: data.symptomScore,
            urgency: data.urgency,
            client_link: clientLink,
            timestamp: new Date().toISOString(),
          }),
        });
        if (!res.ok) {
          log.error("[notifyPractitioner] central webhook error", res.status, await res.text());
          return { ok: false as const, error: `Notification failed (${res.status})` };
        }
        return { ok: true as const, via: "central" as const };
      } catch (e) {
        log.error("[notifyPractitioner] central webhook fetch failed", e);
        return { ok: false as const, error: "Notification send failed" };
      }
    }

    // Fallback: legacy Resend gateway (only if the central channel is off).
    const lovableKey = process.env.LOVABLE_API_KEY;
    const resendKey = process.env.RESEND_API_KEY;
    if (!lovableKey || !resendKey) {
      return { ok: false as const, error: "No notification channel configured" };
    }
    const { subject, html, text } = renderEmail({
      clientName: client.full_name,
      practitionerName,
      symptomDescription: data.symptomDescription,
      symptomScore: data.symptomScore,
      urgency: data.urgency,
      clientLink,
    });
    try {
      const res = await fetch(`${GATEWAY_URL}/emails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": resendKey,
        },
        body: JSON.stringify({
          from: FROM_ADDRESS,
          to: [practitionerEmail],
          subject,
          html,
          text,
          tags: [
            { name: "event", value: "client_contact_request" },
            { name: "urgency", value: data.urgency },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        log.error("[notifyPractitioner] resend gateway error", res.status, body);
        return { ok: false as const, error: `Email send failed (${res.status})` };
      }
      return { ok: true as const };
    } catch (e) {
      log.error("[notifyPractitioner] fetch failed", e);
      return { ok: false as const, error: "Email send failed" };
    }
  });
