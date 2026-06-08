import { createServerFn } from "@tanstack/react-start";
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
    .select(
      "webhook_url, webhook_enabled, contact_webhook_url, contact_webhook_enabled",
    )
    .eq("practitioner_id", practitionerId)
    .maybeSingle();
  return data;
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

async function deliver(url: string, body: unknown) {
  if (!isDeliverableUrl(url)) {
    return { fired: false as const, reason: "invalid_url" as const };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { fired: true as const, status: res.status };
  } catch {
    return { fired: false as const, reason: "fetch_error" as const };
  }
}

export const fireAlertWebhookServer = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => alertSchema.parse(input))
  .handler(async ({ data }) => {
    const settings = await loadWebhookSettings(data.practitionerId);
    if (!settings?.webhook_url || !settings?.webhook_enabled) {
      return { fired: false as const, reason: "not_configured" as const };
    }
    return deliver(settings.webhook_url, {
      event: "buddy_alert",
      practitioner_id: data.practitionerId,
      client_id: data.clientId,
      client_name: data.clientName,
      message: data.alertMessage,
      urgency: data.urgency,
      red_flag_detected: data.redFlagDetected,
      timestamp: new Date().toISOString(),
    });
  });

export const fireContactWebhookServer = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => contactSchema.parse(input))
  .handler(async ({ data }) => {
    const settings = await loadWebhookSettings(data.practitionerId);
    if (!settings?.contact_webhook_url || !settings?.contact_webhook_enabled) {
      return { fired: false as const, reason: "not_configured" as const };
    }
    return deliver(settings.contact_webhook_url, {
      event: "buddy_contact",
      practitioner_id: data.practitionerId,
      client_id: data.clientId,
      client_name: data.clientName,
      symptom_description: data.symptomDescription,
      symptom_score: data.symptomScore,
      timestamp: new Date().toISOString(),
    });
  });
