import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PLATFORMS = ["ios", "android", "web", "despia"] as const;
type Platform = (typeof PLATFORMS)[number];

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
    const { data: tokens, error } = await supabaseAdmin
      .from("push_tokens")
      .select("id, token, platform")
      .eq("user_id", data.userId);
    if (error) throw error;

    const pushKey = process.env.DESPIA_PUSH_KEY;
    const failures: { token_id: string; reason: string }[] = [];
    let delivered = 0;

    for (const row of tokens ?? []) {
      try {
        // DESPIA_PUSH_SEND: replace with Despia's documented push send call or REST endpoint,
        // using DESPIA_PUSH_KEY from Lovable Cloud secrets.
        if (!pushKey) {
          console.log(
            `[sendPush] would notify ${data.userId}: ${data.title} - ${data.body}`,
          );
        } else {
          console.log(
            `[sendPush] would notify ${data.userId}: ${data.title} - ${data.body}`,
          );
        }
        delivered += 1;
      } catch (e) {
        failures.push({
          token_id: row.id,
          reason: e instanceof Error ? e.message : "unknown",
        });
      }
    }

    // suppress unused-var warning while placeholder remains
    void context;
    void data.data;

    return {
      ok: true,
      simulated: true,
      attempted: tokens?.length ?? 0,
      delivered,
      failures,
    };
  });
