import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PractitionerDraft = {
  id: string;
  client_id: string;
  client_name: string;
  kind: "risk_flare" | "pattern_insight";
  draft_title: string;
  draft_body: string;
  suggested_action: { program_id?: string; program_name?: string; reason?: string } | null;
  status: "new" | "sent" | "dismissed" | "edited";
  risk_score: number | null;
  created_at: string;
};

export const listMyDrafts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PractitionerDraft[]> => {
    const { data, error } = await context.supabase
      .from("practitioner_drafts")
      .select(
        "id, client_id, kind, draft_title, draft_body, suggested_action, status, created_at, clients(full_name), risk_scores(risk_score)",
      )
      .eq("status", "new")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    type Row = {
      id: string;
      client_id: string;
      kind: "risk_flare" | "pattern_insight";
      draft_title: string;
      draft_body: string;
      suggested_action: { program_id?: string; program_name?: string; reason?: string } | null;
      status: "new" | "sent" | "dismissed" | "edited";
      created_at: string;
      clients: { full_name: string } | null;
      risk_scores: { risk_score: number } | null;
    };
    return ((data ?? []) as unknown as Row[]).map((r) => ({
      id: r.id,
      client_id: r.client_id,
      client_name: r.clients?.full_name ?? "Unknown",
      kind: r.kind,
      draft_title: r.draft_title,
      draft_body: r.draft_body,
      suggested_action: r.suggested_action,
      status: r.status,
      risk_score: r.risk_scores?.risk_score ?? null,
      created_at: r.created_at,
    }));
  });

export const countMyDrafts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<number> => {
    const { count } = await context.supabase
      .from("practitioner_drafts")
      .select("*", { count: "exact", head: true })
      .eq("status", "new");
    return count ?? 0;
  });

export const updateDraftStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status: "sent" | "dismissed" | "edited"; body?: string }) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["sent", "dismissed", "edited"]),
        body: z.string().max(4000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: {
      status: "sent" | "dismissed" | "edited";
      acted_at: string;
      draft_body?: string;
    } = {
      status: data.status,
      acted_at: new Date().toISOString(),
    };
    if (data.body !== undefined) patch.draft_body = data.body;
    const { error } = await context.supabase
      .from("practitioner_drafts")
      .update(patch)
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
