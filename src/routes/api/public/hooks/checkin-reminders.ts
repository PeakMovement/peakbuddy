import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron endpoint — runs every 5 minutes.
 * Sends a "time to check in" push to any client whose reminder falls in the
 * current 5-minute window in their local timezone and hasn't been sent today.
 */
export const Route = createFileRoute("/api/public/hooks/checkin-reminders")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendPushCore } = await import("@/lib/push.functions");

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
              Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
            };
            const wd = weekdayMap[get("weekday")] ?? -1;
            const hour = parseInt(get("hour"), 10);
            const minute = parseInt(get("minute"), 10);
            const localDate = `${get("year")}-${get("month")}-${get("day")}`;

            if (!(r.days_of_week ?? []).includes(wd)) { skipped++; continue; }
            if (r.last_sent_on === localDate) { skipped++; continue; }

            const [tH, tM] = String(r.time_of_day).split(":").map((x) => parseInt(x, 10));
            const nowMin = hour * 60 + minute;
            const targetMin = tH * 60 + tM;
            const diff = nowMin - targetMin;
            // fire if we're within 0..6 minutes past the target (5-min cron cadence)
            if (diff < 0 || diff > 6) { skipped++; continue; }

            const { data: client } = await supabaseAdmin
              .from("clients")
              .select("id, auth_user_id, full_name")
              .eq("id", r.client_id)
              .maybeSingle();
            if (!client?.auth_user_id) { skipped++; continue; }

            // Skip if a check-in already exists today (local date).
            const dayStart = new Date(`${localDate}T00:00:00`).toISOString();
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

            await sendPushCore(supabaseAdmin, {
              userId: client.auth_user_id,
              title: "Time for your check-in",
              body: "Tap to log how you're feeling today.",
              data: { type: "checkin_reminder", path: "/client/app/checkin" },
              sentBy: null,
            });

            await supabaseAdmin
              .from("checkin_reminders")
              .update({ last_sent_on: localDate })
              .eq("id", r.id);
            sent++;
          } catch (e) {
            console.error("[checkin-reminders] failed for", r.id, e);
          }
        }

        return new Response(JSON.stringify({ ok: true, sent, skipped }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
