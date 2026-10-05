import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { WearableProvider } from "./connect.functions";

/**
 * PUBLIC on purpose: the /connect-watch page is opened from a WhatsApp link by
 * a patient with no Buddy login. The signed, expiring token in the link is the
 * only key, and it only ever reaches that one profile. See watch-link.server.ts.
 */

const PROVIDERS = ["garmin", "oura", "polar"] as const;
const tokenSchema = z.string().min(40).max(200);

export const getWatchLinkDetails = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: tokenSchema }).parse(d))
  .handler(async ({ data }) => {
    const { verifyWatchToken } = await import("./watch-link.server");
    const clientId = await verifyWatchToken(data.token);
    if (!clientId) return { ok: false as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: client }, { data: tokens }] = await Promise.all([
      supabaseAdmin.from("clients").select("full_name").eq("id", clientId).maybeSingle(),
      supabaseAdmin.from("wearable_tokens").select("provider, status").eq("client_id", clientId),
    ]);
    if (!client) return { ok: false as const };
    const connected = (tokens ?? [])
      .filter((t) => t.status === "active")
      .map((t) => t.provider as WearableProvider);
    const firstName = ((client.full_name as string | null) ?? "").trim().split(/\s+/)[0] || "there";
    return { ok: true as const, firstName, connected };
  });

export const startWatchLinkConnect = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ token: tokenSchema, provider: z.enum(PROVIDERS) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { verifyWatchToken } = await import("./watch-link.server");
    const clientId = await verifyWatchToken(data.token);
    if (!clientId) return { ok: false as const, error: "This link has expired." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { beginWearableConnect } = await import("./connect.server");
    try {
      const authUrl = await beginWearableConnect(supabaseAdmin, clientId, data.provider);
      return { ok: true as const, authUrl };
    } catch {
      return { ok: false as const, error: "Couldn't start the connection. Please try again." };
    }
  });

/** After a Garmin connect: ask Garmin for recent history (it arrives by webhook). */
export const syncAfterWatchConnect = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ token: tokenSchema, provider: z.enum(PROVIDERS) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { verifyWatchToken } = await import("./watch-link.server");
    const clientId = await verifyWatchToken(data.token);
    if (!clientId || data.provider !== "garmin") return { ok: false as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncGarminForClient } = await import("./sync.functions");
    try {
      await syncGarminForClient(supabaseAdmin, clientId);
      return { ok: true as const };
    } catch {
      return { ok: false as const };
    }
  });
