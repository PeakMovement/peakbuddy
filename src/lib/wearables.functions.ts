import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const countActiveWearableConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<number> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listAccessibleClientIds } = await import("@/lib/practice-members.functions");
    const clientIds = await listAccessibleClientIds(supabaseAdmin, userId);
    if (clientIds.length === 0) return 0;

    const { data: tokens, error: tErr } = await supabaseAdmin
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
 * practitioner's visible clients. Empty map when none are connected.
 */
export const getPractitionerClientWearables = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Record<string, string[]>> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listAccessibleClientIds } = await import("@/lib/practice-members.functions");
    const clientIds = await listAccessibleClientIds(supabaseAdmin, userId);
    if (clientIds.length === 0) return {};
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
