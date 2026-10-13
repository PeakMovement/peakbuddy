/**
 * Home-programme reminder on the days the physio chose. Off unless
 * PROGRAMME_REMINDERS=1 and the client has opted in. Outside the 24 hour
 * window this needs WHATSAPP_PROGRAMME_REMINDER_TEMPLATE; if that is unset
 * the send is skipped and logged.
 */
import { log } from "@/lib/log";
import { programmeReminderBody, programmeReminderDecision } from "@/lib/capabilities";
import { LIBRARY_COMING_SOON } from "@/lib/feature-flags";
import { morningCheckinDate } from "./morning-checkin";
import { maskPhone } from "./phone";
import { LIBRARY_URL } from "./assistant";
import type { ProviderSecrets, WhatsAppProvider } from "./provider";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

interface Chain extends PromiseLike<{ data: unknown; error: { message?: string } | null }> {
  select: (columns?: string) => Chain;
  eq: (column: string, value: unknown) => Chain;
  limit: (count: number) => Chain;
  update: (values: Record<string, unknown>) => Chain;
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

export async function runProgrammeReminders(
  adminIn: Admin,
  env: { provider: WhatsAppProvider; secrets: ProviderSecrets },
  now = new Date(),
): Promise<void> {
  if (process.env.PROGRAMME_REMINDERS !== "1") return;
  const admin = adminIn as unknown as { from: (table: string) => Chain };
  const today = morningCheckinDate(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  try {
    const { data, error } = await admin
      .from("clients")
      .select(
        "id, full_name, programme_reminder_opt_in, programme_reminder_days, programme_reminder_last_sent_on",
      )
      .eq("programme_reminder_opt_in", true)
      .limit(1000);
    if (error) {
      log.warn("programme reminder skipped: clients unavailable");
      return;
    }
    const { windowOpen, sendLogged } = await import("./practitioner-status.server");
    const template = process.env.WHATSAPP_PROGRAMME_REMINDER_TEMPLATE?.trim() || "";
    for (const client of rows<{
      id: string;
      full_name: string | null;
      programme_reminder_days: number[] | null;
      programme_reminder_last_sent_on: string | null;
    }>(data)) {
      const { data: conv } = await admin
        .from("whatsapp_conversations")
        .select("phone")
        .eq("client_id", client.id)
        .limit(1);
      const phone = rows<{ phone?: string }>(conv)[0]?.phone;
      if (!phone) continue;
      const open = await windowOpen(adminIn, phone, now);
      const decision = programmeReminderDecision({
        featureEnabled: true,
        optedIn: true,
        days: client.programme_reminder_days ?? [],
        weekday,
        lastSentOn: client.programme_reminder_last_sent_on,
        today,
        windowOpen: open,
        templateSet: Boolean(template),
      });
      if (decision === "skip") {
        if (!open && !template && (client.programme_reminder_days ?? []).includes(weekday)) {
          log.warn("programme reminder skipped: window closed and no template", {
            to: maskPhone(phone),
          });
        }
        continue;
      }
      const first = (client.full_name || "there").trim().split(/\s+/)[0] || "there";
      const body = programmeReminderBody({
        firstName: first,
        libraryLive: !LIBRARY_COMING_SOON,
        exerciseName: null,
        appLink: LIBRARY_URL,
      });
      const ok =
        decision === "send_text"
          ? await sendLogged(adminIn, env, { kind: "text", to: phone, body }, body)
          : await sendLogged(
              adminIn,
              env,
              {
                kind: "template",
                to: phone,
                templateName: template,
                languageCode: process.env.WHATSAPP_PROGRAMME_REMINDER_TEMPLATE_LANG?.trim() || "en",
                variables: [first, LIBRARY_URL],
              },
              `[programme reminder template ${template}]`,
            );
      if (ok) {
        await admin
          .from("clients")
          .update({ programme_reminder_last_sent_on: today })
          .eq("id", client.id);
      }
    }
  } catch (e) {
    log.warn("programme reminder failed", { error: e instanceof Error ? e.message : "unknown" });
  }
}
