import { createFileRoute } from "@tanstack/react-router";
import { trackedJob } from "@/lib/job-runs.server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { reminderDueOnWeekday } from "@/lib/whatsapp/schedule";

/**
 * Cron endpoint — runs every 5 minutes.
 * Sends a "time to check in" to any client whose reminder falls in the current
 * 5-minute window in their local timezone and hasn't been sent today: on
 * WhatsApp for WhatsApp patients (daily by default), as an app push otherwise.
 */
export const Route = createFileRoute("/api/public/hooks/checkin-reminders")({
  server: {
    handlers: {
      POST: trackedJob("checkin-reminders-tick", async ({ request }: { request: Request }) => {
        const denied = await authorizeCronRequest(request);
        if (denied) return denied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendPushCore } = await import("@/lib/push.functions");
        const { sendWhatsAppReminder } = await import("@/lib/whatsapp/worker.server");
        const { claimAndDeliverCheckinReminder } =
          await import("@/lib/whatsapp/checkin-reminder.server");

        const { data: reminders, error } = await supabaseAdmin
          .from("checkin_reminders")
          .select("id, client_id, frequency, time_of_day, days_of_week, timezone, last_sent_on")
          .eq("enabled", true);

        if (error) {
          return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        let sent = 0;
        let skipped = 0;
        let undelivered = 0;
        const now = new Date();

        for (const r of reminders ?? []) {
          try {
            const tz = r.timezone || "UTC";
            const fmt = new Intl.DateTimeFormat("en-US", {
              timeZone: tz,
              hour12: false,
              weekday: "short",
              hour: "2-digit",
              minute: "2-digit",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            });
            const parts = fmt.formatToParts(now);
            const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
            const weekdayMap: Record<string, number> = {
              Sun: 0,
              Mon: 1,
              Tue: 2,
              Wed: 3,
              Thu: 4,
              Fri: 5,
              Sat: 6,
            };
            const wd = weekdayMap[get("weekday")] ?? -1;
            const hour = parseInt(get("hour"), 10);
            const minute = parseInt(get("minute"), 10);
            const localDate = `${get("year")}-${get("month")}-${get("day")}`;

            // days_of_week is the patient's choice. A "daily" frequency label must
            // not widen it: "twice a week" is stored as those days only.
            if (!reminderDueOnWeekday(r.days_of_week, wd)) {
              skipped++;
              continue;
            }
            if (r.last_sent_on === localDate) {
              skipped++;
              continue;
            }

            const [tH, tM] = String(r.time_of_day)
              .split(":")
              .map((x) => parseInt(x, 10));
            const nowMin = hour * 60 + minute;
            const targetMin = tH * 60 + tM;
            const diff = nowMin - targetMin;
            // fire if we're within 0..6 minutes past the target (5-min cron cadence)
            if (diff < 0 || diff > 6) {
              skipped++;
              continue;
            }

            // Archived clients get no reminders (client-archive.server.ts).
            const { withoutArchived } = await import("@/lib/client-archive.server");
            const { data: client } = (await withoutArchived((f) => {
              const q = supabaseAdmin
                .from("clients")
                .select("id, auth_user_id, full_name")
                .eq("id", r.client_id);
              return (f ? q.is("archived_at" as never, null) : q).maybeSingle();
            })) as {
              data: { id: string; auth_user_id: string | null; full_name: string } | null;
            };
            if (!client) {
              skipped++;
              continue;
            }

            // Skip if a check-in already exists today (local date).
            // Local midnight in the reminder's own timezone, as a UTC instant.
            const localNowMs = Date.UTC(
              Number(get("year")),
              Number(get("month")) - 1,
              Number(get("day")),
              hour % 24,
              minute,
            );
            const offsetMs = Math.round((localNowMs - now.getTime()) / 60_000) * 60_000;
            const dayStart = new Date(
              Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day"))) -
                offsetMs,
            ).toISOString();
            const { count } = await supabaseAdmin
              .from("check_ins")
              .select("id", { count: "exact", head: true })
              .eq("client_id", client.id)
              .gte("created_at", dayStart);
            if ((count ?? 0) > 0) {
              await supabaseAdmin
                .from("checkin_reminders")
                .update({ last_sent_on: localDate })
                .eq("id", r.id);
              skipped++;
              continue;
            }

            // Claim before sending so two overlapping ticks can't both send.
            // The claim is kept only after WhatsApp reports "sent" or a push
            // reports at least one delivery. Otherwise it is put back.
            const outcome = await claimAndDeliverCheckinReminder(supabaseAdmin, {
              reminderId: r.id,
              authUserId: client.auth_user_id,
              localDate,
              previousSentOn: r.last_sent_on,
              sendWhatsApp: () => sendWhatsAppReminder(supabaseAdmin, client.id, now),
              sendPush: (userId) =>
                sendPushCore(supabaseAdmin, {
                  userId,
                  title: "Time for your check-in",
                  body: "Tap to log how you're feeling today.",
                  data: { type: "checkin_reminder", path: "/client/app/checkin" },
                  sentBy: null,
                }),
            });
            if (outcome === "sent") sent++;
            else if (outcome === "undelivered") undelivered++;
            else skipped++;
          } catch (e) {
            log.warn("checkin-reminders failed", { id: r.id, error: e });
          }
        }

        try {
          const { runProgrammeReminders } =
            await import("@/lib/whatsapp/programme-reminder.server");
          const { whatsappConfigFromEnv } = await import("@/lib/whatsapp/worker.server");
          const cfg = whatsappConfigFromEnv();
          if (cfg) await runProgrammeReminders(supabaseAdmin, cfg, now);
        } catch (e) {
          log.warn("programme reminder hook failed", {
            error: e instanceof Error ? e.message : "unknown",
          });
        }

        if (undelivered > 0 && sent === 0) {
          const { alertUndeliveredCheckins } =
            await import("@/lib/whatsapp/checkin-delivery.server");
          await alertUndeliveredCheckins(supabaseAdmin, {
            undelivered,
            delivered: sent,
            now,
          }).catch((e) =>
            log.warn("check-in delivery alert failed", {
              error: e instanceof Error ? e.message : "unknown",
            }),
          );
        }

        return new Response(JSON.stringify({ ok: true, sent, skipped, undelivered }), {
          headers: { "Content-Type": "application/json" },
        });
      }),
    },
  },
});
