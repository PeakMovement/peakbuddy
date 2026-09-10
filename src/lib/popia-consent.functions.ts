import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Whether the calling client has accepted POPIA (drives the first-run gate). */
export const getPopiaStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ accepted: boolean }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("clients")
      .select("popia_accepted")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    // Fail safe: if we can't resolve the client, treat as accepted so we never
    // hard-lock someone out of the app over a lookup blip (the gate is a
    // consent record, not a security boundary).
    return { accepted: data ? data.popia_accepted === true : true };
  });

/** Record POPIA acceptance for the calling client (their own record only). */
export const acceptPopiaConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("clients")
      .update({ popia_accepted: true, popia_accepted_at: new Date().toISOString() })
      .eq("auth_user_id", context.userId)
      .eq("popia_accepted", false);
    return { ok: true as const };
  });
