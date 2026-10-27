/**
 * Discharge and the patient pause note. Rows are not deleted.
 * The patient sentence is fixed and only goes out inside the 24 hour window.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import { DISCHARGE_PATIENT } from "./discharge";
import { sendLogged, windowOpen } from "./practitioner-status.server";
import type { ProviderSecrets, WhatsAppProvider } from "./provider";

type Admin = SupabaseClient;

export async function setDischarged(
  admin: Admin,
  clientId: string,
  discharged: boolean,
  now: Date,
): Promise<boolean> {
  const { error } = await admin
    .from("clients")
    .update({ discharged_at: discharged ? now.toISOString() : null })
    .eq("id", clientId);
  if (error) {
    log.warn("discharge update failed", { code: error.code });
    return false;
  }
  if (discharged) {
    await admin
      .from("quiet_patient_nudges")
      .update({ pending_confirm: false })
      .eq("client_id", clientId)
      .then(
        () => undefined,
        () => undefined,
      );
  }
  return true;
}

export async function clientDischarged(admin: Admin, clientId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("clients")
    .select("discharged_at")
    .eq("id", clientId)
    .maybeSingle();
  if (error) return false;
  return Boolean((data as { discharged_at?: string | null } | null)?.discharged_at);
}

/** Inside the window, one fixed sentence. Outside it, send nothing. */
export async function tellDischargePaused(
  admin: Admin,
  env: { provider: WhatsAppProvider; secrets: ProviderSecrets } | null,
  clientId: string,
  now: Date,
): Promise<"sent" | "quiet" | "failed"> {
  if (!env) return "quiet";
  const { data: conv } = await admin
    .from("whatsapp_conversations")
    .select("phone")
    .eq("client_id", clientId)
    .limit(1);
  const phone = (conv as Array<{ phone?: string }> | null)?.[0]?.phone;
  if (!phone) return "quiet";
  const open = await windowOpen(admin, phone, now);
  if (!open) return "quiet";
  const ok = await sendLogged(
    admin,
    env,
    { kind: "text", to: phone, body: DISCHARGE_PATIENT },
    "[discharge paused]",
  );
  return ok ? "sent" : "failed";
}
