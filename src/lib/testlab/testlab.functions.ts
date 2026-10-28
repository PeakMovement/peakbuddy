/**
 * Test Lab server functions. Super admin only.
 *
 * The lab's state travels with each request (the page keeps it), so there
 * is nothing to clean up and two tabs never share a sandbox. Verdicts are
 * saved to testlab_feedback so Claude can read them back later.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

async function assertSuperAdmin(ctx: { supabase: SupabaseClient<Database>; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("is_super_admin", { _uid: ctx.userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

const MAX_STATE_CHARS = 3_000_000;

const stateSchema = z
  .object({
    version: z.literal(1),
    createdAt: z.string(),
    clockOffsetMs: z.number(),
    tables: z.record(z.array(z.record(z.any()))),
    users: z.array(z.record(z.any())),
    transcript: z.array(z.record(z.any())),
  })
  .refine((s) => JSON.stringify(s).length < MAX_STATE_CHARS, "Test Lab state is too large");

export const labStart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context);
    const { newLab, labSnapshot } = await import("./engine.server");
    const { LAB_PEOPLE } = await import("./seed");
    const state = newLab();
    return { state, people: LAB_PEOPLE, snapshot: labSnapshot(state) };
  });

const actInput = z.object({
  state: stateSchema,
  action: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("send"),
      from: z.string().max(40),
      text: z.string().max(4000).optional(),
      replyId: z.string().max(200).nullable().optional(),
      replyTitle: z.string().max(200).nullable().optional(),
    }),
    z.object({
      kind: z.literal("advance"),
      jump: z.enum(["1h", "2h", "reminder", "morning", "evening", "1d", "7d"]),
    }),
  ]),
});

export const labAct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => actInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { labSend, labAdvance, labSnapshot } = await import("./engine.server");
    const state = data.state as never;
    const r =
      data.action.kind === "send"
        ? await labSend(state, {
            from: data.action.from,
            text: data.action.text,
            replyId: data.action.replyId ?? null,
            replyTitle: data.action.replyTitle ?? null,
          })
        : await labAdvance(state, data.action.jump);
    return { state: r.state, lines: r.lines, snapshot: labSnapshot(r.state) };
  });

export const labScenarios = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context);
    const { SCENARIOS } = await import("./scenarios");
    return SCENARIOS.map((s) => ({
      id: s.id,
      area: s.area,
      title: s.title,
      why: s.why,
      feature: s.feature ?? null,
      checks: s.checks.map((c) => c.label),
    }));
  });

export const labRunScenarios = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ ids: z.array(z.string().max(80)).max(50) }).parse(i))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { runScenarios } = await import("./runner.server");
    return runScenarios(data.ids);
  });

const feedbackInput = z.object({
  scenarioId: z.string().max(80).nullable(),
  verdict: z.enum(["right", "wrong", "note"]),
  note: z.string().max(2000).nullable(),
  transcript: z.array(z.record(z.any())).max(400),
});

export const labSaveFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => feedbackInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const loose = supabaseAdmin as unknown as { from: (t: string) => any };
    const { error } = await loose.from("testlab_feedback").insert({
      actor_id: context.userId,
      scenario_id: data.scenarioId,
      verdict: data.verdict,
      note: data.note,
      transcript: data.transcript,
    });
    if (error)
      return { ok: false as const, error: "Could not save. Has migration 0046 been applied?" };
    return { ok: true as const };
  });

export const labListFeedback = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const loose = supabaseAdmin as unknown as { from: (t: string) => any };
    const { data } = await loose
      .from("testlab_feedback")
      .select("id, created_at, scenario_id, verdict, note, resolved_at")
      .order("created_at", { ascending: false })
      .limit(50);
    return (data ?? []) as Array<{
      id: number;
      created_at: string;
      scenario_id: string | null;
      verdict: string;
      note: string | null;
      resolved_at: string | null;
    }>;
  });
