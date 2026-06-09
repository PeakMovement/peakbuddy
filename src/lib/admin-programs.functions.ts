import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ProgramSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  external_url: z.string().url().max(500),
  image_url: z.string().url().max(500).optional().nullable(),
  symptom_tags: z.array(z.string().min(1).max(50)).max(20).default([]),
  pain_min: z.number().int().min(0).max(10).nullable().optional(),
  pain_max: z.number().int().min(0).max(10).nullable().optional(),
  active: z.boolean().default(true),
  priority: z.number().int().min(0).max(100).default(0),
});

async function assertSuperAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (!data || data.role !== "super_admin") {
    throw new Error("Forbidden");
  }
}

export const listAllPrograms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("programs")
      .select("*")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  });

export const upsertProgram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProgramSchema.parse(input))
  .handler(async ({ context, data }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const payload = {
      name: data.name,
      description: data.description,
      external_url: data.external_url,
      image_url: data.image_url || null,
      symptom_tags: data.symptom_tags,
      pain_min: data.pain_min ?? null,
      pain_max: data.pain_max ?? null,
      active: data.active,
      priority: data.priority,
    };
    if (data.id) {
      const { data: row, error } = await supabaseAdmin
        .from("programs")
        .update(payload)
        .eq("id", data.id)
        .select()
        .maybeSingle();
      if (error) throw new Error(error.message);
      return row;
    }
    const { data: row, error } = await supabaseAdmin
      .from("programs")
      .insert(payload)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteProgram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("programs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
