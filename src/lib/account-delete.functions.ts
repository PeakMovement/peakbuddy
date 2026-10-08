import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Self-service account deletion (Apple App Store Guideline 5.1.1(v)).
 *
 * Works for both account types that can self-register in-app:
 *  - Patients (clients): their client row is removed, then their auth user.
 *  - Practitioners: deleting the auth user cascades to their practice,
 *    profile, clients, check-ins and alerts via FK constraints.
 *
 * The caller can only ever delete THEIR OWN account — the user id comes from
 * the validated bearer token, never from client-supplied input.
 */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Remove any patient (client) record tied to this user first so nothing is
    // left orphaned if the FK does not cascade from the auth user.
    const { error: cByIdErr } = await supabaseAdmin
      .from("clients")
      .delete()
      .eq("auth_user_id", userId);
    if (cByIdErr) {
      return { ok: false as const, error: cByIdErr.message };
    }
    // Deliberately NOT deleting by email as well: an email address is not proof
    // of identity, and matching on it could remove another patient's record.

    // Delete the auth user. For practitioners this cascades to practices,
    // profiles, clients, check_ins and alerts.
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      return { ok: false as const, error: error.message };
    }

    return { ok: true as const };
  });
