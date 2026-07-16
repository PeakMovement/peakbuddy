import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const setYvesAiConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { clientId: string; consent: boolean }) => {
    if (!data?.clientId || typeof data.clientId !== "string") {
      throw new Error("clientId is required");
    }
    if (typeof data.consent !== "boolean") {
      throw new Error("consent must be a boolean");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Authz: the client themselves, their practitioner, or a super admin.
    const { data: c } = await supabaseAdmin
      .from("clients")
      .select("auth_user_id, practitioner_id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!c) return { ok: false as const, error: "Client not found." };
    let allowed = c.auth_user_id === context.userId || c.practitioner_id === context.userId;
    if (!allowed) {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", context.userId)
        .maybeSingle();
      allowed = prof?.role === "super_admin";
    }
    if (!allowed) return { ok: false as const, error: "Forbidden." };

    const { error } = await supabaseAdmin
      .from("clients")
      .update({
        yves_ai_consent: data.consent,
        yves_ai_consent_at: data.consent ? new Date().toISOString() : null,
      })
      .eq("id", data.clientId);
    if (error) {
      return { ok: false as const, error: error.message };
    }
    return { ok: true as const };
  });
