import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PLATFORMS = ["ios", "android", "web", "despia"] as const;
type Platform = (typeof PLATFORMS)[number];

type AdminClient = typeof import("@/integrations/supabase/client.server")["supabaseAdmin"];

/**
 * Core push delivery. Looks up all push_tokens for userId and attempts a send
 * per token. Never throws — failures are collected and returned. Callable from
 * any server context (auth'd server fn or public cron route) because it takes
 * an explicit admin client.
 */
export async function sendPushCore(
  supabaseAdmin: AdminClient,
  args: { userId: string; title: string; body: string; data?: Record<string, unknown> },
): Promise<{ ok: true; simulated: boolean; attempted: number; delivered: number; failures: { token_id: string; reason: string }[] }> {
  const failures: { token_id: string; reason: string }[] = [];
  let delivered = 0;

  try {
    const { data: tokens, error } = await supabaseAdmin
      .from("push_tokens")
      .select("id, token, platform")
      .eq("user_id", args.userId);
    if (error) {
      return { ok: true, simulated: true, attempted: 0, delivered: 0, failures: [{ token_id: "lookup", reason: error.message }] };
    }

    const pushKey = process.env.DESPIA_PUSH_KEY;

    for (const row of tokens ?? []) {
      try {
        // DESPIA_PUSH_SEND: replace with Despia's documented push send call or REST endpoint,
        // using DESPIA_PUSH_KEY from Lovable Cloud secrets.
        void pushKey;
        void row.token;
        void row.platform;
        void args.data;
        console.log(
          `[sendPush] would notify ${args.userId}: ${args.title} - ${args.body}`,
        );
        delivered += 1;
      } catch (e) {
        failures.push({
          token_id: row.id,
          reason: e instanceof Error ? e.message : "unknown",
        });
      }
    }

    return {
      ok: true,
      simulated: true,
      attempted: tokens?.length ?? 0,
      delivered,
      failures,
    };
  } catch (e) {
    return {
      ok: true,
      simulated: true,
      attempted: 0,
      delivered: 0,
      failures: [{ token_id: "lookup", reason: e instanceof Error ? e.message : "unknown" }],
    };
  }
}

export const savePushToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { token: string; platform: Platform }) =>
    z
      .object({
        token: z.string().min(1).max(4096),
        platform: z.enum(PLATFORMS),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const nowIso = new Date().toISOString();
    const { error } = await context.supabase.from("push_tokens").upsert(
      {
        user_id: context.userId,
        token: data.token,
        platform: data.platform,
        last_seen: nowIso,
      },
      { onConflict: "user_id,token" },
    );
    if (error) throw error;
    return { ok: true };
  });

export const sendPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { userId: string; title: string; body: string; data?: Record<string, unknown> }) =>
      z
        .object({
          userId: z.string().uuid(),
          title: z.string().min(1).max(200),
          body: z.string().min(1).max(2000),
          data: z.record(z.string(), z.unknown()).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return sendPushCore(supabaseAdmin, data);
  });

/**
 * Patient-initiated alert push. Verifies the caller owns the client on the
 * alert, respects push_fired so we only fire once, then sets push_fired = true.
 * Title/body are constructed server-side from DB (lock-screen privacy: first
 * name only, no symptom detail).
 */
export const notifyAlertPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { alertId: string; kind: "yves" | "morning" | "checkin" }) =>
    z
      .object({
        alertId: z.string().uuid(),
        kind: z.enum(["yves", "morning", "checkin"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: alert, error: aErr } = await supabaseAdmin
      .from("alerts")
      .select("id, practitioner_id, client_id, push_fired")
      .eq("id", data.alertId)
      .maybeSingle();
    if (aErr || !alert) return { ok: false as const, reason: "alert_not_found" as const };
    if (alert.push_fired) return { ok: true as const, skipped: "already_fired" as const };

    // Ownership: the caller must own the client linked to this alert.
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, full_name, auth_user_id")
      .eq("id", alert.client_id)
      .maybeSingle();
    if (!client || client.auth_user_id !== context.userId) {
      return { ok: false as const, reason: "forbidden" as const };
    }

    const firstName = (client.full_name || "Your client").trim().split(/\s+/)[0];
    const title = data.kind === "morning" ? "Buddy morning insight" : "Buddy alert";
    const body =
      data.kind === "morning"
        ? `${firstName} may need a check in today`
        : data.kind === "checkin"
          ? `${firstName} logged a check-in that may need review`
          : `${firstName} reported symptoms that may need review`;

    await sendPushCore(supabaseAdmin, {
      userId: alert.practitioner_id,
      title,
      body,
      data: { alertId: alert.id, clientId: alert.client_id },
    });

    await supabaseAdmin
      .from("alerts")
      .update({ push_fired: true })
      .eq("id", alert.id);

    return { ok: true as const };
  });

// Practitioner asks a client to check in -> push the client.
export const sendCheckInNudge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) =>
    z.object({ clientId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, practitioner_id, auth_user_id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) return { ok: false as const, reason: "not_found" as const };

    let allowed = client.practitioner_id === context.userId;
    if (!allowed) {
      const { data: prof } = await context.supabase
        .from("profiles")
        .select("role")
        .eq("id", context.userId)
        .maybeSingle();
      allowed = prof?.role === "super_admin";
    }
    if (!allowed) return { ok: false as const, reason: "forbidden" as const };
    if (!client.auth_user_id) return { ok: false as const, reason: "no_account" as const };

    await sendPushCore(supabaseAdmin, {
      userId: client.auth_user_id,
      title: "Buddy check-in",
      body: "Your practitioner is checking in. Tap to log how you're doing.",
      data: { type: "checkin_request" },
    });
    return { ok: true as const };
  });
