import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type MorningAnalysisItem = {
  id: string;
  client_id: string;
  client_name: string;
  kind: "risk_flare" | "pattern_insight";
  draft_title: string;
  draft_body: string;
  risk_score: number | null;
  suggested_program: string | null;
  created_at: string;
};

export type MorningAnalysisPayload = {
  enabled: boolean;
  client_count: number;
  items: MorningAnalysisItem[];
  generated_for: string; // ISO date (today)
};

export const getMorningAnalysis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MorningAnalysisPayload> => {
    const { supabase, userId } = context;

    const [{ data: prof }, { count: clientCount }] = await Promise.all([
      supabase
        .from("profiles")
        .select("morning_analysis_enabled")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("clients")
        .select("*", { count: "exact", head: true })
        .eq("practitioner_id", userId),
    ]);

    const enabled = prof?.morning_analysis_enabled ?? true;
    const client_count = clientCount ?? 0;
    const today = new Date();
    const startOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    ).toISOString();

    if (!enabled || client_count === 0) {
      return { enabled, client_count, items: [], generated_for: startOfDay };
    }

    const { data, error } = await supabase
      .from("practitioner_drafts")
      .select(
        "id, client_id, kind, draft_title, draft_body, suggested_action, status, created_at, clients(full_name), risk_scores(risk_score)",
      )
      .eq("status", "new")
      .gte("created_at", startOfDay)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    type Row = {
      id: string;
      client_id: string;
      kind: "risk_flare" | "pattern_insight";
      draft_title: string;
      draft_body: string;
      suggested_action: { program_name?: string } | null;
      created_at: string;
      clients: { full_name: string } | null;
      risk_scores: { risk_score: number } | null;
    };

    const items: MorningAnalysisItem[] = ((data ?? []) as unknown as Row[]).map(
      (r) => ({
        id: r.id,
        client_id: r.client_id,
        client_name: r.clients?.full_name ?? "Unknown",
        kind: r.kind,
        draft_title: r.draft_title,
        draft_body: r.draft_body,
        risk_score: r.risk_scores?.risk_score ?? null,
        suggested_program: r.suggested_action?.program_name ?? null,
        created_at: r.created_at,
      }),
    );

    return { enabled, client_count, items, generated_for: startOfDay };
  });

export const setMorningAnalysisEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { enabled: boolean }) =>
    z.object({ enabled: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ morning_analysis_enabled: data.enabled })
      .eq("id", context.userId);
    if (error) throw error;
    return { ok: true };
  });
