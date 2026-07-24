import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Server-side webhook delivery. Webhooks previously fired from the patient's
// browser, which (a) let a patient's device read the practitioner's webhook
// URL, (b) made delivery depend on the patient's connectivity, and (c) allowed
// spoofed payloads. The admin client runs only on the server.

const alertSchema = z.object({
  practitionerId: z.string().uuid(),
  clientName: z.string().min(1).max(200),
  clientId: z.string().uuid(),
  alertMessage: z.string().min(1).max(2000),
  urgency: z.string().max(40),
  redFlagDetected: z.boolean(),
});

const contactSchema = z.object({
  practitionerId: z.string().uuid(),
  clientName: z.string().min(1).max(200),
  clientId: z.string().uuid(),
  symptomDescription: z.string().min(1).max(4000),
  symptomScore: z.number().min(0).max(10),
});

async function loadWebhookSettings(practitionerId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("practices")
    .select("webhook_url, webhook_enabled, contact_webhook_url, contact_webhook_enabled")
    .eq("practitioner_id", practitionerId)
    .maybeSingle();
  return data;
}

// Central Buddy channel: one automation endpoint for everyone. Loads whether the
// central webhook is enabled + the practitioner's contact details so the single
// automation can route WhatsApp/email to the right person.
async function loadCentralTarget(practitionerId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: settings }, { data: prac }, prof, userRes] = await Promise.all([
    supabaseAdmin
      .from("platform_settings")
      .select("central_webhook_url, central_webhook_enabled")
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("practices")
      .select("whatsapp_number")
      .eq("practitioner_id", practitionerId)
      .maybeSingle(),
    supabaseAdmin.from("profiles").select("full_name").eq("id", practitionerId).maybeSingle(),
    supabaseAdmin.auth.admin.getUserById(practitionerId),
  ]);
  return {
    url: (settings as { central_webhook_url?: string } | null)?.central_webhook_url?.trim() || "",
    enabled: (settings as { central_webhook_enabled?: boolean } | null)?.central_webhook_enabled === true,
    whatsapp: (prac as { whatsapp_number?: string } | null)?.whatsapp_number ?? null,
    name: (prof.data as { full_name?: string } | null)?.full_name ?? null,
    email: userRes?.data?.user?.email ?? null,
  };
}

function isDeliverableUrl(url: string): boolean {
  // Practitioner-supplied destination: require https and refuse obvious
  // internal targets to limit SSRF surface.
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

type DeliveryResult =
  | { fired: true; status: number }
  | { fired: false; reason: "invalid_url" | "fetch_error" };

async function deliver(url: string, body: unknown): Promise<DeliveryResult> {
  if (!isDeliverableUrl(url)) {
    return { fired: false, reason: "invalid_url" };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { fired: true, status: res.status };
  } catch {
    return { fired: false, reason: "fetch_error" };
  }
}

type WebhookResults = {
  central?: DeliveryResult;
  practice?: DeliveryResult;
};

type AlertWebhookInput = z.infer<typeof alertSchema>;

/**
 * Service-role core for firing the practitioner alert webhook(s). No auth
 * context needed (all reads use supabaseAdmin, keyed by practitionerId). Shared
 * by the auth-gated `fireAlertWebhookServer` wrapper and trusted server-side
 * callers (the triage red-flag safety net in triage-query.ts).
 */
export async function fireAlertWebhookCore(data: AlertWebhookInput) {
  const ts = new Date().toISOString();
    const [settings, central] = await Promise.all([
      loadWebhookSettings(data.practitionerId),
      loadCentralTarget(data.practitionerId),
    ]);
    const results: WebhookResults = {};

    // Central Buddy channel (one automation for everyone) — includes the target
    // practitioner's email + WhatsApp number so it can route to the right person.
    if (central.enabled && central.url) {
      results.central = await deliver(central.url, {
        event: "buddy_alert",
        channel: "central",
        practitioner_id: data.practitionerId,
        practitioner_name: central.name,
        practitioner_email: central.email,
        practitioner_whatsapp: central.whatsapp,
        client_id: data.clientId,
        client_name: data.clientName,
        message: data.alertMessage,
        urgency: data.urgency,
        red_flag_detected: data.redFlagDetected,
        timestamp: ts,
      });
    }
    // Optional legacy per-practice webhook (backward compatible).
    if (settings?.webhook_url && settings?.webhook_enabled) {
      results.practice = await deliver(settings.webhook_url, {
        event: "buddy_alert",
        practitioner_id: data.practitionerId,
        client_id: data.clientId,
        client_name: data.clientName,
        message: data.alertMessage,
        urgency: data.urgency,
        red_flag_detected: data.redFlagDetected,
        timestamp: ts,
      });
    }
  const fired = Boolean(results.central || results.practice);
  return { fired, reason: fired ? undefined : ("not_configured" as const), results };
}

export const fireAlertWebhookServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => alertSchema.parse(input))
  .handler(async ({ data }) => fireAlertWebhookCore(data));

export const fireContactWebhookServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => contactSchema.parse(input))
  .handler(async ({ data }) => {
    const ts = new Date().toISOString();
    const [settings, central] = await Promise.all([
      loadWebhookSettings(data.practitionerId),
      loadCentralTarget(data.practitionerId),
    ]);
    const results: WebhookResults = {};
    if (central.enabled && central.url) {
      results.central = await deliver(central.url, {
        event: "buddy_contact",
        channel: "central",
        practitioner_id: data.practitionerId,
        practitioner_name: central.name,
        practitioner_email: central.email,
        practitioner_whatsapp: central.whatsapp,
        client_id: data.clientId,
        client_name: data.clientName,
        symptom_description: data.symptomDescription,
        symptom_score: data.symptomScore,
        timestamp: ts,
      });
    }
    if (settings?.contact_webhook_url && settings?.contact_webhook_enabled) {
      results.practice = await deliver(settings.contact_webhook_url, {
        event: "buddy_contact",
        practitioner_id: data.practitionerId,
        client_id: data.clientId,
        client_name: data.clientName,
        symptom_description: data.symptomDescription,
        symptom_score: data.symptomScore,
        timestamp: ts,
      });
    }
    const fired = Boolean(results.central || results.practice);
    return { fired, reason: fired ? undefined : ("not_configured" as const), results };
  });
