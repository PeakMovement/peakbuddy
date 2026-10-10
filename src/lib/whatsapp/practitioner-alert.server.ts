/**
 * Red flag alert to the practitioner's own WhatsApp.
 *
 * Practitioners rarely have an open 24 hour window with Buddy, so this uses
 * a Meta-approved template.
 *
 * WHATSAPP_ALERT_TEMPLATE_NAMED (10 Oct 2026, Justin's request): the
 * patient's name plus how soon to look, variables [name, urgency]. The
 * symptom itself still stays inside the app.
 * WHATSAPP_ALERT_TEMPLATE: the original template, urgency only, used when the
 * named one isn't set.
 *
 * The phone number comes from the practitioner's profile.
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
  /** True when the template takes the patient's name first. */
  named?: boolean;
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
  const namedTemplate = process.env.WHATSAPP_ALERT_TEMPLATE_NAMED?.trim();
  const templateName = namedTemplate || process.env.WHATSAPP_ALERT_TEMPLATE?.trim();
  if (!templateName) return null;
  const { whatsappConfigFromEnv } = await import("./worker.server");
  const cfg = whatsappConfigFromEnv();
  if (!cfg) return null;
  return {
    ...cfg,
    templateName,
    named: Boolean(namedTemplate),
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
  patientName?: string | null,
): Promise<number> {
  const name =
    String(patientName ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 60) || "A patient";
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
              variables: cfg.named ? [name, urgencyWords(urgency)] : [urgencyWords(urgency)],
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
        body: `[alert template ${cfg.templateName}: ${cfg.named ? "with name, " : ""}${urgencyWords(urgency)}]`,
        sent_ok: ok,
      })
      .then(
        () => undefined,
        () => undefined,
      );
  }
  return sent;
}
