import { createServerFn } from "@tanstack/react-start";

export const getClientYvesAccess = createServerFn({ method: "POST" })
  .inputValidator((data: { clientId: string }) => {
    if (!data?.clientId || typeof data.clientId !== "string") {
      throw new Error("clientId is required");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: c, error: cErr } = await supabaseAdmin
      .from("clients")
      .select("practitioner_id, yves_enabled")
      .eq("id", data.clientId)
      .maybeSingle();

    if (cErr || !c) {
      return {
        practiceYvesEnabled: true,
        clientYvesEnabled: true,
        practitionerId: null as string | null,
      };
    }

    let practiceYvesEnabled = true;
    if (c.practitioner_id) {
      const { data: p } = await supabaseAdmin
        .from("practices")
        .select("yves_enabled")
        .eq("practitioner_id", c.practitioner_id)
        .maybeSingle();
      if (p && p.yves_enabled === false) practiceYvesEnabled = false;
    }

    return {
      practiceYvesEnabled,
      clientYvesEnabled: c.yves_enabled !== false,
      practitionerId: (c.practitioner_id as string | null) ?? null,
    };
  });
