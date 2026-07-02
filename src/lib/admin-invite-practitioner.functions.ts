import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  fullName: z.string().trim().min(1).max(120),
  profession: z.string().trim().min(1).max(80),
  practiceName: z.string().trim().max(120).optional().default(""),
});

const SITE_ORIGIN = "https://peakbuddy.lovable.app";

export const adminInvitePractitioner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => inputSchema.parse(i))
  .handler(async ({ data, context }) => {
    // Authorise: super admin only.
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("is_super_admin", {
      _uid: context.userId,
    });
    if (roleErr) return { ok: false as const, error: roleErr.message };
    if (!isAdmin) return { ok: false as const, error: "Forbidden" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Look up existing auth user by email.
    const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = list?.users.find((u) => u.email?.toLowerCase() === data.email);

    let userId: string | null = existing?.id ?? null;

    if (!existing) {
      const { data: invited, error: inviteErr } =
        await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
          data: { full_name: data.fullName, role: "practitioner" },
          redirectTo: `${SITE_ORIGIN}/practitioner/login`,
        });
      if (inviteErr || !invited?.user) {
        return { ok: false as const, error: inviteErr?.message ?? "Failed to send invite." };
      }
      userId = invited.user.id;
    }

    if (!userId) return { ok: false as const, error: "Could not resolve user." };

    // Upsert profile with practitioner role + full name.
    const { error: profErr } = await supabaseAdmin.from("profiles").upsert(
      {
        id: userId,
        role: "practitioner",
        full_name: data.fullName,
        profession: data.profession,
      },
      { onConflict: "id" },
    );
    if (profErr) return { ok: false as const, error: profErr.message };

    // Create practice row — pre-approved because super admin invited them.
    const { error: prErr } = await supabaseAdmin.from("practices").upsert(
      {
        practitioner_id: userId,
        practice_name: data.practiceName || "",
        profession: data.profession,
        onboarding_complete: false,
        is_approved: true,
      },
      { onConflict: "practitioner_id", ignoreDuplicates: true },
    );
    if (prErr) return { ok: false as const, error: prErr.message };

    return { ok: true as const, userId, alreadyExisted: Boolean(existing) };
  });
