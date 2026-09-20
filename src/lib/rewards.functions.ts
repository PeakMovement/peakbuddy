import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import { canAccessClient } from "@/lib/practice-members.functions";
import { RESTAURANT_REWARD_PARTNERS } from "@/lib/feature-flags";
import {
  eligibleForCheckInCount,
  eligibleForManualApprove,
  eligibleForMilestone,
  pickRandom,
  type PoolReward,
} from "@/lib/reward-pool";

// South Africa has no DST; SAST is a fixed UTC+2. Gate reward availability on
// the local weekday rather than UTC so the day boundary matches users.
function sastWeekday(): number {
  return new Date(Date.now() + 2 * 60 * 60 * 1000).getUTCDay();
}

export type Reward = {
  id: string;
  name: string;
  description: string;
  voucher_code: string;
  maps_url: string | null;
  active: boolean;
  created_at: string;
  partner_id: string | null;
  practice_id: string | null;
  discount_percent: number | null;
  min_streak: number | null;
  min_check_ins: number | null;
  earn_on: "milestone" | "check_in_count" | "manual";
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
    .refine((v) => v === null || /^https?:\/\/\S+$/i.test(v), {
      message: "Enter a full URL starting with http:// or https://, or leave blank.",
    }),
  active: z.boolean().default(true),
  partner_id: z.string().uuid().nullable().optional(),
  discount_percent: z.number().int().min(1).max(100).nullable().optional(),
  min_streak: z.number().int().min(1).max(365).nullable().optional(),
  min_check_ins: z.number().int().min(1).max(1000).nullable().optional(),
  earn_on: z.enum(["milestone", "check_in_count", "manual"]).optional().default("milestone"),
});

function asEarnOn(v: unknown): Reward["earn_on"] {
  return v === "check_in_count" || v === "manual" || v === "milestone" ? v : "milestone";
}

function toReward(row: Record<string, unknown>): Reward {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    voucher_code: String(row.voucher_code ?? ""),
    maps_url: (row.maps_url as string | null) ?? null,
    active: row.active !== false,
    created_at: String(row.created_at ?? ""),
    partner_id: (row.partner_id as string | null) ?? null,
    practice_id: (row.practice_id as string | null) ?? null,
    discount_percent: typeof row.discount_percent === "number" ? row.discount_percent : null,
    min_streak: typeof row.min_streak === "number" ? row.min_streak : null,
    min_check_ins: typeof row.min_check_ins === "number" ? row.min_check_ins : null,
    earn_on: asEarnOn(row.earn_on),
  };
}

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
    return ((data ?? []) as Record<string, unknown>[]).map(toReward);
  });

/** Practitioner: platform-wide catalog + this practice's restaurant discounts. */
export const listManageableRewards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("role")
      .eq("id", context.userId)
      .maybeSingle();
    if (prof?.role === "super_admin") {
      const { data, error } = await supabaseAdmin
        .from("rewards")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as Record<string, unknown>[]).map(toReward);
    }
    if (prof?.role !== "practitioner") throw new Error("Forbidden");
    const { resolvePractitionerPracticeId } = await import("@/lib/practice-members.functions");
    const ctx = await resolvePractitionerPracticeId(supabaseAdmin, context.userId);
    const q = supabaseAdmin.from("rewards").select("*").order("created_at", { ascending: false });
    const { data, error } = ctx?.practiceId
      ? await q.or(`practice_id.is.null,practice_id.eq.${ctx.practiceId}`)
      : await q.is("practice_id", null);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map(toReward);
  });

export const upsertReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RewardSchema.parse(input))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("role")
      .eq("id", context.userId)
      .maybeSingle();
    const isAdmin = prof?.role === "super_admin";
    const isPrac = prof?.role === "practitioner";
    if (!isAdmin && !isPrac) throw new Error("Forbidden");

    let practiceId: string | null = null;
    if (isPrac) {
      const { resolvePractitionerPracticeId } = await import("@/lib/practice-members.functions");
      const ctx = await resolvePractitionerPracticeId(supabaseAdmin, context.userId);
      if (!ctx?.practiceId) {
        throw new Error("Join or create a practice before adding restaurant discounts.");
      }
      practiceId = ctx.practiceId;
    }

    const payload = {
      name: data.name,
      description: data.description,
      voucher_code: data.voucher_code,
      maps_url: data.maps_url || null,
      active: data.active,
      partner_id: RESTAURANT_REWARD_PARTNERS ? (data.partner_id ?? null) : undefined,
      discount_percent: RESTAURANT_REWARD_PARTNERS ? (data.discount_percent ?? null) : undefined,
      min_streak: RESTAURANT_REWARD_PARTNERS ? (data.min_streak ?? null) : undefined,
      min_check_ins: RESTAURANT_REWARD_PARTNERS ? (data.min_check_ins ?? null) : undefined,
      earn_on: RESTAURANT_REWARD_PARTNERS ? (data.earn_on ?? "milestone") : undefined,
      practice_id: isPrac ? practiceId : undefined,
    };

    if (data.id) {
      let q = supabaseAdmin.from("rewards").update(payload).eq("id", data.id);
      if (isPrac && practiceId) q = q.eq("practice_id", practiceId);
      else if (!isAdmin) throw new Error("Forbidden");
      const { data: row, error } = await q.select("*").single();
      if (error) throw new Error(error.message);
      return toReward(row as Record<string, unknown>);
    }
    const insertRow = isPrac ? { ...payload, practice_id: practiceId } : payload;
    const { data: row, error } = await supabaseAdmin
      .from("rewards")
      .insert(insertRow)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return toReward(row as Record<string, unknown>);
  });

export const deleteReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("role")
      .eq("id", context.userId)
      .maybeSingle();
    if (prof?.role === "super_admin") {
      const { error } = await supabaseAdmin.from("rewards").delete().eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true as const };
    }
    if (prof?.role !== "practitioner") throw new Error("Forbidden");
    const { resolvePractitionerPracticeId } = await import("@/lib/practice-members.functions");
    const ctx = await resolvePractitionerPracticeId(supabaseAdmin, context.userId);
    if (!ctx?.practiceId) throw new Error("Forbidden");
    const { error } = await supabaseAdmin
      .from("rewards")
      .delete()
      .eq("id", data.id)
      .eq("practice_id", ctx.practiceId);
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
    discount_percent: number | null;
    partner_name: string | null;
    partner_city: string | null;
  } | null;
};

const ISSUED_SELECT =
  "id, status, earned_at, reward:rewards(name, voucher_code, description, maps_url, discount_percent, partner:restaurant_partners(name, city, maps_url))";

function normalizeReward(row: any): IssuedReward {
  const r = Array.isArray(row.reward) ? (row.reward[0] ?? null) : (row.reward ?? null);
  const partnerRaw = r?.partner;
  const partner = Array.isArray(partnerRaw) ? (partnerRaw[0] ?? null) : (partnerRaw ?? null);
  return {
    id: row.id,
    status: row.status,
    earned_at: row.earned_at,
    reward: r
      ? {
          name: r.name,
          voucher_code: r.voucher_code,
          description: r.description,
          maps_url: (partner?.maps_url as string | null) || r.maps_url || null,
          discount_percent: typeof r.discount_percent === "number" ? r.discount_percent : null,
          partner_name: partner?.name ?? null,
          partner_city: partner?.city ?? null,
        }
      : null,
  };
}

const FALLBACK_ISSUED_SELECT =
  "id, status, earned_at, reward:rewards(name, voucher_code, description, maps_url)";

async function insertIssued(db: SupabaseClient, payload: Record<string, unknown>) {
  const first = await db.from("client_rewards").insert(payload).select(ISSUED_SELECT).single();
  if (!first.error) return first;
  if (!/schema cache|restaurant_partners|discount_percent/i.test(first.error.message)) {
    return first;
  }
  return db.from("client_rewards").insert(payload).select(FALLBACK_ISSUED_SELECT).single();
}

// Practitioner (or super admin) approves: issue a random ACTIVE reward to the client.
export const approveClientReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;

    const { data: client } = await db
      .from("clients")
      .select("id, practitioner_id, practice_id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) throw new Error("Client not found");

    const access = await canAccessClient(db as never, context.userId, data.clientId);
    if (!access.allowed) throw new Error("Forbidden");

    // Global super-admin gate: enabled + allowed weekday.
    const { data: settings } = await db
      .from("platform_settings")
      .select("rewards_enabled, rewards_allowed_days")
      .limit(1)
      .maybeSingle();
    if (settings && (settings as any).rewards_enabled === false) {
      throw new Error("Rewards are currently disabled by the administrator.");
    }
    const allowedDays: number[] = ((settings as any)?.rewards_allowed_days ?? [
      0, 1, 2, 3, 4, 5, 6,
    ]) as number[];
    const today = sastWeekday();
    if (!allowedDays.includes(today)) {
      const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const list =
        allowedDays.length === 0
          ? "no days"
          : allowedDays
              .slice()
              .sort()
              .map((d) => names[d])
              .join(", ");
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

    const { data: pool } = await db
      .from("rewards")
      .select("id, partner_id, practice_id, min_streak, min_check_ins, earn_on, active")
      .eq("active", true);
    const eligible = eligibleForManualApprove(
      (pool ?? []) as PoolReward[],
      (client as { practice_id?: string | null }).practice_id ?? null,
    );
    const chosen = pickRandom(eligible);
    if (!chosen) throw new Error("No active rewards available. Add rewards first.");

    const { data: issued, error } = await insertIssued(db, {
      client_id: data.clientId,
      reward_id: chosen.id,
      practitioner_id: context.userId,
      status: "earned",
    });
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
  .inputValidator((input: unknown) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const access = await canAccessClient(db as never, context.userId, data.clientId);
    if (!access.allowed) throw new Error("Forbidden");
    const { data: rows, error } = await db
      .from("client_rewards")
      .select(ISSUED_SELECT)
      .eq("client_id", data.clientId)
      .order("earned_at", { ascending: false });
    if (error && /schema cache|restaurant_partners|discount_percent/i.test(error.message)) {
      const fallback = await db
        .from("client_rewards")
        .select(FALLBACK_ISSUED_SELECT)
        .eq("client_id", data.clientId)
        .order("earned_at", { ascending: false });
      return (fallback.data ?? []).map(normalizeReward);
    }
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
    const { data: rows, error } = await db
      .from("client_rewards")
      .select(ISSUED_SELECT)
      .eq("client_id", client.id)
      .order("earned_at", { ascending: false });
    if (error && /schema cache|restaurant_partners|discount_percent/i.test(error.message)) {
      const fallback = await db
        .from("client_rewards")
        .select(FALLBACK_ISSUED_SELECT)
        .eq("client_id", client.id)
        .order("earned_at", { ascending: false });
      return (fallback.data ?? []).map(normalizeReward);
    }
    return (rows ?? []).map(normalizeReward);
  });

// Any authenticated user (client or practitioner) can read whether rewards are
// live, so their UI can show/hide the rewards surfaces. Defaults to false — the
// rewards experience stays hidden until an admin explicitly activates it.
export const getRewardsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ enabled: boolean }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const { data } = await db
      .from("platform_settings")
      .select("rewards_enabled")
      .limit(1)
      .maybeSingle();
    return {
      enabled: (data as { rewards_enabled?: boolean } | null)?.rewards_enabled === true,
    };
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
      .limit(1)
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
    const { data: existing } = await db
      .from("platform_settings")
      .select("id")
      .limit(1)
      .maybeSingle();
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
      .select("id, client_id, reward_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("Not found");
    const { data: client } = await db
      .from("clients")
      .select("id")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!client || client.id !== row.client_id) throw new Error("Forbidden");
    // A voucher code is reusable display data, so duplicate issuances of the
    // same reward should disappear together when the client marks it used.
    const { error } = await db
      .from("client_rewards")
      .update({ status: "redeemed", redeemed_at: new Date().toISOString() })
      .eq("client_id", client.id)
      .eq("reward_id", row.reward_id)
      .neq("status", "redeemed");
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
    for (const r of (rows ?? []) as unknown as {
      status: string;
      reward: { name: string } | null;
    }[]) {
      const name = r.reward?.name ?? "Unknown";
      const e = map.get(name) ?? { issued: 0, redeemed: 0 };
      e.issued += 1;
      if (r.status === "redeemed") e.redeemed += 1;
      map.set(name, e);
    }
    return Array.from(map.entries()).map(([name, v]) => ({
      name,
      issued: v.issued,
      redeemed: v.redeemed,
    }));
  });

/**
 * Auto-issue a reward after a check-in: streak milestones first, then
 * restaurant discounts tied to a lifetime check-in count. Gated by platform
 * rewards settings, per-practice gamification + auto_reward_enabled.
 * Idempotent (unique indexes). Best-effort: never throws into the check-in flow.
 *
 * Patient PII is never sent to restaurant partners — only the client sees
 * their own voucher in Buddy.
 */
export const autoIssueMilestoneReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;

    const { data: client } = await db
      .from("clients")
      .select("id, practitioner_id, practice_id, auth_user_id, full_name, check_in_frequency")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!client) return { issued: false as const, reason: "not_client" as const };

    const { data: settings } = await db
      .from("platform_settings")
      .select("rewards_enabled, rewards_allowed_days")
      .limit(1)
      .maybeSingle();
    if (settings && (settings as { rewards_enabled?: boolean }).rewards_enabled === false)
      return { issued: false as const, reason: "disabled" as const };
    const allowedDays = ((settings as { rewards_allowed_days?: number[] } | null)
      ?.rewards_allowed_days ?? [0, 1, 2, 3, 4, 5, 6]) as number[];
    if (!allowedDays.includes(sastWeekday()))
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

    const { computeStreak, STREAK_MILESTONES } = await import("@/lib/streak");
    type Freq = import("@/lib/streak").CheckInFrequency;
    const { data: rows } = await db
      .from("check_ins")
      .select("created_at")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .limit(400);
    const stamps = ((rows ?? []) as { created_at: string }[]).map((r) => r.created_at);
    const freq = ((client as { check_in_frequency?: string }).check_in_frequency ??
      "daily") as Freq;
    const streak = computeStreak(stamps, freq);
    const practiceId = (client as { practice_id?: string | null }).practice_id ?? null;

    const { data: poolRows } = await db
      .from("rewards")
      .select("id, partner_id, practice_id, min_streak, min_check_ins, earn_on, active")
      .eq("active", true);
    const pool = (poolRows ?? []) as PoolReward[];

    const notify = async (normalized: IssuedReward, title: string, body: string) => {
      try {
        if (client.auth_user_id) {
          const { sendPushCore } = await import("@/lib/push.functions");
          await sendPushCore(db as unknown as Parameters<typeof sendPushCore>[0], {
            userId: client.auth_user_id,
            title,
            body,
            data: { type: "reward_earned", rewardId: normalized.id },
          });
        }
      } catch {
        /* push is best-effort */
      }
    };

    const reached = STREAK_MILESTONES.filter((m) => streak.current >= m);
    const { data: existingMilestones } = await db
      .from("client_rewards")
      .select("milestone")
      .eq("client_id", client.id)
      .not("milestone", "is", null);
    const done = new Set(
      ((existingMilestones ?? []) as { milestone: number | null }[]).map((r) => r.milestone),
    );
    const target = reached.find((m) => !done.has(m));

    if (target !== undefined) {
      const chosen = pickRandom(eligibleForMilestone(pool, practiceId, target));
      if (chosen) {
        const { data: issued, error } = await insertIssued(db, {
          client_id: client.id,
          reward_id: chosen.id,
          practitioner_id: client.practitioner_id,
          status: "earned",
          milestone: target,
          source: "auto",
        });
        if (!error && issued) {
          const normalized = normalizeReward(issued);
          const firstName = (client.full_name || "").trim().split(/\s+/)[0] || "Hey";
          await notify(
            normalized,
            "🎁 Streak reward unlocked",
            `${firstName}, you hit a ${target}-check-in streak — a voucher is waiting in your profile.`,
          );
          return { issued: true as const, milestone: target, reward: normalized };
        }
      }
    }

    const { data: existingAuto } = await db
      .from("client_rewards")
      .select("reward_id")
      .eq("client_id", client.id)
      .eq("source", "auto");
    const issuedIds = ((existingAuto ?? []) as { reward_id: string }[]).map((r) => r.reward_id);
    const countEligible = eligibleForCheckInCount(pool, practiceId, stamps.length, issuedIds);
    const countPick = pickRandom(countEligible);
    if (countPick) {
      const { data: issued, error } = await insertIssued(db, {
        client_id: client.id,
        reward_id: countPick.id,
        practitioner_id: client.practitioner_id,
        status: "earned",
        source: "auto",
      });
      if (!error && issued) {
        const normalized = normalizeReward(issued);
        const firstName = (client.full_name || "").trim().split(/\s+/)[0] || "Hey";
        await notify(
          normalized,
          "🎁 Check-in reward unlocked",
          `${firstName}, a restaurant discount is waiting in your Buddy profile.`,
        );
        return { issued: true as const, reward: normalized };
      }
    }

    if (reached.length === 0) return { issued: false as const, reason: "no_milestone" as const };
    if (target === undefined && countEligible.length === 0)
      return { issued: false as const, reason: "already_issued" as const };
    return { issued: false as const, reason: "no_rewards" as const };
  });
