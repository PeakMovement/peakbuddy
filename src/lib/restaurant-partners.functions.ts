import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolvePractitionerPracticeId } from "@/lib/practice-members.functions";
import { RESTAURANT_REWARD_PARTNERS } from "@/lib/feature-flags";

export type RestaurantPartner = {
  id: string;
  practice_id: string | null;
  name: string;
  description: string;
  city: string;
  address: string;
  maps_url: string | null;
  active: boolean;
  is_placeholder: boolean;
  created_at: string;
};

const PartnerSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).default(""),
  city: z.string().max(120).default(""),
  address: z.string().max(300).default(""),
  maps_url: z
    .string()
    .max(500)
    .optional()
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null))
    .refine((v) => v === null || /^https?:\/\/\S+$/i.test(v), {
      message: "Enter a full URL starting with http:// or https://, or leave blank.",
    }),
  active: z.boolean().default(true),
  /** Super-admin only: true stores a platform-wide partner (practice_id null). */
  platformWide: z.boolean().optional().default(false),
});

function missingRelation(message: string | undefined): boolean {
  return /schema cache|does not exist|relation .* does not exist/i.test(message ?? "");
}

async function roleOf(
  admin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
  userId: string,
): Promise<"super_admin" | "practitioner" | "client" | null> {
  const { data } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  if (role === "super_admin" || role === "practitioner" || role === "client") return role;
  return null;
}

export const listRestaurantPartners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RestaurantPartner[]> => {
    if (!RESTAURANT_REWARD_PARTNERS) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const role = await roleOf(supabaseAdmin, context.userId);
    if (role !== "super_admin" && role !== "practitioner") throw new Error("Forbidden");

    const { data, error } = await supabaseAdmin
      .from("restaurant_partners")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      if (missingRelation(error.message)) return [];
      throw new Error(error.message);
    }
    const all = (data ?? []) as RestaurantPartner[];
    if (role === "super_admin") return all;

    const ctx = await resolvePractitionerPracticeId(supabaseAdmin, context.userId);
    const practiceId = ctx?.practiceId ?? null;
    // Practitioners see platform-wide partners plus their own practice's.
    return all.filter((p) => p.practice_id == null || p.practice_id === practiceId);
  });

export const upsertRestaurantPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PartnerSchema.parse(input))
  .handler(async ({ context, data }): Promise<RestaurantPartner> => {
    if (!RESTAURANT_REWARD_PARTNERS) throw new Error("Restaurant partners are disabled.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const role = await roleOf(supabaseAdmin, context.userId);
    if (role !== "super_admin" && role !== "practitioner") throw new Error("Forbidden");

    let practiceId: string | null = null;
    if (role === "super_admin" && data.platformWide) {
      practiceId = null;
    } else {
      const ctx = await resolvePractitionerPracticeId(supabaseAdmin, context.userId);
      if (!ctx?.practiceId && role !== "super_admin") {
        throw new Error("Join or create a practice before adding restaurant partners.");
      }
      practiceId = ctx?.practiceId ?? null;
      if (role === "super_admin" && !data.platformWide && !practiceId) {
        throw new Error("Platform-wide partners must be marked as platform-wide.");
      }
    }

    const payload = {
      practice_id: practiceId,
      name: data.name.trim(),
      description: data.description.trim(),
      city: data.city.trim(),
      address: data.address.trim(),
      maps_url: data.maps_url,
      active: data.active,
      is_placeholder: false,
      created_by: context.userId,
      updated_at: new Date().toISOString(),
    };

    if (data.id) {
      let q = supabaseAdmin.from("restaurant_partners").update(payload).eq("id", data.id);
      if (role !== "super_admin") {
        if (!practiceId) throw new Error("Forbidden");
        q = q.eq("practice_id", practiceId);
      }
      const { data: row, error } = await q.select("*").single();
      if (error) throw new Error(error.message);
      return row as RestaurantPartner;
    }

    const { data: row, error } = await supabaseAdmin
      .from("restaurant_partners")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as RestaurantPartner;
  });

export const deleteRestaurantPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    if (!RESTAURANT_REWARD_PARTNERS) throw new Error("Restaurant partners are disabled.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const role = await roleOf(supabaseAdmin, context.userId);
    if (role !== "super_admin" && role !== "practitioner") throw new Error("Forbidden");

    if (role === "super_admin") {
      const { error } = await supabaseAdmin.from("restaurant_partners").delete().eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true as const };
    }

    const ctx = await resolvePractitionerPracticeId(supabaseAdmin, context.userId);
    if (!ctx?.practiceId) throw new Error("Forbidden");
    const { error } = await supabaseAdmin
      .from("restaurant_partners")
      .delete()
      .eq("id", data.id)
      .eq("practice_id", ctx.practiceId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
