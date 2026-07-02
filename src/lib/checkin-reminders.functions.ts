import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FREQUENCIES = ["daily", "morning", "evening", "custom"] as const;

const ReminderSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(FREQUENCIES),
  time_of_day: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  days_of_week: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  timezone: z.string().min(1).max(64),
});

export const getMyReminder = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: client } = await context.supabase
      .from("clients")
      .select("id")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!client) return { reminder: null };
    const { data } = await context.supabase
      .from("checkin_reminders")
      .select("*")
      .eq("client_id", client.id)
      .maybeSingle();
    return { reminder: data ?? null };
  });

export const upsertMyReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof ReminderSchema>) => ReminderSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: client } = await context.supabase
      .from("clients")
      .select("id")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!client) return { ok: false as const, reason: "no_client" as const };

    const { error } = await context.supabase
      .from("checkin_reminders")
      .upsert(
        {
          client_id: client.id,
          enabled: data.enabled,
          frequency: data.frequency,
          time_of_day: data.time_of_day,
          days_of_week: data.days_of_week,
          timezone: data.timezone,
        },
        { onConflict: "client_id" },
      );
    if (error) throw error;
    return { ok: true as const };
  });

export const disableMyReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: client } = await context.supabase
      .from("clients")
      .select("id")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!client) return { ok: false as const };
    await context.supabase
      .from("checkin_reminders")
      .update({ enabled: false })
      .eq("client_id", client.id);
    return { ok: true as const };
  });
