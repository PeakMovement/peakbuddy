import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildRehabIcs, type ReminderSchedule } from "@/lib/calendar-feed";

// Public per-client iCal feed. Authenticated by the unguessable token in the path
// (calendar apps subscribe without a session). Serves text/calendar.
export const Route = createFileRoute("/api/public/calendar/$token")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const last = url.pathname.split("/").pop() ?? "";
        const tok = last.replace(/\.ics$/i, "");
        if (!tok || tok.length < 16) return new Response("Not found", { status: 404 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as unknown as SupabaseClient;

        const { data: client } = await db
          .from("clients")
          .select("id")
          .eq("calendar_feed_token", tok)
          .maybeSingle();
        if (!client) return new Response("Not found", { status: 404 });

        const { data: reminder } = await db
          .from("checkin_reminders")
          .select("enabled, frequency, time_of_day, days_of_week, timezone")
          .eq("client_id", client.id)
          .maybeSingle();

        const base = process.env.BUDDY_APP_BASE_URL ?? url.origin;
        const ics = buildRehabIcs({
          clientId: client.id as string,
          appBase: base,
          reminder: (reminder ?? null) as ReminderSchedule,
        });

        return new Response(ics, {
          status: 200,
          headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": 'inline; filename="buddy-rehab.ics"',
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
