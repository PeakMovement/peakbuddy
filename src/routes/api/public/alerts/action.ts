import { createFileRoute } from "@tanstack/react-router";

/**
 * Public one-click action route embedded in practitioner alert emails.
 *
 * URL: /api/public/alerts/action?token=<opaque>
 * The token binds to (alert_id, practitioner_id, action, expiry) and is
 * single-use. No login required from the email; the token IS the capability.
 */
export const Route = createFileRoute("/api/public/alerts/action")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token");
        if (!token) return renderPage("Missing token", "This link is invalid.");

        const { verifyAlertActionToken, consumeAlertActionToken } = await import(
          "@/lib/alert-actions.server"
        );
        const verified = await verifyAlertActionToken(token);
        if (!verified.ok) {
          const msg =
            verified.reason === "expired"
              ? "This link has expired. Open Buddy to review the alert."
              : verified.reason === "already_used"
                ? "This action has already been completed."
                : "This link is invalid.";
          return renderPage("Link not valid", msg);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { alertId, practitionerId, action, tokenRowId } = verified.token;

        if (action === "reviewed") {
          await supabaseAdmin
            .from("alerts")
            .update({
              reviewed_at: new Date().toISOString(),
              reviewed_by: practitionerId,
              is_read: true,
            })
            .eq("id", alertId);
          await consumeAlertActionToken(tokenRowId);
          return renderPage(
            "Marked reviewed",
            "This alert is now marked as reviewed. You can close this tab.",
          );
        }

        if (action === "checkin") {
          // Look up the client on the alert, then fire the same push as
          // sendCheckInNudge without needing a Supabase session.
          const { data: alert } = await supabaseAdmin
            .from("alerts")
            .select("client_id, practitioner_id")
            .eq("id", alertId)
            .maybeSingle();
          if (!alert || alert.practitioner_id !== practitionerId) {
            return renderPage("Link not valid", "This link is invalid.");
          }

          const { data: client } = await supabaseAdmin
            .from("clients")
            .select("auth_user_id, full_name")
            .eq("id", alert.client_id)
            .maybeSingle();

          if (!client?.auth_user_id) {
            await consumeAlertActionToken(tokenRowId);
            return renderPage(
              "Cannot notify patient",
              "This patient has not signed in yet, so they can't be notified. Please contact them directly.",
            );
          }

          const { sendPushCore } = await import("@/lib/push.functions");
          await sendPushCore(supabaseAdmin, {
            userId: client.auth_user_id,
            title: "Buddy check-in",
            body: "Your practitioner is checking in. Tap to log how you're doing.",
            data: { type: "checkin_request" },
            sentBy: practitionerId,
          });
          await consumeAlertActionToken(tokenRowId);
          const first = (client.full_name || "your patient").trim().split(/\s+/)[0];
          return renderPage(
            "Check-in requested",
            `We sent ${first} a push notification asking them to check in.`,
          );
        }

        return renderPage("Unknown action", "This link is invalid.");
      },
    },
  },
});

function renderPage(title: string, body: string) {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} — Buddy</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        background: #1a2952;
        color: #f0ece4;
        font-family: 'Rajdhani', 'Segoe UI', Arial, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      .card {
        background: #243a6b;
        border: 1px solid #3658a3;
        border-radius: 16px;
        max-width: 420px;
        padding: 32px 28px;
        text-align: center;
      }
      .brand {
        font-family: 'Cormorant Garamond', Georgia, serif;
        font-size: 28px;
        font-weight: 600;
        margin: 0 0 4px;
      }
      .rule {
        font-size: 11px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: #4a8df0;
        margin: 0 0 24px;
      }
      h1 {
        font-family: 'Cormorant Garamond', Georgia, serif;
        font-size: 22px;
        margin: 0 0 12px;
      }
      p { line-height: 1.5; color: #b8c5db; margin: 0 0 20px; }
      a {
        display: inline-block;
        background: #4a8df0;
        color: #0b1836;
        text-decoration: none;
        font-weight: 700;
        padding: 10px 20px;
        border-radius: 8px;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <p class="brand">Buddy</p>
      <p class="rule">by Peak Movement</p>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(body)}</p>
      <a href="https://peakbuddy.lovable.app/practitioner/app">Open Buddy</a>
    </div>
  </body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
