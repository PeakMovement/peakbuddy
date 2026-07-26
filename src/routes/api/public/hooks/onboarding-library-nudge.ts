import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron endpoint — run once daily.
 * Sends a one-time push to each client ~3 days after sign-up, pointing them to
 * the Exercise Library ("Come look at what we have for you!"). Idempotent via
 * clients.onboarding_library_nudge_sent_at, so a client is nudged at most once.
 * Bounded to recent sign-ups so enabling this never mass-pings the whole base.
 */
export const Route = createFileRoute("/api/public/hooks/onboarding-library-nudge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Auth: require CRON_SECRET; fail closed if unset (never accept the
        // public anon key, which ships in the client bundle).
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret) return new Response("Unauthorized", { status: 401 });
        const provided =
          request.headers.get("x-cron-secret") ??
          request.headers.get("X-Cron-Secret") ??
          (request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null);
        if (provided !== cronSecret) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendPushCore } = await import("@/lib/push.functions");

        const now = Date.now();
        const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
        const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();

        // Signed up >= 3 days ago, <= 10 days ago, never nudged, has an auth user.
        const { data: clients, error } = await supabaseAdmin
          .from("clients")
          .select("id, auth_user_id, full_name, created_at")
          .is("onboarding_library_nudge_sent_at", null)
          .lte("created_at", threeDaysAgo)
          .gte("created_at", tenDaysAgo)
          .not("auth_user_id", "is", null)
          .limit(500);

        if (error) {
          return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        let nudged = 0;
        for (const c of clients ?? []) {
          const userId = c.auth_user_id as string | null;
          if (!userId) continue;
          try {
            await sendPushCore(supabaseAdmin, {
              userId,
              title: "Come look at what we have for you!",
              body: "Your Peak Movement exercise library is ready — fresh programs added every week. Tap to explore.",
              data: { kind: "library", url: "/client/app/library" },
            });
          } catch {
            /* delivery is best-effort; still mark so we don't retry forever */
          }
          // One-shot: mark sent regardless of delivery outcome.
          await supabaseAdmin
            .from("clients")
            .update({ onboarding_library_nudge_sent_at: new Date().toISOString() })
            .eq("id", c.id as string)
            .is("onboarding_library_nudge_sent_at", null);
          nudged += 1;
        }

        return new Response(JSON.stringify({ ok: true, nudged }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
