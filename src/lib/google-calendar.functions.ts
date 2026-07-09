import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildGoogleAuthorizeUrl,
  generateState,
  googleCreds,
  googleRedirectUri,
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
