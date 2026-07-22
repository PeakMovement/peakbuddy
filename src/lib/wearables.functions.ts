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

/**
 * Returns a map of clientId -> active wearable provider(s) for the calling
 * practitioner's clients. Empty map when none are connected.
 */
export const getPractitionerClientWearables = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Record<string, string[]>> => {
    const { supabase, userId } = context;

    const { data: clients, error: cErr } = await supabase
      .from("clients")
      .select("id")
      .eq("practitioner_id", userId);
    if (cErr) throw cErr;
    if (!clients || clients.length === 0) return {};

    const clientIds = clients.map((c) => c.id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: tokens, error: tErr } = await supabaseAdmin
      .from("wearable_tokens")
      .select("client_id, provider")
      .in("client_id", clientIds)
      .eq("status", "active");
    if (tErr) throw tErr;

    const out: Record<string, string[]> = {};
    for (const t of tokens ?? []) {
      const cid = t.client_id as string;
      const prov = t.provider as string;
      if (!out[cid]) out[cid] = [];
      if (!out[cid].includes(prov)) out[cid].push(prov);
    }
    return out;
  });
