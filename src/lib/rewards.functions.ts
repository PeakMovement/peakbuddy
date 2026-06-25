import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

export type Reward = {
  id: string;
  name: string;
  description: string;
  voucher_code: string;
  maps_url: string | null;
  active: boolean;
  created_at: string;
};

const RewardSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).default(""),
  voucher_code: z.string().min(1).max(100),
  maps_url: z.string().url().max(500).nullable().optional(),
  active: z.boolean().default(true),
});

async function assertSuperAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (!data || data.role !== "super_admin") throw new Error("Forbidden");
}

export const listAllRewards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const { data, error } = await db
      .from("rewards")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Reward[];
  });

export const upsertReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RewardSchema.parse(input))
  .handler(async ({ context, data }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const payload = {
      name: data.name,
      description: data.description,
      voucher_code: data.voucher_code,
      maps_url: data.maps_url || null,
      active: data.active,
    };
    if (data.id) {
      const { data: row, error } = await db
        .from("rewards")
        .update(payload)
        .eq("id", data.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return row as Reward;
    }
    const { data: row, error } = await db
      .from("rewards")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as Reward;
  });

export const deleteReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const { error } = await db.from("rewards").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ---- Stage 2/3: issuance + viewing ----

export type IssuedReward = {
  id: string;
  status: string;
  earned_at: string;
  reward: {
    name: string;
    voucher_code: string;
    description: string;
    maps_url: string | null;
  } | null;
};

const ISSUED_SELECT =
  "id, status, earned_at, reward:rewards(name, voucher_code, description, maps_url)";

// Practitioner (or super admin) approves: issue a random ACTIVE reward to the client.
export const approveClientReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ clientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;

    const { data: client } = await db
      .from("clients")
      .select("id, practitioner_id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) throw new Error("Client not found");

    let allowed = client.practitioner_id === context.userId;
    if (!allowed) {
      const { data: prof } = await context.supabase
        .from("profiles")
        .select("role")
        .eq("id", context.userId)
        .maybeSingle();
      allowed = prof?.role === "super_admin";
    }
    if (!allowed) throw new Error("Forbidden");

    // Respect the per-practitioner gamification switch.
    const { data: prac } = await db
      .from("practices")
      .select("gamification_enabled")
      .eq("practitioner_id", client.practitioner_id)
      .maybeSingle();
    if (prac && prac.gamification_enabled === false) {
      throw new Error("Gamification is turned off for this practice.");
    }

    const { data: pool } = await db.from("rewards").select("id").eq("active", true);
    const list = (pool ?? []) as { id: string }[];
    if (list.length === 0) throw new Error("No active rewards available. Add rewards first.");
    const chosen = list[Math.floor(Math.random() * list.length)];

    const { data: issued, error } = await db
      .from("client_rewards")
      .insert({
        client_id: data.clientId,
        reward_id: chosen.id,
        practitioner_id: context.userId,
        status: "earned",
      })
      .select(ISSUED_SELECT)
      .single();
    if (error) throw new Error(error.message);
    return issued as IssuedReward;
  });

// Issued rewards for a client (practitioner / super admin view).
export const listClientRewards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ clientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const { data: client } = await db
      .from("clients")
      .select("practitioner_id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) return [] as IssuedReward[];
    if (client.practitioner_id !== context.userId) {
      const { data: prof } = await context.supabase
        .from("profiles")
        .select("role")
        .eq("id", context.userId)
        .maybeSingle();
      if (prof?.role !== "super_admin") throw new Error("Forbidden");
    }
    const { data: rows } = await db
      .from("client_rewards")
      .select(ISSUED_SELECT)
      .eq("client_id", data.clientId)
      .order("earned_at", { ascending: false });
    return (rows ?? []) as IssuedReward[];
  });

// The signed-in client's own earned vouchers.
export const listMyRewards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const { data: client } = await db
      .from("clients")
      .select("id")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!client) return [] as IssuedReward[];
    const { data: rows } = await db
      .from("client_rewards")
      .select(ISSUED_SELECT)
      .eq("client_id", client.id)
      .order("earned_at", { ascending: false });
    return (rows ?? []) as IssuedReward[];
  });
