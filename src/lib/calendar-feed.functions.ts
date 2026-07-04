import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";

function makeToken(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

// Ensure the signed-in client has a calendar feed token and return the feed URLs.
export const getCalendarFeedUrl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ url: string; webcal: string } | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;

    const { data: client } = await db
      .from("clients")
      .select("id, calendar_feed_token")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!client) return null;

    let tok = (client as { calendar_feed_token: string | null }).calendar_feed_token;
    if (!tok) {
      tok = makeToken();
      await db.from("clients").update({ calendar_feed_token: tok }).eq("id", client.id);
    }

    const base = process.env.BUDDY_APP_BASE_URL ?? "https://buddytracker.netlify.app";
    const url = `${base}/api/public/calendar/${tok}.ics`;
    const webcal = url.replace(/^https?:\/\//, "webcal://");
    return { url, webcal };
  });
