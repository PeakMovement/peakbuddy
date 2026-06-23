import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type GradingMode = "super_admin_only" | "practitioner" | "sampled";

async function assertSuperAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (!data || data.role !== "super_admin") throw new Error("Forbidden");
}

export const getGradingMode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ mode: GradingMode; sample_rate: number }> => {
    const { data, error } = await context.supabase
      .from("grading_settings")
      .select("mode, sample_rate")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw error;
    return {
      mode: (data?.mode as GradingMode) ?? "super_admin_only",
      sample_rate: Number(data?.sample_rate ?? 0.2),
    };
  });

export const setGradingMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { mode: GradingMode }) =>
    z
      .object({ mode: z.enum(["super_admin_only", "practitioner", "sampled"]) })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("grading_settings")
      .update({ mode: data.mode, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type AdminQueueRow = {
  id: string;
  message: string;
  urgency: string;
  created_at: string;
  client_first_name: string;
  practice_name: string;
  practitioner_name: string;
};

export const getAdminGradingQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminQueueRow[]> => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: alerts, error } = await supabaseAdmin
      .from("alerts")
      .select("id, message, urgency, created_at, client_id, practitioner_id")
      .is("outcome", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const rows = alerts ?? [];
    const clientIds = Array.from(new Set(rows.map((r) => r.client_id)));
    const practIds = Array.from(new Set(rows.map((r) => r.practitioner_id)));

    const [{ data: clients }, { data: profs }] = await Promise.all([
      supabaseAdmin.from("clients").select("id, full_name, practice_id").in("id", clientIds),
      supabaseAdmin.from("profiles").select("id, full_name").in("id", practIds),
    ]);
    const practiceIds = Array.from(
      new Set((clients ?? []).map((c) => c.practice_id).filter(Boolean) as string[]),
    );
    const { data: practices } = practiceIds.length
      ? await supabaseAdmin.from("practices").select("id, name").in("id", practiceIds)
      : { data: [] as { id: string; name: string }[] };

    const cMap = new Map((clients ?? []).map((c) => [c.id, c]));
    const pMap = new Map((profs ?? []).map((p) => [p.id, p]));
    const prMap = new Map((practices ?? []).map((p) => [p.id, p]));

    return rows.map((r) => {
      const c = cMap.get(r.client_id);
      const firstName = (c?.full_name || "Unknown").trim().split(/\s+/)[0];
      const practice = c?.practice_id ? prMap.get(c.practice_id) : null;
      const prof = pMap.get(r.practitioner_id);
      return {
        id: r.id,
        message: r.message,
        urgency: r.urgency,
        created_at: r.created_at,
        client_first_name: firstName,
        practice_name: practice?.name ?? "Unassigned",
        practitioner_name: prof?.full_name ?? "Unknown",
      };
    });
  });
