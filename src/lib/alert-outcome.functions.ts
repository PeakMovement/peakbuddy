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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: alert } = await supabaseAdmin
      .from("alerts")
      .select("id, client_id, practitioner_id")
      .eq("id", data.alertId)
      .maybeSingle();

    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", context.userId)
      .maybeSingle();
    if (prof?.role === "super_admin") {
      const { error } = await supabaseAdmin.from("alerts").update(patch).eq("id", data.alertId);
      if (error) throw error;
      return { ok: true };
    }

    const clientId = (alert as { client_id?: string } | null)?.client_id;
    if (!clientId) throw new Error("Alert not found");
    const { canAccessClient } = await import("@/lib/practice-members.functions");
    const access = await canAccessClient(supabaseAdmin, context.userId, clientId);
    if (!access.allowed) throw new Error("Not authorized");
    const { error } = await supabaseAdmin.from("alerts").update(patch).eq("id", data.alertId);
    if (error) throw error;
    return { ok: true };
  });

export const getYvesAccuracy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ confirmed: number; false_alarm: number; already_aware: number }> => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { listAccessibleClientIds } = await import("@/lib/practice-members.functions");
      const ids = await listAccessibleClientIds(supabaseAdmin, context.userId);
      if (ids.length === 0) return { confirmed: 0, false_alarm: 0, already_aware: 0 };
      const { data, error } = await supabaseAdmin
        .from("alerts")
        .select("outcome")
        .in("client_id", ids)
        .not("outcome", "is", null);
      if (error) throw error;
      const counts = { confirmed: 0, false_alarm: 0, already_aware: 0 };
      ((data ?? []) as { outcome: AlertOutcome }[]).forEach((r) => {
        if (r.outcome in counts) counts[r.outcome] += 1;
      });
      return counts;
    },
  );
