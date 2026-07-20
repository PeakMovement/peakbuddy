import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildLoadInsight, type LoadInsight, type WearableDay, type CheckInDay } from "@/lib/load-metrics";
import { buildCorrelation, type CorrelationResult } from "@/lib/symptom-correlation";
import { buildRhythms, type RhythmPatterns } from "@/lib/rhythm-patterns";

// ── Super-admin gate ────────────────────────────────────────────────────────
async function assertSuperAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (!data || data.role !== "super_admin") throw new Error("Forbidden");
}

// ── Types returned to the client ────────────────────────────────────────────
export type AdminClientListItem = {
  id: string;
  full_name: string;
  email: string | null;
  practitioner_id: string;
  practitioner_name: string | null;
  primary_complaint: string | null;
  created_at: string;
};

export type WearableConnection = {
  provider: string;
  status: string;
  provider_user_id: string | null;
  connected: boolean;
  expires_at: string | null;
  updated_at: string;
};

export type AdminClientBundle = {
  client: {
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    primary_complaint: string | null;
    notes: string | null;
    check_in_frequency: string;
    timezone: string;
    created_at: string;
    first_login_at: string | null;
    yves_enabled: boolean;
    yves_ai_consent: boolean;
    passive_monitoring_enabled: boolean;
    program_status: string;
    practitioner_id: string;
    practitioner_name: string | null;
  };
  wearables: WearableConnection[];
  wearableSessions: Record<string, any>[];
  checkIns: Record<string, any>[];
  symptomQueries: Record<string, any>[];
  alerts: Record<string, any>[];
  riskScores: Record<string, any>[];
  baseline: Record<string, any> | null;
  patterns: Record<string, any>[];

  loadInsight: LoadInsight;
  correlation: CorrelationResult;
  rhythms: RhythmPatterns;
  insightHistory: { date: string; acwr: number | null; fatigue: number | null; risk: string | null }[];
};

// ── List every client (for the dropdown) ────────────────────────────────────
export const listAllClientsForAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminClientListItem[]> => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;

    const { data: clients, error } = await db
      .from("clients")
      .select("id, full_name, email, practitioner_id, primary_complaint, created_at")
      .order("full_name", { ascending: true });
    if (error) throw new Error(error.message);

    const pracIds = Array.from(new Set((clients ?? []).map((c) => c.practitioner_id).filter(Boolean)));
    const nameById = new Map<string, string>();
    if (pracIds.length) {
      const { data: profs } = await db
        .from("profiles")
        .select("id, full_name")
        .in("id", pracIds);
      for (const p of profs ?? []) nameById.set(p.id as string, (p.full_name as string) ?? "");
    }

    return (clients ?? []).map((c) => ({
      id: c.id as string,
      full_name: (c.full_name as string) ?? "Unnamed client",
      email: (c.email as string | null) ?? null,
      practitioner_id: c.practitioner_id as string,
      practitioner_name: nameById.get(c.practitioner_id as string) ?? null,
      primary_complaint: (c.primary_complaint as string | null) ?? null,
      created_at: c.created_at as string,
    }));
  });

// ── Full data bundle for one client ─────────────────────────────────────────
export const getAdminClientBundle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ clientId: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }): Promise<AdminClientBundle> => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const id = data.clientId;

    const { data: client, error: cErr } = await db.from("clients").select("*").eq("id", id).maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!client) throw new Error("Client not found");

    const [
      { data: prof },
      { data: tokens },
      { data: sessions },
      { data: checkIns },
      { data: queries },
      { data: alerts },
      { data: risk },
      { data: baseline },
      { data: patterns },
    ] = await Promise.all([
      db.from("profiles").select("full_name").eq("id", client.practitioner_id).maybeSingle(),
      // Never expose access/refresh tokens — connection metadata only.
      db.from("wearable_tokens").select("provider, status, provider_user_id, expires_at, updated_at").eq("client_id", id),
      db.from("wearable_sessions").select("*").eq("client_id", id).order("date", { ascending: false }).limit(60),
      db.from("check_ins").select("*").eq("client_id", id).order("created_at", { ascending: false }).limit(90),
      db.from("symptom_queries").select("*").eq("client_id", id).order("created_at", { ascending: false }).limit(50),
      db.from("alerts").select("*").eq("client_id", id).order("created_at", { ascending: false }).limit(50),
      db.from("risk_scores").select("*").eq("client_id", id).order("score_date", { ascending: false }).limit(60),
      db.from("client_baselines").select("*").eq("client_id", id).maybeSingle(),
      db.from("client_patterns").select("*").eq("client_id", id).eq("active", true).order("confidence", { ascending: false }),
    ]);

    const wearables: WearableConnection[] = (tokens ?? []).map((t) => ({
      provider: t.provider as string,
      status: (t.status as string) ?? "unknown",
      provider_user_id: (t.provider_user_id as string | null) ?? null,
      connected: (t.status as string) === "connected" || (t.status as string) === "active",
      expires_at: (t.expires_at as string | null) ?? null,
      updated_at: t.updated_at as string,
    }));

    const hasWearableConnected = wearables.some((w) => w.connected);
    const wearDays = (sessions ?? []) as unknown as WearableDay[];
    const checkDays = (checkIns ?? []) as unknown as CheckInDay[];
    const { data: psRow } = await db.from("platform_settings").select("detection_thresholds").limit(1).maybeSingle();
    const thresholds = (psRow as { detection_thresholds?: unknown } | null)?.detection_thresholds ?? null;
    const loadInsight = buildLoadInsight(wearDays, checkDays, hasWearableConnected, thresholds as never);
    const correlation = buildCorrelation(wearDays, checkDays, hasWearableConnected);
    const rhythms = buildRhythms(wearDays);

    // Persist today's snapshot + read recent history (best-effort — table may
    // not exist until the migration syncs).
    let insightHistory: AdminClientBundle["insightHistory"] = [];
    try {
      const today = new Date().toISOString().slice(0, 10);
      await db.from("client_insight_snapshots").upsert(
        { client_id: id, snapshot_date: today, load: loadInsight, correlation, rhythms },
        { onConflict: "client_id,snapshot_date" },
      );
      const { data: snaps } = await db.from("client_insight_snapshots")
        .select("snapshot_date, load").eq("client_id", id).order("snapshot_date", { ascending: true }).limit(60);
      insightHistory = ((snaps ?? []) as { snapshot_date: string; load: unknown }[]).map((r) => {
        const L = (r.load ?? {}) as { metrics?: { acwr?: number | null; fatigueIndex?: number | null }; drivers?: { riskLevel?: string } };
        return { date: r.snapshot_date, acwr: L.metrics?.acwr ?? null, fatigue: L.metrics?.fatigueIndex ?? null, risk: L.drivers?.riskLevel ?? null };
      });
    } catch { /* snapshots unavailable yet */ }

    return {
      client: {
        id: client.id,
        full_name: client.full_name,
        email: client.email ?? null,
        phone: client.phone ?? null,
        primary_complaint: client.primary_complaint ?? null,
        notes: client.notes ?? null,
        check_in_frequency: client.check_in_frequency,
        timezone: client.timezone,
        created_at: client.created_at,
        first_login_at: client.first_login_at ?? null,
        yves_enabled: client.yves_enabled,
        yves_ai_consent: client.yves_ai_consent,
        passive_monitoring_enabled: client.passive_monitoring_enabled,
        program_status: client.program_status,
        practitioner_id: client.practitioner_id,
        practitioner_name: (prof?.full_name as string | null) ?? null,
      },
      wearables,
      wearableSessions: (sessions ?? []) as Record<string, unknown>[],
      checkIns: (checkIns ?? []) as Record<string, unknown>[],
      symptomQueries: (queries ?? []) as Record<string, unknown>[],
      alerts: (alerts ?? []) as Record<string, unknown>[],
      riskScores: (risk ?? []) as Record<string, unknown>[],
      baseline: (baseline as Record<string, unknown> | null) ?? null,
      patterns: (patterns ?? []) as Record<string, unknown>[],
      loadInsight,
      correlation,
      rhythms,
      insightHistory,
    };
  });
