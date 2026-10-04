import { createFileRoute } from "@tanstack/react-router";
import { log } from "@/lib/log";
import { createInboundStore } from "@/lib/whatsapp/queue";
import { handleWebhook, verifyHandshake } from "@/lib/whatsapp/webhook-handler";
import type { ProviderSecrets, WhatsAppProviderId } from "@/lib/whatsapp/provider";

/**
 * WhatsApp inbound webhook.
 *
 * Deliberately thin. It reads the raw body, hands it to the provider-agnostic
 * handler and answers. All the logic worth testing lives in webhook-handler.ts.
 *
 * This endpoint is unauthenticated by necessity, since the provider calls it.
 * Its only gate is the signature check inside the handler, which is why that
 * runs before the body is parsed and why a failure returns a bare 403.
 *
 * After storing, it hands new messages straight to the worker
 * (worker.server.ts) so the patient gets an answer in seconds. The
 * whatsapp-worker cron hook picks up anything that call did not finish.
 */

function readSecrets(): { provider: WhatsAppProviderId; secrets: ProviderSecrets } | null {
  const provider = process.env.WHATSAPP_PROVIDER;
  if (provider !== "meta" && provider !== "twilio") return null;

  const signingSecret =
    provider === "meta" ? process.env.META_APP_SECRET : process.env.TWILIO_AUTH_TOKEN;
  const senderId =
    provider === "meta" ? process.env.META_PHONE_NUMBER_ID : process.env.TWILIO_WHATSAPP_FROM;

  if (!signingSecret || !senderId) return null;

  return {
    provider,
    secrets: {
      signingSecret,
      senderId,
      accessToken:
        provider === "meta" ? process.env.META_ACCESS_TOKEN : process.env.TWILIO_ACCOUNT_SID,
      verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN,
    },
  };
}

export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      // Meta's subscription handshake. Twilio never calls this.
      GET: async ({ request }) => {
        const config = readSecrets();
        if (!config) return new Response("", { status: 404 });
        const url = new URL(request.url);
        const { status, body } = verifyHandshake(url.searchParams, config.secrets);
        return new Response(body, {
          status,
          headers: { "Content-Type": "text/plain" },
        });
      },

      POST: async ({ request }) => {
        const config = readSecrets();
        // Not configured: behave as though the route does not exist, rather
        // than advertising an endpoint that is waiting for credentials.
        if (!config) return new Response("", { status: 404 });

        // The raw bytes, untouched. Both signature schemes depend on this
        // being exactly what was sent, so it must not be re-serialised.
        const rawBody = await request.text();
        const headers: Record<string, string> = {};
        request.headers.forEach((value, key) => {
          headers[key] = value;
        });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const store = createInboundStore(supabaseAdmin as never);

        const outcome = await handleWebhook(
          { rawBody, headers, url: request.url },
          { provider: config.provider, secrets: config.secrets, store },
        );

        // Counts only. Never the body, never a phone number.
        if (outcome.summary.rejected || outcome.summary.failed > 0) {
          log.warn("whatsapp webhook", { ...outcome.summary, provider: config.provider });
        }

        // Answer the patient now rather than at the next cron tick. Bounded so
        // a slow send can never hold Meta's delivery open long enough for it
        // to retry. Anything unfinished stays pending for the worker hook.
        if (outcome.summary.accepted > 0) {
          try {
            const { processPendingInbound, whatsappConfigFromEnv } =
              await import("@/lib/whatsapp/worker.server");
            const cfg = whatsappConfigFromEnv();
            if (cfg) {
              await Promise.race([
                processPendingInbound({ admin: supabaseAdmin as never, ...cfg }, 5),
                new Promise((resolve) => setTimeout(resolve, 8_000)),
              ]);
            }
          } catch (e) {
            log.warn("whatsapp webhook: inline processing failed", {
              error: e instanceof Error ? e.message.slice(0, 120) : "unknown",
            });
          }
        }

        return new Response(outcome.body, { status: outcome.status });
      },
    },
  },
});
