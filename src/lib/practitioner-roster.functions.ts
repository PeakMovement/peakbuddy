import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  canAccessClient,
  listAccessibleClientIds,
  listAccessibleClients,
} from "@/lib/practice-members.functions";

export const getPractitionerRoster = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const clients = await listAccessibleClients(supabaseAdmin, context.userId);
    const ids = clients.map((c) => c.id);
    if (ids.length === 0) {
      return { clients: [], checkIns: [], unreadAlerts: 0 };
    }
    const [{ data: checkIns }, { count }] = await Promise.all([
      supabaseAdmin
        .from("check_ins")
        .select("*")
        .in("client_id", ids)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("alerts")
        .select("*", { count: "exact", head: true })
        .in("client_id", ids)
        .eq("is_read", false),
    ]);
    return {
      clients,
      checkIns: checkIns ?? [],
      unreadAlerts: count ?? 0,
    };
  });

export const getUnreadPracticeAlertCount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ids = await listAccessibleClientIds(supabaseAdmin, context.userId);
    if (ids.length === 0) return { count: 0 };
    const { count } = await supabaseAdmin
      .from("alerts")
      .select("*", { count: "exact", head: true })
      .in("client_id", ids)
      .eq("is_read", false);
    return { count: count ?? 0 };
  });

export const getPractitionerAlertFeed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const clients = await listAccessibleClients(supabaseAdmin, context.userId);
    const ids = clients.map((c) => c.id);
    if (ids.length === 0) return { alerts: [], clients: [] };
    const { data: alerts } = await supabaseAdmin
      .from("alerts")
      .select("*")
      .in("client_id", ids)
      .order("created_at", { ascending: false });
    return { alerts: alerts ?? [], clients };
  });

const patchSchema = z
  .object({
    alertId: z.string().uuid(),
    is_read: z.boolean().optional(),
    practitioner_assessment: z.enum(["correct", "over", "under"]).nullable().optional(),
  })
  .refine((d) => d.is_read !== undefined || d.practitioner_assessment !== undefined, {
    message: "No alert fields to update",
  });

export const patchPractitionerAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => patchSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: alert } = await supabaseAdmin
      .from("alerts")
      .select("id, client_id")
      .eq("id", data.alertId)
      .maybeSingle();
    if (!alert?.client_id) return { ok: false as const, error: "Alert not found" };
    const access = await canAccessClient(supabaseAdmin, context.userId, alert.client_id as string);
    if (!access.allowed) return { ok: false as const, error: "Not authorized" };
    const patch: {
      is_read?: boolean;
      practitioner_assessment?: "correct" | "over" | "under" | null;
    } = {};
    if (data.is_read !== undefined) patch.is_read = data.is_read;
    if (data.practitioner_assessment !== undefined) {
      patch.practitioner_assessment = data.practitioner_assessment;
    }
    const { error } = await supabaseAdmin.from("alerts").update(patch).eq("id", data.alertId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
