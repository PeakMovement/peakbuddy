import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const updateClientPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ phone: z.string().max(30).nullable() }).parse(data),
  )
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
  .inputValidator((data) =>
    z.object({ phone: z.string().max(30).nullable() }).parse(data),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      phone: data.phone ?? "",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Updates the signed-in user's email. Works for both practitioners and clients.
// Also mirrors the email onto the clients row when one exists for this user.
export const updateMyEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ email: z.string().email().max(254) }).parse(data))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.trim().toLowerCase();

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      email,
      email_confirm: true,
    });
    if (authError) throw new Error(authError.message);

    // Best-effort mirror to clients.email if this user is a client.
    await supabaseAdmin
      .from("clients")
      .update({ email })
      .eq("auth_user_id", context.userId);

    return { ok: true, email };
  });
