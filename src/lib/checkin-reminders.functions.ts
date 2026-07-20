import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";

const FREQUENCIES = ["daily", "morning", "evening", "custom"] as const;

const ReminderSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(FREQUENCIES),
  time_of_day: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  days_of_week: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  timezone: z.string().min(1).max(64),
});

// Resolve the caller's client by the reliable auth_user_id link. RLS on
// checkin_reminders keys on current_client_id() (JWT-email -> clients.email),
// which is null when the login email doesn't match — so we authorise by
// auth_user_id and write with the service-role client instead (same pattern as
// redeemMyReward). The caller can only ever touch their own client's row.
async function myClientId(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await admin.from("clients").select("id").eq("auth_user_id", userId).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export const getMyReminder = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const clientId = await myClientId(db, context.userId);
    if (!clientId) return { reminder: null };
    const { data } = await db.from("checkin_reminders").select("*").eq("client_id", clientId).maybeSingle();
    return { reminder: data ?? null };
  });

export const upsertMyReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof ReminderSchema>) => ReminderSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const clientId = await myClientId(db, context.userId);
    if (!clientId) return { ok: false as const, reason: "no_client" as const };

    const { error } = await db.from("checkin_reminders").upsert(
      {
        client_id: clientId,
        enabled: data.enabled,
        frequency: data.frequency,
        time_of_day: data.time_of_day,
        days_of_week: data.days_of_week,
        timezone: data.timezone,
      },
      { onConflict: "client_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const disableMyReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const clientId = await myClientId(db, context.userId);
    if (!clientId) return { ok: false as const };
    await db.from("checkin_reminders").update({ enabled: false }).eq("client_id", clientId);
    return { ok: true as const };
  });
