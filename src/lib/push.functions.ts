import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PLATFORMS = ["ios", "android", "web", "despia"] as const;
type Platform = (typeof PLATFORMS)[number];

type AdminClient = typeof import("@/integrations/supabase/client.server")["supabaseAdmin"];

type JsonValue = string | number | boolean | null | { [k: string]: JsonValue } | JsonValue[];

type PushResult = {
  ok: true;
  simulated: boolean;
  attempted: number;
  delivered: number;
  failures: { token_id: string; reason: string }[];
  response?: JsonValue | null;
};

/**
 * Core push delivery. Looks up all push_tokens for userId and dispatches one
 * OneSignal REST call with include_player_ids (tokens stored from the Despia
 * bridge ARE OneSignal player_ids). Returns delivery counts and writes a row
 * to push_send_log so a super admin can audit attempts without device access.
 *
 * Falls back to "simulated" mode (logs only) when ONESIGNAL_APP_ID or
 * ONESIGNAL_REST_API_KEY are missing so dev preview never explodes.
 */
export async function sendPushCore(
  supabaseAdmin: AdminClient,
  args: {
    userId: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    sentBy?: string | null;
  },
): Promise<PushResult> {
  const failures: { token_id: string; reason: string }[] = [];
  const logRow = {
    recipient_user_id: args.userId,
    sent_by: args.sentBy ?? null,
    title: args.title,
    body: args.body,
    provider: "onesignal" as const,
  };

  const { data: tokens, error } = await supabaseAdmin
    .from("push_tokens")
    .select("id, token, platform")
    .eq("user_id", args.userId);

  if (error) {
    await supabaseAdmin.from("push_send_log").insert({
      ...logRow,
      status: "error",
      error_message: `token lookup: ${error.message}`,
    });
    return {
      ok: true,
      simulated: false,
      attempted: 0,
      delivered: 0,
      failures: [{ token_id: "lookup", reason: error.message }],
    };
  }

  const playerIds = (tokens ?? []).map((t) => t.token).filter(Boolean);
  if (playerIds.length === 0) {
    await supabaseAdmin.from("push_send_log").insert({
      ...logRow,
      status: "no_tokens",
      attempted: 0,
      delivered: 0,
    });
    return { ok: true, simulated: false, attempted: 0, delivered: 0, failures: [] };
  }

  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;

  if (!appId || !apiKey) {
    console.log(`[sendPush:SIM] ${args.userId} :: ${args.title} — ${args.body}`);
    await supabaseAdmin.from("push_send_log").insert({
      ...logRow,
      status: "simulated",
      attempted: playerIds.length,
      delivered: 0,
      error_message: "ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY not configured",
    });
    return {
      ok: true,
      simulated: true,
      attempted: playerIds.length,
      delivered: 0,
      failures: [{ token_id: "config", reason: "OneSignal credentials missing" }],
    };
  }

  try {
    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${apiKey}`,
      },
      body: JSON.stringify({
        app_id: appId,
        include_player_ids: playerIds,
        headings: { en: args.title },
        contents: { en: args.body },
        data: args.data ?? {},
      }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      id?: string;
      recipients?: number;
      errors?: unknown;
      invalid_player_ids?: string[];
    };

    if (!res.ok || (json.errors && !json.id)) {
      const reason =
        typeof json.errors === "string"
          ? json.errors
          : JSON.stringify(json.errors ?? { status: res.status });
      await supabaseAdmin.from("push_send_log").insert({
        ...logRow,
        status: "failed",
        attempted: playerIds.length,
        delivered: 0,
        response: json,
        error_message: reason,
      });
      return {
        ok: true,
        simulated: false,
        attempted: playerIds.length,
        delivered: 0,
        failures: [{ token_id: "onesignal", reason }],
        response: json,
      };
    }

    const delivered = json.recipients ?? playerIds.length;
    if (json.invalid_player_ids?.length) {
      for (const bad of json.invalid_player_ids) {
        failures.push({ token_id: bad, reason: "invalid_player_id" });
      }
    }

    await supabaseAdmin.from("push_send_log").insert({
      ...logRow,
      status: "delivered",
      attempted: playerIds.length,
      delivered,
      response: json,
    });

    return {
      ok: true,
      simulated: false,
      attempted: playerIds.length,
      delivered,
      failures,
      response: json,
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "unknown";
    await supabaseAdmin.from("push_send_log").insert({
      ...logRow,
      status: "error",
      attempted: playerIds.length,
      delivered: 0,
      error_message: reason,
    });
    return {
      ok: true,
      simulated: false,
      attempted: playerIds.length,
      delivered: 0,
      failures: [{ token_id: "fetch", reason }],
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
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return sendPushCore(supabaseAdmin, { ...data, sentBy: context.userId });
  });

/** Super-admin only: send a test push to myself or any user, with detailed result. */
export const sendTestPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId?: string; title?: string; body?: string }) =>
    z
      .object({
        userId: z.string().uuid().optional(),
        title: z.string().min(1).max(200).optional(),
        body: z.string().min(1).max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("role")
      .eq("id", context.userId)
      .maybeSingle();
    if (prof?.role !== "super_admin") {
      return {
        ok: false as const,
        reason: "forbidden" as const,
      };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const target = data.userId ?? context.userId;

    // Quick token snapshot so the UI can explain "no token registered yet".
    const { data: tokens } = await supabaseAdmin
      .from("push_tokens")
      .select("id, platform, last_seen")
      .eq("user_id", target);

    const result = await sendPushCore(supabaseAdmin, {
      userId: target,
      title: data.title ?? "Buddy test notification",
      body: data.body ?? "If you see this, push delivery is working ✅",
      data: { type: "test" },
      sentBy: context.userId,
    });

    return {
      ok: true as const,
      target,
      tokens: tokens ?? [],
      result,
    };
  });

/** Patient-or-admin: snapshot of my push tokens so I can debug delivery. */
export const getMyPushTokens = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("push_tokens")
      .select("id, platform, last_seen")
      .eq("user_id", context.userId)
      .order("last_seen", { ascending: false });
    return { userId: context.userId, tokens: data ?? [] };
  });

/**
 * Patient-initiated alert push. Verifies the caller owns the client on the
 * alert, respects push_fired so we only fire once, then sets push_fired = true.
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
      sentBy: context.userId,
    });

    await supabaseAdmin
      .from("alerts")
      .update({ push_fired: true })
      .eq("id", alert.id);

    return { ok: true as const };
  });

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
      sentBy: context.userId,
    });
    return { ok: true as const };
  });
