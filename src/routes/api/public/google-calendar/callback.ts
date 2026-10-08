import { createFileRoute } from "@tanstack/react-router";
import {
  exchangeCodeForToken,
  fetchGoogleUserEmail,
  googleCreds,
  googleRedirectUri,
} from "@/lib/google-calendar/oauth";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only same-site relative paths; anything else falls back to the profile. */
function safeRedirectPath(p: string | null): string {
  if (!p || !p.startsWith("/") || p.startsWith("//") || p.startsWith("/\\")) {
    return "/client/app/profile";
  }
  return p;
}

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
        // Never echo query-string text back into the page.
        if (err)
          return html(
            "<h2>Google Calendar</h2><p>The connection was cancelled. You can close this tab and try again.</p>",
            400,
          );
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
        } catch {
          return html(
            "<h2>Google Calendar</h2><p>We could not finish connecting your calendar. Please try again.</p>",
            500,
          );
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
        if (upErr)
          return html(
            "<h2>Google Calendar</h2><p>We could not save the connection. Please try again.</p>",
            500,
          );

        await supabaseAdmin.from("google_calendar_oauth_state").delete().eq("state", state);

        const redirectTo = safeRedirectPath(row.redirect_after);
        // JSON.stringify alone does not stop "</script>" breaking out of the tag.
        const redirectJs = JSON.stringify(redirectTo).replace(/</g, "\\u003c");
        return html(
          `<h2>Google Calendar connected${email ? ` as ${escapeHtml(email)}` : ""}</h2>
          <p>You can close this tab.</p>
          <script>setTimeout(function(){ location.replace(${redirectJs}); }, 1200);</script>`,
        );
      },
    },
  },
});
