import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { summariseEvents, type ConvoEvent } from "@/lib/whatsapp/convo-analytics";
import { normaliseTone } from "@/lib/whatsapp/personality";

/**
 * Owner dashboard reads for tone, memory, pause, and conversation counts.
 * Counts are codes. Patient words are not returned from the event table.
 */
export const getConversationAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, value: unknown) => {
            limit: (n: number) => Promise<{ data: unknown; error: { message?: string } | null }>;
          };
          in: (col: string, values: string[]) => {
            order: (col: string, opts?: unknown) => {
              limit: (n: number) => Promise<{ data: unknown; error: { message?: string } | null }>;
            };
            limit: (n: number) => Promise<{ data: unknown; error: { message?: string } | null }>;
          };
        };
      };
    };
    const { data: practices } = await admin
      .from("practices")
      .select("id")
      .eq("practitioner_id", context.userId)
      .limit(5);
    const practiceIds = ((practices ?? []) as Array<{ id: string }>).map((p) => p.id);
    if (!practiceIds.length) return { ok: true as const, stats: summariseEvents([]) };
    const { data: clients } = await admin
      .from("clients")
      .select("id")
      .in("practice_id", practiceIds)
      .limit(500);
    const ids = ((clients ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (!ids.length) return { ok: true as const, stats: summariseEvents([]) };
    const { data, error } = await admin
      .from("conversation_events")
      .select("kind, detail")
      .in("client_id", ids)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) return { ok: true as const, stats: summariseEvents([]) };
    const events: ConvoEvent[] = [];
    for (const row of (data ?? []) as Array<{ kind?: string; detail?: string | null }>) {
      const kind = row.kind;
      if (
        kind === "understood" ||
        kind === "fallback" ||
        kind === "saved" ||
        kind === "deferred" ||
        kind === "dropoff"
      ) {
        events.push({ kind, detail: row.detail ?? null });
      }
    }
    return { ok: true as const, stats: summariseEvents(events) };
  });

export const listPatientMemory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ clientId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { canAccessClient } = await import("@/lib/practice-members.functions");
    const access = await canAccessClient(supabaseAdmin, context.userId, data.clientId);
    if (!access.allowed) return { ok: false as const, reason: "denied" as const, facts: [] as string[] };
    const admin = supabaseAdmin as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, value: unknown) => {
            is: (col: string, value: unknown) => {
              order: (col: string, opts?: unknown) => {
                limit: (n: number) => Promise<{ data: unknown; error: { message?: string } | null }>;
              };
            };
            limit: (n: number) => Promise<{ data: unknown }>;
          };
        };
      };
    };
    const { data: rows, error } = await admin
      .from("patient_memory")
      .select("id, fact")
      .eq("client_id", data.clientId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) return { ok: true as const, facts: [] as Array<{ id: string; fact: string }>, paused: false };
    const { data: convs } = await admin
      .from("whatsapp_conversations")
      .select("draft, buddy_paused_at")
      .eq("client_id", data.clientId)
      .limit(1);
    const conv = ((convs ?? []) as Array<{ draft?: { buddyPaused?: unknown }; buddy_paused_at?: string | null }>)[0];
    const paused = Boolean(conv?.draft?.buddyPaused || conv?.buddy_paused_at);
    return {
      ok: true as const,
      facts: ((rows ?? []) as Array<{ id: string; fact: string }>).map((r) => ({
        id: r.id,
        fact: String(r.fact ?? "").slice(0, 200),
      })),
      paused,
    };
  });

export const forgetPatientMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ clientId: z.string().uuid(), memoryId: z.string().uuid().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { canAccessClient } = await import("@/lib/practice-members.functions");
    const access = await canAccessClient(supabaseAdmin, context.userId, data.clientId);
    if (!access.allowed) return { ok: false as const, reason: "denied" as const };
    const admin = supabaseAdmin as unknown as {
      from: (table: string) => {
        update: (row: unknown) => {
          eq: (col: string, value: unknown) => {
            is: (col: string, value: unknown) => Promise<{ error: { message?: string } | null }>;
            eq: (col: string, value: unknown) => {
              is: (col: string, value: unknown) => Promise<{ error: { message?: string } | null }>;
            };
          };
        };
      };
    };
    const now = new Date().toISOString();
    const query = admin.from("patient_memory").update({ archived_at: now }).eq("client_id", data.clientId);
    const result = data.memoryId
      ? await query.eq("id", data.memoryId).is("archived_at", null)
      : await query.is("archived_at", null);
    if (result.error) return { ok: false as const, reason: "save" as const };
    return { ok: true as const };
  });

export const setBuddyPaused = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ clientId: z.string().uuid(), paused: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { canAccessClient } = await import("@/lib/practice-members.functions");
    const access = await canAccessClient(supabaseAdmin, context.userId, data.clientId);
    if (!access.allowed) return { ok: false as const, reason: "denied" as const };
    const admin = supabaseAdmin as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, value: unknown) => {
            limit: (n: number) => Promise<{ data: unknown; error: { message?: string } | null }>;
          };
        };
        update: (row: unknown) => {
          eq: (col: string, value: unknown) => Promise<{ error: { message?: string } | null }>;
        };
      };
    };
    const { data: convs, error } = await admin
      .from("whatsapp_conversations")
      .select("id, draft")
      .eq("client_id", data.clientId)
      .limit(1);
    if (error) return { ok: false as const, reason: "missing" as const };
    const row = ((convs ?? []) as Array<{ id: string; draft: Record<string, unknown> | null }>)[0];
    if (!row?.id) return { ok: false as const, reason: "missing" as const };
    const draft = { ...(row.draft ?? {}) };
    if (data.paused) draft.buddyPaused = { at: new Date().toISOString(), told: false };
    else delete draft.buddyPaused;
    const saved = await admin.from("whatsapp_conversations").update({ draft }).eq("id", row.id);
    if (saved.error) return { ok: false as const, reason: "save" as const };
    await admin
      .from("whatsapp_conversations")
      .update(
        data.paused
          ? { buddy_paused_at: new Date().toISOString(), buddy_paused_by: context.userId }
          : { buddy_paused_at: null, buddy_paused_by: null },
      )
      .eq("id", row.id);
    return { ok: true as const, paused: data.paused, tone: normaliseTone("warm") };
  });
