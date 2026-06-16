import { createServerFn } from "@tanstack/react-start";

export const setYvesAiConsent = createServerFn({ method: "POST" })
  .inputValidator((data: { clientId: string; consent: boolean }) => {
    if (!data?.clientId || typeof data.clientId !== "string") {
      throw new Error("clientId is required");
    }
    if (typeof data.consent !== "boolean") {
      throw new Error("consent must be a boolean");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
