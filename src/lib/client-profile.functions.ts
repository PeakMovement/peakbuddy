import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const updateClientPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ phone: z.string().max(30).nullable() }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("clients")
      .update({ phone: data.phone })
      .eq("auth_user_id", context.userId);

    if (error) throw error;
    return { ok: true };
  });

// Updates the practitioner's phone number (stored on the auth user record).
export const updatePractitionerPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ phone: z.string().max(30).nullable() }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      phone: data.phone ?? "",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const EMAIL_TAKEN_MESSAGE =
  "That email is already linked to another account. Please contact your practice if you need it changed.";

/**
 * Checks and (when safe) records an email change for the signed-in user.
 * Works for both practitioners and clients.
 *
 * This never changes the login email itself. It used to set the new address
 * straight onto the auth user as already confirmed, which let anyone claim a
 * patient's address (and, through the old database triggers, their record).
 * Now it only:
 *  - refuses an address that belongs to another login or to any patient record
 *    that is not already this user's own;
 *  - returns pending: true so the browser starts Supabase's own email change,
 *    which only takes effect once the new address is confirmed from its inbox;
 *  - when the requested address is already this user's confirmed login email
 *    (the change has gone through), mirrors it onto their own clients row.
 */
export const updateMyEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ email: z.string().email().max(254) }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.trim().toLowerCase();

    const { data: me, error: meErr } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    if (meErr || !me?.user) throw new Error("Could not load your account. Please try again.");
    const currentEmail = me.user.email?.toLowerCase() ?? null;

    // Any patient record carrying this address must already be the caller's own.
    const { data: rows, error: rowsErr } = await supabaseAdmin
      .from("clients")
      .select("id, auth_user_id")
      .ilike("email", email);
    if (rowsErr) throw new Error("Could not check that email. Please try again.");
    if (
      (rows ?? []).some(
        (r) => (r as { auth_user_id: string | null }).auth_user_id !== context.userId,
      )
    ) {
      throw new Error(EMAIL_TAKEN_MESSAGE);
    }

    if (email === currentEmail) {
      // Already this user's login email. Only mirror it once it is confirmed.
      if (me.user.email_confirmed_at) {
        await supabaseAdmin.from("clients").update({ email }).eq("auth_user_id", context.userId);
      }
      return { ok: true as const, email, pending: false as const };
    }

    const { findAuthUserIdByEmail } = await import("@/lib/find-auth-user");
    const owner = await findAuthUserIdByEmail(supabaseAdmin, email);
    if (owner && owner !== context.userId) throw new Error(EMAIL_TAKEN_MESSAGE);

    return { ok: true as const, email, pending: true as const };
  });
