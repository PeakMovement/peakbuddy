import { supabase } from "@/lib/supabase";

export async function getPracticeWebhookSettings(practitionerId: string) {
  const { data } = await supabase
    .from("practices")
    .select("webhook_url, webhook_enabled, contact_webhook_url, contact_webhook_enabled")
    .eq("practitioner_id", practitionerId)
    .maybeSingle();
  return data as {
    webhook_url: string | null;
    webhook_enabled: boolean | null;
    contact_webhook_url: string | null;
    contact_webhook_enabled: boolean | null;
  } | null;
}

type WebhookFireResult = { fired: boolean; reason?: string };

export async function fireAlertWebhook(payload: {
  practitionerId: string;
  clientName: string;
  clientId: string;
  alertMessage: string;
  urgency: string;
  redFlagDetected: boolean;
}): Promise<WebhookFireResult> {
  // Delegates to a server function — webhook settings and delivery never
  // touch the patient's browser.
  const { fireAlertWebhookServer } = await import("@/lib/webhooks.functions");
  const r = await fireAlertWebhookServer({ data: payload });
  return { fired: !!r.fired, reason: r.reason };
}

export async function fireContactWebhook(payload: {
  practitionerId: string;
  clientName: string;
  clientId: string;
  symptomDescription: string;
  symptomScore: number;
}): Promise<WebhookFireResult> {
  const { fireContactWebhookServer } = await import("@/lib/webhooks.functions");
  const r = await fireContactWebhookServer({ data: payload });
  return { fired: !!r.fired, reason: r.reason };
}

/**
 * Returns the existing open alert if one exists for this client/type within
 * the last 24h (and is unread). Use BEFORE inserting a new alert to suppress
 * duplicates.
 */
export async function findRecentOpenAlert(clientId: string, alertType: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("alerts")
    .select("id")
    .eq("client_id", clientId)
    .eq("alert_type", alertType)
    .eq("is_read", false)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}
