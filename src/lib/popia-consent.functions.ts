import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Whether the calling client has accepted POPIA (drives the first-run gate). */
export const getPopiaStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ accepted: boolean }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("clients")
      .select("popia_accepted")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error("Could not verify POPIA consent");
    // Fail closed: missing client row or a false/null flag both block the app.
    return { accepted: data?.popia_accepted === true };
  });

/** Record POPIA acceptance for the calling client (their own record only). */
export const acceptPopiaConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("clients")
      .update({ popia_accepted: true, popia_accepted_at: new Date().toISOString() })
      .eq("auth_user_id", context.userId)
      .select("id")
      .maybeSingle();
    if (error || !data) throw new Error("Could not save POPIA consent");
    return { ok: true as const };
  });
