import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const countActiveWearableConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<number> => {
    const { supabase, userId } = context;

    // Get the practitioner's client IDs
    const { data: clients, error: cErr } = await supabase
      .from("clients")
      .select("id")
      .eq("practitioner_id", userId);

    if (cErr) throw cErr;
    if (!clients || clients.length === 0) return 0;

    const clientIds = clients.map((c) => c.id);

    // Count distinct clients with at least one active wearable token
    const { data: tokens, error: tErr } = await supabase
      .from("wearable_tokens")
      .select("client_id")
      .in("client_id", clientIds)
      .eq("status", "active");

    if (tErr) throw tErr;
    if (!tokens || tokens.length === 0) return 0;

    const distinct = new Set(tokens.map((t) => t.client_id));
    return distinct.size;
  });
