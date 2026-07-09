import { createFileRoute } from "@tanstack/react-router";
import {
  exchangeCodeForToken,
  fetchGoogleUserEmail,
  googleCreds,
  googleRedirectUri,
} from "@/lib/google-calendar/oauth";

function html(body: string, status = 200) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Google Calendar</title><body style="font-family:system-ui;padding:24px;max-width:520px;margin:0 auto;color:#111">${body}</body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export const Route = createFileRoute("/api/public/google-calendar/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const err = url.searchParams.get("error");
        if (err) return html(`<h2>Google Calendar</h2><p>Cancelled: ${err}</p>`, 400);
        if (!code || !state) return html("<h2>Missing code/state</h2>", 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: stateRow } = await supabaseAdmin
          .from("google_calendar_oauth_state")
          .select("user_id, expires_at, redirect_after")
          .eq("state", state)
          .maybeSingle();
        if (!stateRow) return html("<h2>Invalid or expired state</h2>", 400);
        const row = stateRow as {
          user_id: string;
          expires_at: string;
          redirect_after: string | null;
        };
        if (new Date(row.expires_at).getTime() < Date.now()) {
          await supabaseAdmin.from("google_calendar_oauth_state").delete().eq("state", state);
          return html("<h2>Connection request expired. Please try again.</h2>", 400);
        }

        const { clientId, clientSecret } = googleCreds();
        let token;
        try {
          token = await exchangeCodeForToken({
            code,
            clientId,
            clientSecret,
            redirectUri: googleRedirectUri(),
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return html(`<h2>Google token exchange failed</h2><pre>${msg}</pre>`, 500);
        }

        const email = await fetchGoogleUserEmail(token.access_token);
        const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

        const { error: upErr } = await supabaseAdmin.from("google_calendar_tokens").upsert(
          {
            user_id: row.user_id,
            access_token: token.access_token,
            refresh_token: token.refresh_token ?? null,
            scope: token.scope,
            token_type: token.token_type,
            expires_at: expiresAt,
            google_email: email,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
        if (upErr) return html(`<h2>Failed to save token</h2><pre>${upErr.message}</pre>`, 500);

        await supabaseAdmin.from("google_calendar_oauth_state").delete().eq("state", state);

        const redirectTo = row.redirect_after ?? "/client/app/profile";
        return html(
          `<h2>Google Calendar connected${email ? ` as ${email}` : ""}</h2>
          <p>You can close this tab.</p>
          <script>setTimeout(function(){ location.replace(${JSON.stringify(redirectTo)}); }, 1200);</script>`,
        );
      },
    },
  },
});
