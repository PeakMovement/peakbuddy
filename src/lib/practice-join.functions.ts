import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolvePractitionerPracticeId } from "@/lib/practice-members.functions";

const SITE_ORIGIN = process.env.BUDDY_APP_BASE_URL || "https://peakbuddy.lovable.app";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

const newToken = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/-/g, "");

/** Active practitioners in a practice, owner first, as a client-facing picker list. */
async function practicePractitioners(
  admin: Admin,
  practiceId: string,
): Promise<{ id: string; name: string; isAdmin: boolean }[]> {
  const { data: rows } = await admin
    .from("practice_members")
    .select("user_id, role, created_at")
    .eq("practice_id", practiceId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  const out: { id: string; name: string; isAdmin: boolean }[] = [];
  for (const r of rows ?? []) {
    const { data: prof } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", r.user_id)
      .maybeSingle();
    out.push({
      id: r.user_id as string,
      name: (prof as { full_name?: string } | null)?.full_name || "Practitioner",
      isAdmin: (r.role as string) === "owner",
    });
  }
  // Fallback: a practice always has at least its owner. If no member rows exist
  // yet (e.g. the membership backfill hasn't run), use the practice owner so the
  // sign-up link always has a practitioner to attach clients to.
  if (out.length === 0) {
    const { data: prac } = await admin
      .from("practices")
      .select("practitioner_id")
      .eq("id", practiceId)
      .maybeSingle();
    const ownerId = (prac as { practitioner_id?: string } | null)?.practitioner_id ?? null;
    if (ownerId) {
      const { data: prof } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", ownerId)
        .maybeSingle();
      out.push({
        id: ownerId,
        name: (prof as { full_name?: string } | null)?.full_name || "Practitioner",
        isAdmin: true,
      });
    }
  }
  out.sort((a, b) => Number(b.isAdmin) - Number(a.isAdmin));
  return out;
}

async function practiceByToken(admin: Admin, token: string) {
  const { data } = await admin
    .from("practices")
    .select("id, practice_name, join_enabled, join_token")
    .eq("join_token", token)
    .maybeSingle();
  return data as
    | { id: string; practice_name: string | null; join_enabled: boolean; join_token: string }
    | null;
}

/* ------------------------------------------------------------------ *
 * PUBLIC — used by the /join/<token> page (no auth session yet).
 * ------------------------------------------------------------------ */

/** Resolve a join link to a practice name + its practitioner picker list. */
export const getPracticeJoinInfo = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ token: z.string().trim().min(8).max(64) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const practice = await practiceByToken(admin, data.token);
    if (!practice) {
      return { ok: false as const, error: "This sign-up link isn't valid." };
    }
    const practitioners = await practicePractitioners(admin, practice.id);
    return {
      ok: true as const,
      practiceName: practice.practice_name || "your practice",
      practitioners,
    };
  });

const signUpSchema = z.object({
  token: z.string().trim().min(8).max(64),
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(72),
  primaryComplaint: z.string().trim().min(1).max(500),
  practitionerId: z.string().uuid().nullable().optional(),
});

/** Create a client account from a practice join link and stamp it to the practice. */
export const selfSignUpClient = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => signUpSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    const practice = await practiceByToken(admin, data.token);
    if (!practice) {
      return { ok: false as const, error: "This sign-up link isn't valid." };
    }

    // Resolve the chosen practitioner. Must be an active member of THIS practice.
    const practitioners = await practicePractitioners(admin, practice.id);
    if (practitioners.length === 0) {
      return { ok: false as const, error: "This practice isn't accepting sign-ups yet." };
    }
    let practitionerId = data.practitionerId ?? null;
    if (practitionerId) {
      if (!practitioners.some((p) => p.id === practitionerId)) {
        return { ok: false as const, error: "Please choose a practitioner from the list." };
      }
    } else if (practitioners.length === 1) {
      practitionerId = practitioners[0].id;
    } else {
      return { ok: false as const, error: "Please choose which practitioner you're seeing." };
    }

    // Refuse if a client already exists for this email.
    const { data: existingClient } = await admin
      .from("clients")
      .select("id")
      .ilike("email", data.email)
      .limit(1);
    if (Array.isArray(existingClient) && existingClient.length > 0) {
      return {
        ok: false as const,
        error: "An account with this email already exists. Please sign in instead.",
      };
    }

    // Create a brand-new auth user. Unlike the practitioner-driven flow, a public
    // endpoint must NEVER reset the password of an existing auth user (that would
    // let anyone hijack an account by "signing up" with its email).
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (createErr || !created.user?.id) {
      const msg = (createErr?.message ?? "").toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        return {
          ok: false as const,
          error: "An account with this email already exists. Please sign in instead.",
        };
      }
      return { ok: false as const, error: createErr?.message ?? "Could not create your account." };
    }
    const userId = created.user.id;

    const { data: inserted, error: insErr } = await admin
      .from("clients")
      .insert({
        practitioner_id: practitionerId,
        practice_id: practice.id,
        auth_user_id: userId,
        full_name: data.fullName,
        email: data.email,
        primary_complaint: data.primaryComplaint,
        notes: "",
        check_in_frequency: "as_needed",
        popia_accepted: false,
        login_code: String(Math.floor(1000 + Math.random() * 9000)),
        program_status: "none",
      })
      .select("id")
      .single();

    if (insErr) {
      // Roll back the orphaned auth user so the email can be retried cleanly.
      try {
        await admin.auth.admin.deleteUser(userId);
      } catch {
        /* best effort */
      }
      return { ok: false as const, error: insErr.message };
    }

    // Welcome email — best effort, never blocks sign-up.
    try {
      const { sendTransactionalEmailServer } = await import("@/lib/email/send-server");
      await sendTransactionalEmailServer({
        templateName: "client-welcome",
        recipientEmail: data.email,
        idempotencyKey: `client-welcome-${inserted.id}`,
        templateData: {
          clientName: data.fullName,
          practiceName: practice.practice_name || "your practice",
          loginUrl: `${SITE_ORIGIN}/client/login`,
        },
      });
    } catch {
      /* ignore email failures */
    }

    return { ok: true as const, clientId: inserted.id as string };
  });

/* ------------------------------------------------------------------ *
 * AUTHED — practice admin manages the link.
 * ------------------------------------------------------------------ */

/** The caller's practice join link (any practitioner in the practice may view it). */
export const getPracticeJoinLink = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const ctx = await resolvePractitionerPracticeId(admin, context.userId);
    if (!ctx) return { ok: false as const, error: "You're not part of a practice." };
    const { data: p } = await admin
      .from("practices")
      .select("join_token")
      .eq("id", ctx.practiceId)
      .maybeSingle();
    let token = (p as { join_token?: string | null } | null)?.join_token ?? null;
    // Self-heal: older practices created before this feature may have no token.
    if (!token && ctx.isOwner) {
      token = newToken();
      await admin.from("practices").update({ join_token: token }).eq("id", ctx.practiceId);
    }
    return {
      ok: true as const,
      isOwner: ctx.isOwner,
      url: token ? `${SITE_ORIGIN}/join/${token}` : null,
    };
  });


/** Rotate the token, invalidating the old link (admin only). */
export const regeneratePracticeJoinToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const ctx = await resolvePractitionerPracticeId(admin, context.userId);
    if (!ctx || !ctx.isOwner) {
      return { ok: false as const, error: "Only the practice admin can reset the sign-up link." };
    }
    const token = newToken();
    const { error } = await admin
      .from("practices")
      .update({ join_token: token })
      .eq("id", ctx.practiceId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, url: `${SITE_ORIGIN}/join/${token}` };
  });
