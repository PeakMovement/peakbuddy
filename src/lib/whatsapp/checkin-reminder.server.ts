/**
 * Claim today's check-in reminder, send it, and keep the claim only after a
 * channel actually delivers. Two overlapping cron ticks cannot both send.
 * A failed WhatsApp send and a push that delivered to nobody release the
 * claim, so a later tick in the same fire window can try again.
 */
import { log } from "@/lib/log";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

interface ClaimChain extends PromiseLike<{ data: unknown; error: { message?: string } | null }> {
  eq: (column: string, value: unknown) => ClaimChain;
  or: (filters: string) => ClaimChain;
  select: (columns?: string) => ClaimChain;
  maybeSingle: () => PromiseLike<{
    data: { id?: string } | null;
    error?: { message?: string } | null;
  }>;
}

type ReminderDb = {
  from: (table: string) => {
    update: (values: Record<string, unknown>) => ClaimChain;
  };
};

export async function claimAndDeliverCheckinReminder(
  adminIn: Admin,
  input: {
    reminderId: string;
    authUserId: string | null;
    localDate: string;
    previousSentOn: string | null;
    sendWhatsApp: () => Promise<string>;
    sendPush: (userId: string) => Promise<{ delivered?: number } | void>;
  },
): Promise<"sent" | "skipped"> {
  const admin = adminIn as unknown as ReminderDb;
  const release = async () => {
    await admin
      .from("checkin_reminders")
      .update({ last_sent_on: input.previousSentOn })
      .eq("id", input.reminderId);
  };

  try {
    const { data: claimed } = await admin
      .from("checkin_reminders")
      .update({ last_sent_on: input.localDate })
      .eq("id", input.reminderId)
      // Claim rows never sent (NULL) OR last sent on a different day.
      // .neq alone would exclude NULLs and skip first-ever reminders.
      .or(`last_sent_on.is.null,last_sent_on.neq.${input.localDate}`)
      .select("id")
      .maybeSingle();
    if (!claimed) return "skipped";

    const wa = await input.sendWhatsApp().catch(() => "failed" as const);
    if (wa === "sent") return "sent";

    if (input.authUserId) {
      try {
        const push = await input.sendPush(input.authUserId);
        if ((push?.delivered ?? 0) > 0) return "sent";
      } catch (e) {
        log.warn("checkin reminder push failed", { id: input.reminderId, error: e });
      }
    }

    await release();
    return "skipped";
  } catch (e) {
    await release().catch(() => undefined);
    log.warn("checkin-reminders failed", { id: input.reminderId, error: e });
    return "skipped";
  }
}
