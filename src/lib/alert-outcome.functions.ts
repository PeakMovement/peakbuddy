import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AlertOutcome = "confirmed" | "false_alarm" | "already_aware";

export const setAlertOutcome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { alertId: string; outcome: AlertOutcome | null }) =>
    z
      .object({
        alertId: z.string().uuid(),
        outcome: z.enum(["confirmed", "false_alarm", "already_aware"]).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch = {
      outcome: data.outcome,
      outcome_at: data.outcome ? new Date().toISOString() : null,
      outcome_by: data.outcome ? context.userId : null,
    };
    const { error } = await context.supabase
      .from("alerts")
      .update(patch)
      .eq("id", data.alertId)
      .eq("practitioner_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const getYvesAccuracy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ confirmed: number; false_alarm: number; already_aware: number }> => {
      const { data, error } = await context.supabase
        .from("alerts")
        .select("outcome")
        .eq("practitioner_id", context.userId)
        .not("outcome", "is", null);
      if (error) throw error;
      const counts = { confirmed: 0, false_alarm: 0, already_aware: 0 };
      ((data ?? []) as { outcome: AlertOutcome }[]).forEach((r) => {
        if (r.outcome in counts) counts[r.outcome] += 1;
      });
      return counts;
    },
  );
