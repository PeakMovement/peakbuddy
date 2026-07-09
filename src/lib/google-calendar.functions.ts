import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildGoogleAuthorizeUrl,
  buildGoogleEventBody,
  deleteGoogleCalendarEvent,
  generateState,
  getFreshGoogleAccessToken,
  googleCreds,
  googleRedirectUri,
  insertGoogleCalendarEvent,
} from "./google-calendar/oauth";

export type GoogleCalendarStatus = {
  connected: boolean;
  email: string | null;
  scope: string | null;
};

/** Whether the current user has a stored Google Calendar connection. */
export const getGoogleCalendarStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GoogleCalendarStatus> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("google_calendar_tokens")
      .select("google_email, scope")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!data) return { connected: false, email: null, scope: null };
    return {
      connected: true,
      email: (data as { google_email: string | null }).google_email ?? null,
      scope: (data as { scope: string | null }).scope ?? null,
    };
  });

/** Start the OAuth flow: create a state row and return Google's authorize URL. */
export const startGoogleCalendarConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { redirectAfter?: string } | undefined) => data ?? {})
  .handler(async ({ data, context }): Promise<{ authUrl: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { clientId } = googleCreds();
    const state = generateState();
    const { error } = await supabaseAdmin.from("google_calendar_oauth_state").insert({
      state,
      user_id: context.userId,
      redirect_after: data.redirectAfter ?? null,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (error) throw new Error(`Failed to start Google Calendar connect: ${error.message}`);
    const authUrl = buildGoogleAuthorizeUrl({
      clientId,
      redirectUri: googleRedirectUri(),
      state,
    });
    return { authUrl };
  });

/** Remove the current user's stored Google Calendar tokens. */
export const disconnectGoogleCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("google_calendar_tokens")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw new Error(`Failed to disconnect Google Calendar: ${error.message}`);
    return { ok: true };
  });

/**
 * Add (or replace) the client's check-in reminder as a recurring event in their
 * connected Google Calendar. Uses their saved reminder schedule; falls back to a
 * daily 08:00 reminder. Idempotent: replaces the previously created event.
 */
export const addCheckinReminderToGoogleCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as { from: (t: string) => any };

    // Must be connected.
    const { data: tokenRow } = await db
      .from("google_calendar_tokens")
      .select("user_id, checkin_event_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!tokenRow) return { ok: false as const, reason: "not_connected" as const };

    // Resolve client + their reminder schedule.
    const { data: client } = await db
      .from("clients")
      .select("id")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!client) return { ok: false as const, reason: "not_client" as const };

    const { data: rem } = await db
      .from("checkin_reminders")
      .select("enabled, frequency, time_of_day, days_of_week, timezone")
      .eq("client_id", client.id)
      .maybeSingle();

    const time = (rem?.time_of_day as string | undefined) ?? "08:00";
    const timeZone = (rem?.timezone as string | undefined) || "UTC";
    const daysOfWeek = (rem?.days_of_week as number[] | undefined) ?? [0, 1, 2, 3, 4, 5, 6];
    const appBase = process.env.BUDDY_APP_BASE_URL ?? "https://peakbuddy.lovable.app";

    const body = buildGoogleEventBody({
      summary: "Buddy check-in",
      description: `Log how you're feeling in Buddy. ${appBase}/client/app/checkin`,
      startDate: new Date().toISOString().slice(0, 10),
      time,
      timeZone,
      daysOfWeek,
    });

    const accessToken = await getFreshGoogleAccessToken(db, context.userId);
    if (!accessToken) return { ok: false as const, reason: "no_token" as const };

    // Replace any previously created event so repeat taps don't duplicate.
    const prevId = (tokenRow as { checkin_event_id?: string | null }).checkin_event_id;
    if (prevId) await deleteGoogleCalendarEvent(accessToken, prevId);

    try {
      const created = await insertGoogleCalendarEvent(accessToken, body);
      await db
        .from("google_calendar_tokens")
        .update({ checkin_event_id: created.id })
        .eq("user_id", context.userId);
      return { ok: true as const, eventLink: created.htmlLink ?? null };
    } catch (e) {
      return { ok: false as const, reason: "insert_failed" as const, error: e instanceof Error ? e.message : "unknown" };
    }
  });
