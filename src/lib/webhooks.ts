import { supabase } from "@/lib/supabase";

export async function getPracticeWebhookSettings(practitionerId: string) {
  const { data } = await supabase
    .from("practices")
    .select(
      "webhook_url, webhook_enabled, contact_webhook_url, contact_webhook_enabled",
    )
    .eq("practitioner_id", practitionerId)
    .maybeSingle();
  return data as
    | {
        webhook_url: string | null;
        webhook_enabled: boolean | null;
        contact_webhook_url: string | null;
        contact_webhook_enabled: boolean | null;
      }
    | null;
}

export async function fireAlertWebhook(payload: {
  practitionerId: string;
  clientName: string;
  clientId: string;
  alertMessage: string;
  urgency: string;
  redFlagDetected: boolean;
}) {
  const settings = await getPracticeWebhookSettings(payload.practitionerId);

  if (!settings?.webhook_url || !settings?.webhook_enabled) {
    console.log(
      "[Buddy Webhook] Alert webhook not configured or disabled for practitioner:",
      payload.practitionerId,
    );
    return { fired: false, reason: "not_configured" as const };
  }

  const body = {
    event: "buddy_alert",
    practitioner_id: payload.practitionerId,
    client_id: payload.clientId,
    client_name: payload.clientName,
    message: payload.alertMessage,
    urgency: payload.urgency,
    red_flag_detected: payload.redFlagDetected,
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(settings.webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    console.log("[Buddy Webhook] Alert fired. Status:", res.status);
    return { fired: true, status: res.status };
  } catch (err) {
    console.error("[Buddy Webhook] Alert webhook failed:", err);
    return { fired: false, reason: "fetch_error" as const };
  }
}

export async function fireContactWebhook(payload: {
  practitionerId: string;
  clientName: string;
  clientId: string;
  symptomDescription: string;
  symptomScore: number;
}) {
  const settings = await getPracticeWebhookSettings(payload.practitionerId);

  if (!settings?.contact_webhook_url || !settings?.contact_webhook_enabled) {
    console.log(
      "[Buddy Webhook] Contact webhook not configured or disabled for practitioner:",
      payload.practitionerId,
    );
    return { fired: false, reason: "not_configured" as const };
  }

  const body = {
    event: "buddy_contact",
    practitioner_id: payload.practitionerId,
    client_id: payload.clientId,
    client_name: payload.clientName,
    symptom_description: payload.symptomDescription,
    symptom_score: payload.symptomScore,
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(settings.contact_webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    console.log("[Buddy Webhook] Contact fired. Status:", res.status);
    return { fired: true, status: res.status };
  } catch (err) {
    console.error("[Buddy Webhook] Contact webhook failed:", err);
    return { fired: false, reason: "fetch_error" as const };
  }
}

/**
 * Returns the existing open alert if one exists for this client/type within
 * the last 24h (and is unread). Use BEFORE inserting a new alert to suppress
 * duplicates.
 */
export async function findRecentOpenAlert(
  clientId: string,
  alertType: string,
) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("alerts")
    .select("id")
    .eq("client_id", clientId)
    .eq("alert_type", alertType)
    .eq("is_read", false)
    .gte("created_at", since)
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}
