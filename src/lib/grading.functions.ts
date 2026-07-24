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
    if (rows.length === 0) return [];
    const clientIds = Array.from(new Set(rows.map((r) => r.client_id)));
    const practIds = Array.from(new Set(rows.map((r) => r.practitioner_id)));

    const [{ data: clients }, { data: profs }, { data: practices }] = await Promise.all([
      supabaseAdmin.from("clients").select("id, full_name").in("id", clientIds),
      supabaseAdmin.from("profiles").select("id, full_name").in("id", practIds),
      supabaseAdmin.from("practices").select("practitioner_id, practice_name").in("practitioner_id", practIds),
    ]);

    const cMap = new Map((clients ?? []).map((c) => [c.id, c]));
    const pMap = new Map((profs ?? []).map((p) => [p.id, p]));
    const prMap = new Map((practices ?? []).map((p) => [p.practitioner_id, p]));

    return rows.map((r) => {
      const c = cMap.get(r.client_id);
      const firstName = (c?.full_name || "Unknown").trim().split(/\s+/)[0];
      const prof = pMap.get(r.practitioner_id);
      const practice = prMap.get(r.practitioner_id);
      return {
        id: r.id,
        message: r.message ?? "",
        urgency: r.urgency,
        created_at: r.created_at,
        client_first_name: firstName,
        practice_name: practice?.practice_name ?? "Unassigned",
        practitioner_name: prof?.full_name ?? "Unknown",
      };
    });
  });

// ============================================================================
// Insight grading (client_insight_logs) — ties into Yves memory version.
// ============================================================================

export type InsightGradingRow = {
  id: string;
  created_at: string;
  client_id: string;
  client_first_name: string;
  focus: string | null;
  model: string | null;
  memory_version: number | null;
  response_preview: string;
  response_full: string;
};

export const listYvesMemoryVersionsForFilter = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Array<{ version: number; note: string | null; created_at: string }>> => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("yves_memory_versions")
      .select("version_number, note, created_at")
      .order("version_number", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      version: r.version_number as number,
      note: (r.note as string | null) ?? null,
      created_at: r.created_at as string,
    }));
  });

export const getInsightGradingQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { memoryVersion?: number | null }) =>
    z.object({ memoryVersion: z.number().int().nullable().optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }): Promise<InsightGradingRow[]> => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("client_insight_logs")
      .select("id, client_id, focus, model, memory_version, response, created_at, grade")
      .is("grade", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.memoryVersion != null) q = q.eq("memory_version", data.memoryVersion);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const list = rows ?? [];
    if (list.length === 0) return [];
    const clientIds = Array.from(new Set(list.map((r) => r.client_id as string)));
    const { data: clients } = await supabaseAdmin
      .from("clients").select("id, full_name").in("id", clientIds);
    const cMap = new Map((clients ?? []).map((c) => [c.id as string, c.full_name as string | null]));
    return list.map((r) => {
      const full = (r.response as string | null) ?? "";
      const name = (cMap.get(r.client_id as string) || "Unknown").trim().split(/\s+/)[0];
      return {
        id: r.id as string,
        created_at: r.created_at as string,
        client_id: r.client_id as string,
        client_first_name: name,
        focus: (r.focus as string | null) ?? null,
        model: (r.model as string | null) ?? null,
        memory_version: (r.memory_version as number | null) ?? null,
        response_preview: full.slice(0, 320),
        response_full: full,
      };
    });
  });

export const setInsightGrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { insightId: string; grade: "good" | "poor"; note?: string }) =>
    z.object({
      insightId: z.string().uuid(),
      grade: z.enum(["good", "poor"]),
      note: z.string().max(400).optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("client_insight_logs")
      .update({
        grade: data.grade,
        grade_note: data.note ?? null,
        graded_by: context.userId,
        graded_at: new Date().toISOString(),
      })
      .eq("id", data.insightId)
      .is("grade", null); // write-once: don't silently overwrite an existing grade
    if (error) throw new Error(error.message);
    return { ok: true };
  });

