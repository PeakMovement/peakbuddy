/**
 * Red flag alert to the practitioner's own WhatsApp.
 *
 * Practitioners rarely have an open 24 hour window with Buddy, so this uses
 * one Meta-approved Utility template. The template carries no patient
 * details: only how soon to look, and a link to Buddy. Who and what stay
 * inside the app.
 *
 * Off until WHATSAPP_ALERT_TEMPLATE is set (after Meta approves the
 * template). The phone number comes from the practitioner's profile.
 */
import { log } from "@/lib/log";
import { maskPhone, toE164Digits } from "./phone";
import type { ProviderSecrets, WhatsAppProvider } from "./provider";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

export interface AlertTemplateConfig {
  provider: WhatsAppProvider;
  secrets: ProviderSecrets;
  templateName: string;
  languageCode: string;
}

/** How soon to look, in plain words for the template's one variable. */
export function urgencyWords(urgency: string | null | undefined): string {
  switch (urgency) {
    case "emergency":
    case "urgent":
      return "urgent";
    case "soon":
      return "same day";
    default:
      return "routine";
  }
}

export async function alertTemplateConfigFromEnv(): Promise<AlertTemplateConfig | null> {
  const templateName = process.env.WHATSAPP_ALERT_TEMPLATE?.trim();
  if (!templateName) return null;
  const { whatsappConfigFromEnv } = await import("./worker.server");
  const cfg = whatsappConfigFromEnv();
  if (!cfg) return null;
  return {
    ...cfg,
    templateName,
    languageCode: process.env.WHATSAPP_ALERT_TEMPLATE_LANG?.trim() || "en",
  };
}

async function practitionerPhone(admin: Admin, userId: string): Promise<string | null> {
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    return toE164Digits(data?.user?.phone ?? null);
  } catch {
    return null;
  }
}

/**
 * Sends the alert template to each practitioner who has a phone on their
 * profile. Never throws: a failed WhatsApp must not cost the push or email.
 */
export async function sendPractitionerWhatsAppAlert(
  admin: Admin,
  userIds: string[],
  urgency: string | null | undefined,
  cfgIn?: AlertTemplateConfig | null,
): Promise<number> {
  const cfg = cfgIn === undefined ? await alertTemplateConfigFromEnv() : cfgIn;
  if (!cfg) return 0;
  let sent = 0;
  const seen = new Set<string>();
  for (const userId of [...new Set(userIds)]) {
    const to = await practitionerPhone(admin, userId);
    if (!to || seen.has(to)) continue;
    seen.add(to);
    let id: string | null = null;
    let ok = false;
    try {
      id =
        (
          await cfg.provider.send(
            {
              kind: "template",
              to,
              templateName: cfg.templateName,
              languageCode: cfg.languageCode,
              variables: [urgencyWords(urgency)],
            },
            cfg.secrets,
          )
        ).providerMessageId || null;
      ok = true;
      sent++;
    } catch (e) {
      log.warn("practitioner whatsapp alert failed", {
        to: maskPhone(to),
        error: e instanceof Error ? e.message : "unknown",
      });
    }
    await admin
      .from("whatsapp_outbound")
      .insert({
        phone: to,
        client_id: null,
        provider: cfg.provider.id,
        provider_message_id: id,
        kind: "template",
        body: `[alert template ${cfg.templateName}: ${urgencyWords(urgency)}]`,
        sent_ok: ok,
      })
      .then(
        () => undefined,
        () => undefined,
      );
  }
  return sent;
}
