import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { deleteConnection, resolveClientId } from "./tokens";

export type WearableProvider = "oura" | "polar" | "garmin";
const PROVIDERS: WearableProvider[] = ["oura", "polar", "garmin"];

export type ConnectionStatus = {
  provider: WearableProvider;
  connected: boolean;
  status: "active" | "token_expired" | "disconnected";
};

/** Connection status per provider for the logged-in client (drives the UI). */
export const getWearableConnections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConnectionStatus[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const clientId = await resolveClientId(supabaseAdmin, context.userId);
    if (!clientId)
      return PROVIDERS.map((p) => ({ provider: p, connected: false, status: "disconnected" }));

    const { data } = await supabaseAdmin
      .from("wearable_tokens")
      .select("provider, status")
      .eq("client_id", clientId);
    const byProvider = new Map((data ?? []).map((r) => [r.provider, r.status]));

    return PROVIDERS.map((p) => {
      const status = byProvider.get(p);
      return {
        provider: p,
        connected: status === "active",
        status: (status as ConnectionStatus["status"]) ?? "disconnected",
      };
    });
  });

/** Begin an OAuth connect: returns the provider authorize URL to redirect to. */
export const connectWearable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { provider: WearableProvider }) => {
    if (!data?.provider || !PROVIDERS.includes(data.provider)) {
      throw new Error("Invalid provider");
    }
    return data;
  })
  .handler(async ({ data, context }): Promise<{ authUrl: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const clientId = await resolveClientId(supabaseAdmin, context.userId);
    if (!clientId) throw new Error("No client record for this account");

    const { beginWearableConnect } = await import("./connect.server");
    return { authUrl: await beginWearableConnect(supabaseAdmin, clientId, data.provider) };
  });

/** Disconnect a provider for the logged-in client. */
export const disconnectWearable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { provider: WearableProvider }) => {
    if (!data?.provider || !PROVIDERS.includes(data.provider)) {
      throw new Error("Invalid provider");
    }
    return data;
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const clientId = await resolveClientId(supabaseAdmin, context.userId);
    if (!clientId) throw new Error("No client record for this account");
    await deleteConnection(supabaseAdmin, clientId, data.provider);
    return { ok: true };
  });
