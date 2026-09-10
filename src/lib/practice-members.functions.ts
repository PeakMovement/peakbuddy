import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SITE_ORIGIN = process.env.BUDDY_APP_BASE_URL || "https://peakbuddy.lovable.app";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

/** The practice a practitioner belongs to: the one they own, else one they're an active member of. */
export async function resolvePractitionerPracticeId(
  admin: Admin,
  userId: string,
): Promise<{ practiceId: string; isOwner: boolean } | null> {
  const { data: own } = await admin
    .from("practices")
    .select("id")
    .eq("practitioner_id", userId)
    .maybeSingle();
  if (own?.id) return { practiceId: own.id as string, isOwner: true };
  const { data: mem } = await admin
    .from("practice_members")
    .select("practice_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (mem?.practice_id) return { practiceId: mem.practice_id as string, isOwner: false };
  return null;
}

async function isSuperAdmin(admin: Admin, userId: string): Promise<boolean> {
  const { data } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  return (data as { role?: string } | null)?.role === "super_admin";
}

/** The caller's practice context + (for the owner) the member roster. */
export const getMyPractice = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ctx = await resolvePractitionerPracticeId(supabaseAdmin, context.userId);
    if (!ctx) return { inPractice: false as const };

    const { data: practice } = await supabaseAdmin
      .from("practices")
      .select("id, practice_name, practice_type, max_members, contact_email, contact_phone")
      .eq("id", ctx.practiceId)
      .maybeSingle();

    const { data: memberRows } = await supabaseAdmin
      .from("practice_members")
      .select("user_id, role, status, created_at")
      .eq("practice_id", ctx.practiceId)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    // Roster with names (needed by everyone for the transfer picker); emails are
    // included for the owner only.
    const members: { userId: string; role: string; name: string; email: string | null }[] = [];
    for (const m of memberRows ?? []) {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", m.user_id)
        .maybeSingle();
      let email: string | null = null;
      if (ctx.isOwner) {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(m.user_id as string);
        email = u?.user?.email ?? null;
      }
      members.push({
        userId: m.user_id as string,
        role: m.role as string,
        name: (prof as { full_name?: string } | null)?.full_name || "Practitioner",
        email,
      });
    }

    return {
      inPractice: true as const,
      practiceId: ctx.practiceId,
      isOwner: ctx.isOwner,
      practiceType: (practice?.practice_type as string) ?? "individual",
      maxMembers: (practice?.max_members as number) ?? 6,
      memberCount: (memberRows ?? []).length,
      contactEmail: (practice?.contact_email as string | null) ?? null,
      contactPhone: (practice?.contact_phone as string | null) ?? null,
      members,
    };
  });

/** Owner invites a practitioner into their practice (up to max_members). */
export const invitePracticeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ email: z.string().trim().email().max(255), fullName: z.string().trim().min(1).max(120) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ctx = await resolvePractitionerPracticeId(supabaseAdmin, context.userId);
    if (!ctx || !ctx.isOwner) return { ok: false as const, error: "Only the practice admin can add members." };

    const { data: practice } = await supabaseAdmin
      .from("practices")
      .select("practice_type, max_members")
      .eq("id", ctx.practiceId)
      .maybeSingle();
    if ((practice as { practice_type?: string } | null)?.practice_type !== "group") {
      return { ok: false as const, error: "This is an individual practice. Switch to a practice account to add members." };
    }
    const max = (practice as { max_members?: number } | null)?.max_members ?? 6;

    const { count } = await supabaseAdmin
      .from("practice_members")
      .select("id", { count: "exact", head: true })
      .eq("practice_id", ctx.practiceId)
      .eq("status", "active");
    if ((count ?? 0) >= max) {
      return { ok: false as const, error: `This practice is full (${max} practitioners).` };
    }

    // Create or find the invited auth user.
    let userId: string | null = null;
    const { data: invited, error: invErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
      data: { full_name: data.fullName, role: "practitioner" },
      redirectTo: `${SITE_ORIGIN}/practitioner/login`,
    });
    if (invErr || !invited?.user) {
      // Already registered? Find them.
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const existing = list?.users.find((u) => u.email?.toLowerCase() === data.email.toLowerCase());
      if (!existing) return { ok: false as const, error: invErr?.message ?? "Could not invite this email." };
      userId = existing.id;
    } else {
      userId = invited.user.id;
    }

    // Guard: don't pull in someone who already owns their own practice or is in another practice.
    const existingCtx = await resolvePractitionerPracticeId(supabaseAdmin, userId);
    if (existingCtx && existingCtx.practiceId !== ctx.practiceId) {
      return { ok: false as const, error: "That practitioner already belongs to another practice." };
    }

    const { error: memErr } = await supabaseAdmin
      .from("practice_members")
      .upsert(
        { practice_id: ctx.practiceId, user_id: userId, role: "member", status: "active" },
        { onConflict: "practice_id,user_id" },
      );
    if (memErr) return { ok: false as const, error: memErr.message };
    return { ok: true as const };
  });

/** Owner removes a member from the practice. Their clients remain (transfer them first). */
export const removePracticeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ctx = await resolvePractitionerPracticeId(supabaseAdmin, context.userId);
    if (!ctx || !ctx.isOwner) return { ok: false as const, error: "Only the practice admin can remove members." };
    if (data.userId === context.userId) return { ok: false as const, error: "You can't remove yourself (you're the admin)." };

    const { count } = await supabaseAdmin
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("practitioner_id", data.userId)
      .eq("practice_id", ctx.practiceId);
    if ((count ?? 0) > 0) {
      return {
        ok: false as const,
        error: `Transfer this practitioner's ${count} client(s) to a colleague before removing them.`,
      };
    }

    await supabaseAdmin
      .from("practice_members")
      .update({ status: "removed" })
      .eq("practice_id", ctx.practiceId)
      .eq("user_id", data.userId)
      .eq("role", "member");
    return { ok: true as const };
  });

/** Admin (owner) view of EVERY client in the practice. Members use their own RLS-scoped list. */
export const listPracticeClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ctx = await resolvePractitionerPracticeId(supabaseAdmin, context.userId);
    const superAdmin = await isSuperAdmin(supabaseAdmin, context.userId);
    if (!ctx || (!ctx.isOwner && !superAdmin)) {
      return { ok: false as const, error: "Only the practice admin can see all clients." };
    }
    const { data } = await supabaseAdmin
      .from("clients")
      .select("id, full_name, primary_complaint, practitioner_id, program_status, created_at")
      .eq("practice_id", ctx.practiceId)
      .order("created_at", { ascending: false });
    return { ok: true as const, clients: data ?? [] };
  });

/** Transfer a client to another practitioner in the SAME practice. */
export const transferClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ clientId: z.string().uuid(), toUserId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, practitioner_id, practice_id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) return { ok: false as const, error: "Client not found." };

    const practiceId = (client as { practice_id?: string | null }).practice_id ?? null;
    const ctx = await resolvePractitionerPracticeId(supabaseAdmin, context.userId);
    const superAdmin = await isSuperAdmin(supabaseAdmin, context.userId);

    // Caller must be the client's current practitioner, the practice owner, or super admin.
    const isCurrent = client.practitioner_id === context.userId;
    const isOwnerOfPractice = !!ctx && ctx.isOwner && ctx.practiceId === practiceId;
    if (!isCurrent && !isOwnerOfPractice && !superAdmin) {
      return { ok: false as const, error: "You can't transfer this client." };
    }
    if (!practiceId) return { ok: false as const, error: "This client isn't in a group practice." };

    // Target must be an active practitioner in the SAME practice (member or owner).
    const targetCtx = await resolvePractitionerPracticeId(supabaseAdmin, data.toUserId);
    if (!targetCtx || targetCtx.practiceId !== practiceId) {
      return { ok: false as const, error: "You can only transfer to a practitioner in your practice." };
    }

    const { error } = await supabaseAdmin
      .from("clients")
      .update({ practitioner_id: data.toUserId })
      .eq("id", data.clientId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

/**
 * Can this practitioner access this client? True if they're the client's own
 * practitioner, the OWNER (admin) of the client's practice, or a super admin.
 * Returns the client's practitioner_id/practice_id when found.
 */
export async function canAccessClient(
  admin: Admin,
  userId: string,
  clientId: string,
): Promise<{ allowed: boolean }> {
  const { data: c } = await admin
    .from("clients")
    .select("practitioner_id, practice_id")
    .eq("id", clientId)
    .maybeSingle();
  if (!c) return { allowed: false };
  if (c.practitioner_id === userId) return { allowed: true };
  const practiceId = (c as { practice_id?: string | null }).practice_id ?? null;
  const ctx = await resolvePractitionerPracticeId(admin, userId);
  if (ctx && ctx.isOwner && practiceId && ctx.practiceId === practiceId) return { allowed: true };
  if (await isSuperAdmin(admin, userId)) return { allowed: true };
  return { allowed: false };
}

/**
 * Full client-detail bundle for a practitioner, access-checked (own client OR
 * practice admin OR super admin). Lets a practice admin open a member's client
 * without changing table RLS. Returns everything the detail page + its cards
 * need, so those cards don't have to run their own RLS-scoped queries.
 */
export const getPractitionerClientBundle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const access = await canAccessClient(supabaseAdmin, context.userId, data.clientId);
    if (!access.allowed) return { ok: false as const, error: "Not authorized for this client." };

    const [{ data: client }, { data: checkIns }, { data: sessions }, { data: patterns }] =
      await Promise.all([
        supabaseAdmin.from("clients").select("*").eq("id", data.clientId).maybeSingle(),
        supabaseAdmin
          .from("check_ins")
          .select("*")
          .eq("client_id", data.clientId)
          .order("created_at", { ascending: false }),
        supabaseAdmin
          .from("wearable_sessions")
          .select("date, source, sleep_score, readiness_score, resting_hr, hrv_avg, total_steps")
          .eq("client_id", data.clientId)
          .order("date", { ascending: false })
          .limit(30),
        supabaseAdmin
          .from("client_patterns")
          .select("pattern_type, day_of_week, metric, avg_value, confidence, sample_size")
          .eq("client_id", data.clientId)
          .eq("active", true)
          .order("confidence", { ascending: false })
          .limit(4),
      ]);

    return {
      ok: true as const,
      client: client ?? null,
      checkIns: checkIns ?? [],
      wearableSessions: sessions ?? [],
      patterns: patterns ?? [],
    };
  });
