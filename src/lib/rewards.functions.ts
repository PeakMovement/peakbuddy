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
  maps_url: z
    .string()
    .max(500)
    .optional()
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null))
    .refine(
      (v) => v === null || /^https?:\/\/\S+$/i.test(v),
      { message: "Enter a full URL starting with http:// or https://, or leave blank." },
    ),
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

function normalizeReward(row: any): IssuedReward {
  const r = Array.isArray(row.reward) ? row.reward[0] ?? null : row.reward ?? null;
  return {
    id: row.id,
    status: row.status,
    earned_at: row.earned_at,
    reward: r
      ? {
          name: r.name,
          voucher_code: r.voucher_code,
          description: r.description,
          maps_url: r.maps_url ?? null,
        }
      : null,
  };
}

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

    // Global super-admin gate: enabled + allowed weekday.
    const { data: settings } = await db
      .from("platform_settings")
      .select("rewards_enabled, rewards_allowed_days")
      .maybeSingle();
    if (settings && (settings as any).rewards_enabled === false) {
      throw new Error("Rewards are currently disabled by the administrator.");
    }
    const allowedDays: number[] = ((settings as any)?.rewards_allowed_days ?? [0, 1, 2, 3, 4, 5, 6]) as number[];
    const today = new Date().getUTCDay();
    if (!allowedDays.includes(today)) {
      const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const list = allowedDays.length === 0
        ? "no days"
        : allowedDays.slice().sort().map((d) => names[d]).join(", ");
      throw new Error(`Rewards can only be approved on: ${list}.`);
    }

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
    const normalized = normalizeReward(issued);

    // Notify the client (push) that they earned a reward. Non-fatal.
    try {
      const { data: clientRow } = await db
        .from("clients")
        .select("auth_user_id, full_name")
        .eq("id", data.clientId)
        .maybeSingle();
      if (clientRow?.auth_user_id) {
        const { sendPushCore } = await import("@/lib/push.functions");
        const firstName = (clientRow.full_name || "").trim().split(/\s+/)[0] || "Hey";
        await sendPushCore(db as any, {
          userId: clientRow.auth_user_id,
          title: "🎁 You earned a reward",
          body: `${firstName}, a new voucher is waiting in your Buddy profile.`,
          data: { type: "reward_earned", rewardId: normalized.id },
        });
      }
    } catch {
      /* push is best-effort */
    }

    return normalized;
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
    return (rows ?? []).map(normalizeReward);
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
    return (rows ?? []).map(normalizeReward);
  });

// ---- Super-admin: global rewards availability schedule ----

export type RewardsSchedule = { enabled: boolean; allowedDays: number[] };

export const getRewardsSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RewardsSchedule> => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const { data } = await db
      .from("platform_settings")
      .select("rewards_enabled, rewards_allowed_days")
      .maybeSingle();
    return {
      enabled: (data as any)?.rewards_enabled ?? true,
      allowedDays: ((data as any)?.rewards_allowed_days ?? [0, 1, 2, 3, 4, 5, 6]) as number[],
    };
  });

export const updateRewardsSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        enabled: z.boolean(),
        allowedDays: z.array(z.number().int().min(0).max(6)).max(7),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<RewardsSchedule> => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const days = Array.from(new Set(data.allowedDays)).sort();
    const { data: existing } = await db.from("platform_settings").select("id").maybeSingle();
    const payload = { rewards_enabled: data.enabled, rewards_allowed_days: days };
    if (existing?.id) {
      await db.from("platform_settings").update(payload).eq("id", existing.id);
    } else {
      await db.from("platform_settings").insert(payload);
    }
    return { enabled: data.enabled, allowedDays: days };
  });

// ---- Stage: redemption tracking ----

export const redeemMyReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const { data: row } = await db
      .from("client_rewards")
      .select("id, client_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("Not found");
    const { data: client } = await db
      .from("clients")
      .select("id")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!client || client.id !== row.client_id) throw new Error("Forbidden");
    const { error } = await db
      .from("client_rewards")
      .update({ status: "redeemed", redeemed_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export type RedemptionRow = { name: string; issued: number; redeemed: number };

export const getRewardsRedemptionSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RedemptionRow[]> => {
    const { data: me } = await context.supabase
      .from("profiles")
      .select("role")
      .eq("id", context.userId)
      .maybeSingle();
    if (me?.role !== "super_admin") throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const { data: rows } = await db.from("client_rewards").select("status, reward:rewards(name)");
    const map = new Map<string, { issued: number; redeemed: number }>();
    for (const r of (rows ?? []) as unknown as { status: string; reward: { name: string } | null }[]) {
      const name = r.reward?.name ?? "Unknown";
      const e = map.get(name) ?? { issued: 0, redeemed: 0 };
      e.issued += 1;
      if (r.status === "redeemed") e.redeemed += 1;
      map.set(name, e);
    }
    return Array.from(map.entries()).map(([name, v]) => ({ name, issued: v.issued, redeemed: v.redeemed }));
  });

/**
 * #4 Auto-issue a reward when the calling client hits a new streak milestone.
 * Streak is recomputed authoritatively server-side. Gated by platform rewards
 * settings, per-practice gamification + auto_reward_enabled. Idempotent per
 * milestone via the client_rewards.milestone unique index. Best-effort: returns
 * { issued:false } for every gate rather than throwing, so the check-in flow
 * never breaks on it.
 */
export const autoIssueMilestoneReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;

    const { data: client } = await db
      .from("clients")
      .select("id, practitioner_id, auth_user_id, full_name, check_in_frequency")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!client) return { issued: false as const, reason: "not_client" as const };

    // Platform + practice gates.
    const { data: settings } = await db
      .from("platform_settings")
      .select("rewards_enabled, rewards_allowed_days")
      .maybeSingle();
    if (settings && (settings as { rewards_enabled?: boolean }).rewards_enabled === false)
      return { issued: false as const, reason: "disabled" as const };
    const allowedDays = ((settings as { rewards_allowed_days?: number[] } | null)?.rewards_allowed_days ??
      [0, 1, 2, 3, 4, 5, 6]) as number[];
    if (!allowedDays.includes(new Date().getUTCDay()))
      return { issued: false as const, reason: "day_not_allowed" as const };

    const { data: prac } = await db
      .from("practices")
      .select("gamification_enabled, auto_reward_enabled")
      .eq("practitioner_id", client.practitioner_id)
      .maybeSingle();
    if (prac && (prac as { gamification_enabled?: boolean }).gamification_enabled === false)
      return { issued: false as const, reason: "gamification_off" as const };
    if (prac && (prac as { auto_reward_enabled?: boolean }).auto_reward_enabled === false)
      return { issued: false as const, reason: "auto_off" as const };

    // Authoritative streak from check-in history.
    const { computeStreak, STREAK_MILESTONES } = await import("@/lib/streak");
    type Freq = import("@/lib/streak").CheckInFrequency;
    const { data: rows } = await db
      .from("check_ins")
      .select("created_at")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .limit(400);
    const stamps = ((rows ?? []) as { created_at: string }[]).map((r) => r.created_at);
    const freq = ((client as { check_in_frequency?: string }).check_in_frequency ?? "daily") as Freq;
    const streak = computeStreak(stamps, freq);

    const reached = STREAK_MILESTONES.filter((m) => streak.current >= m);
    if (reached.length === 0) return { issued: false as const, reason: "no_milestone" as const };

    const { data: existing } = await db
      .from("client_rewards")
      .select("milestone")
      .eq("client_id", client.id)
      .not("milestone", "is", null);
    const done = new Set(((existing ?? []) as { milestone: number | null }[]).map((r) => r.milestone));
    const target = reached.find((m) => !done.has(m));
    if (target === undefined) return { issued: false as const, reason: "already_issued" as const };

    const { data: pool } = await db.from("rewards").select("id").eq("active", true);
    const list = (pool ?? []) as { id: string }[];
    if (list.length === 0) return { issued: false as const, reason: "no_rewards" as const };
    const chosen = list[Math.floor(Math.random() * list.length)];

    const { data: issued, error } = await db
      .from("client_rewards")
      .insert({
        client_id: client.id,
        reward_id: chosen.id,
        practitioner_id: client.practitioner_id,
        status: "earned",
        milestone: target,
        source: "auto",
      })
      .select(ISSUED_SELECT)
      .single();
    if (error) return { issued: false as const, reason: "race" as const };
    const normalized = normalizeReward(issued);

    try {
      if (client.auth_user_id) {
        const { sendPushCore } = await import("@/lib/push.functions");
        const firstName = (client.full_name || "").trim().split(/\s+/)[0] || "Hey";
        await sendPushCore(db as unknown as Parameters<typeof sendPushCore>[0], {
          userId: client.auth_user_id,
          title: "🎁 Streak reward unlocked",
          body: `${firstName}, you hit a ${target}-check-in streak — a voucher is waiting in your profile.`,
          data: { type: "reward_earned", rewardId: normalized.id, milestone: target },
        });
      }
    } catch {
      /* push is best-effort */
    }

    return { issued: true as const, milestone: target, reward: normalized };
  });
