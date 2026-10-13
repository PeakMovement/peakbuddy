import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recoveryComparison, riskBaselineLabel } from "@/lib/capabilities";

interface Chain extends PromiseLike<{ data: unknown; error: { message?: string } | null }> {
  select: (columns?: string) => Chain;
  eq: (column: string, value: unknown) => Chain;
  in: (column: string, value: unknown[]) => Chain;
  order: (column: string, opts?: { ascending: boolean }) => Chain;
  limit: (count: number) => Chain;
  maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }>;
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

export type ClientPanel = {
  risk: { headline: string; detail: string } | null;
  recovery: string | null;
  media: Array<{ id: string; kind: string; caption: string | null; created_at: string }>;
  goal: string | null;
};

/** Practitioner-only extras for the client page. Not used by the patient app. */
export const getClientCapabilityPanel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ClientPanel> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { canAccessClient } = await import("@/lib/practice-members.functions");
    const access = await canAccessClient(supabaseAdmin, context.userId, data.clientId);
    if (!access.allowed) return { risk: null, recovery: null, media: [], goal: null };
    const admin = supabaseAdmin as unknown as { from: (table: string) => Chain };

    const [riskRes, clientRes, mediaRes, checkRes] = await Promise.all([
      admin
        .from("risk_scores")
        .select("score_date, risk_score, trend")
        .eq("client_id", data.clientId)
        .order("score_date", { ascending: false })
        .limit(2),
      admin
        .from("clients")
        .select("goal, primary_complaint, practice_id, created_at")
        .eq("id", data.clientId)
        .maybeSingle(),
      admin
        .from("client_exercise_media")
        .select("id, media_kind, caption, created_at")
        .eq("client_id", data.clientId)
        .order("created_at", { ascending: false })
        .limit(8),
      admin
        .from("check_ins")
        .select("pain_level, created_at")
        .eq("client_id", data.clientId)
        .order("created_at", { ascending: true })
        .limit(30),
    ]);

    const scores = rows<{ risk_score: number; trend: string | null }>(riskRes.data);
    const latest = scores[0];
    const previous = scores[1];
    const risk = latest
      ? riskBaselineLabel({
          score: latest.risk_score,
          previous: previous?.risk_score ?? null,
          trend: latest.trend,
        })
      : null;

    const client = clientRes.data as {
      goal: string | null;
      primary_complaint: string | null;
      practice_id: string | null;
      created_at: string;
    } | null;
    const checks = rows<{ pain_level: number | null; created_at: string }>(checkRes.data);
    const firstPain = checks.find((c) => c.pain_level != null);
    const lastPain = [...checks].reverse().find((c) => c.pain_level != null);
    let recovery: string | null = null;
    if (client?.practice_id && client.primary_complaint && firstPain && lastPain && firstPain !== lastPain) {
      const { data: peers } = await admin
        .from("clients")
        .select("id, primary_complaint, created_at")
        .eq("practice_id", client.practice_id)
        .limit(80);
      const others = ((peers ?? []) as Array<{ id: string; primary_complaint: string | null; created_at: string }>).filter(
        (p) => p.id !== data.clientId,
      );
      const peerIds = others.map((p) => p.id);
      const { data: peerChecks } = peerIds.length
        ? await admin
            .from("check_ins")
            .select("client_id, pain_level, created_at")
            .in("client_id", peerIds)
            .limit(400)
        : { data: [] };
      const grouped = new Map<string, Array<{ pain_level: number | null; created_at: string }>>();
      for (const row of (peerChecks ?? []) as Array<{
        client_id: string;
        pain_level: number | null;
        created_at: string;
      }>) {
        const list = grouped.get(row.client_id) ?? [];
        list.push(row);
        grouped.set(row.client_id, list);
      }
      const days = Math.max(
        1,
        Math.round(
          (new Date(lastPain.created_at).getTime() - new Date(firstPain.created_at).getTime()) /
            86_400_000,
        ),
      );
      const compared = recoveryComparison({
        complaint: client.primary_complaint,
        daysSinceStart: days,
        painDrop: (firstPain.pain_level ?? 0) - (lastPain.pain_level ?? 0),
        peers: others.flatMap((p) => {
          const list = (grouped.get(p.id) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at));
          const a = list.find((c) => c.pain_level != null);
          const b = [...list].reverse().find((c) => c.pain_level != null);
          if (!a || !b || a === b || !p.primary_complaint) return [];
          return [
            {
              complaint: p.primary_complaint,
              days: Math.max(
                1,
                Math.round((new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) / 86_400_000),
              ),
              painDrop: (a.pain_level ?? 0) - (b.pain_level ?? 0),
            },
          ];
        }),
      });
      recovery = compared?.sentence ?? null;
    }

    return {
      risk,
      recovery,
      media: rows<{
        id: string;
        media_kind: string;
        caption: string | null;
        created_at: string;
      }>(mediaRes.data).map((m) => ({
        id: m.id,
        kind: m.media_kind,
        caption: m.caption,
        created_at: m.created_at,
      })),
      goal: client?.goal ?? null,
    };
  });
