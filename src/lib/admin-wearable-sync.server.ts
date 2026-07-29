import { log } from "@/lib/log";
import {
  syncGarminForClient,
  syncOuraForClient,
  syncPolarForClient,
} from "@/lib/wearables/sync.functions";

export type AdminSyncProviderResult = {
  provider: string;
  ok: boolean;
  synced: number;
  /** Plain-English message for the admin. */
  message: string;
  /** True when the client themselves must act (open their wearable app / reconnect). */
  needsClientAction: boolean;
};

export type AdminSyncResult = {
  results: AdminSyncProviderResult[];
  /** Newest wearable_sessions date after the sync, if any. */
  latestDate: string | null;
};

/**
 * Pull fresh wearable data for one client on behalf of a super admin.
 * Never throws for a single provider — every provider reports its own outcome.
 */
export async function syncClientWearablesAsAdmin(clientId: string): Promise<AdminSyncResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: tokens } = await supabaseAdmin
    .from("wearable_tokens")
    .select("provider, status")
    .eq("client_id", clientId);

  // wearable_tokens.status is stored as "active" (never "connected"). Filtering
  // on "connected" made this always empty, so the admin sync never actually
  // re-requested a backfill. Match the real value.
  const connected = (tokens ?? []).filter((t) => t.status === "active");
  if (connected.length === 0) {
    return {
      results: [
        {
          provider: "none",
          ok: false,
          synced: 0,
          message: "No wearable is connected for this client — ask them to connect one in the app.",
          needsClientAction: true,
        },
      ],
      latestDate: null,
    };
  }

  const results: AdminSyncProviderResult[] = [];

  for (const t of connected) {
    const provider = t.provider;
    try {
      if (provider === "oura") {
        const { synced } = await syncOuraForClient(supabaseAdmin, clientId);
        results.push({
          provider,
          ok: true,
          synced,
          message:
            synced > 0
              ? `Oura returned ${synced} day(s) of data.`
              : "Oura returned no new data. The client needs to open the Oura app so their ring uploads to Oura's cloud first.",
          needsClientAction: synced === 0,
        });
      } else if (provider === "polar") {
        const { synced } = await syncPolarForClient(supabaseAdmin, clientId);
        results.push({
          provider,
          ok: true,
          synced,
          message:
            synced > 0
              ? `Polar returned ${synced} record(s).`
              : "Polar returned no new data. The client needs to open Polar Flow / Polar Beat and sync their band before anything is available to pull.",
          needsClientAction: synced === 0,
        });
      } else if (provider === "garmin") {
        await syncGarminForClient(supabaseAdmin, clientId);
        results.push({
          provider,
          ok: true,
          synced: 0,
          message:
            "Garmin backfill requested. Garmin pushes data to us asynchronously — it usually lands within a few minutes. If nothing arrives, the client must open Garmin Connect and sync their watch (and confirm Buddy under Connected Apps).",
          needsClientAction: true,
        });
      } else {
        results.push({
          provider,
          ok: false,
          synced: 0,
          message: `Unsupported provider "${provider}".`,
          needsClientAction: false,
        });
      }
    } catch (e) {
      log.warn(`admin sync failed (${provider}) for client ${clientId}`, e);
      const msg = e instanceof Error ? e.message : "Sync failed";
      if (/consent_required/.test(msg)) {
        results.push({
          provider,
          ok: false,
          synced: 0,
          message: `${provider}: the client has not granted data-sharing consent in their ${provider} account. They must approve Buddy in their wearable app.`,
          needsClientAction: true,
        });
      } else if (/invalid_grant|NO_TOKEN|401|403/i.test(msg)) {
        results.push({
          provider,
          ok: false,
          synced: 0,
          message: `${provider}: the connection has expired. The client needs to reconnect their device in the Buddy app.`,
          needsClientAction: true,
        });
      } else {
        results.push({
          provider,
          ok: false,
          synced: 0,
          message: `${provider}: ${msg}`,
          needsClientAction: false,
        });
      }
    }
  }

  const { data: latest } = await supabaseAdmin
    .from("wearable_sessions")
    .select("date")
    .eq("client_id", clientId)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return { results, latestDate: latest?.date ?? null };
}
