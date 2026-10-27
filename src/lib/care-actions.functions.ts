import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BUDDY_FLAGS, patientFlag } from "@/lib/buddy-flags";

/**
 * Practitioner actions on the client page. Discharge and sending a copy
 * both confirm in the page before anything reaches the patient.
 */
export const setClientEpisode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ clientId: z.string().uuid(), discharged: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    if (!patientFlag(BUDDY_FLAGS.discharge)) {
      return { ok: false as const, reason: "off" as const };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { canAccessClient } = await import("@/lib/practice-members.functions");
    const access = await canAccessClient(supabaseAdmin, context.userId, data.clientId);
    if (!access.allowed) return { ok: false as const, reason: "denied" as const };
    const { setDischarged, tellDischargePaused } = await import("@/lib/whatsapp/care.server");
    const { whatsappConfigFromEnv } = await import("@/lib/whatsapp/worker.server");
    const admin = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;
    const now = new Date();
    const saved = await setDischarged(admin, data.clientId, data.discharged, now);
    if (!saved) return { ok: false as const, reason: "save" as const };
    if (!data.discharged) return { ok: true as const, told: "none" as const };
    const told = await tellDischargePaused(admin, whatsappConfigFromEnv(), data.clientId, now);
    return { ok: true as const, told };
  });

export const prepareClientCopy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ clientId: z.string().uuid(), send: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { canAccessClient } = await import("@/lib/practice-members.functions");
    const access = await canAccessClient(supabaseAdmin, context.userId, data.clientId);
    if (!access.allowed) return { ok: false as const, reason: "denied" as const };
    const { loadExportBundle, mintExportLink, sendExportLink, exportCounts, exportReadyNote } =
      await import("@/lib/whatsapp/data-copy.server");
    const admin = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;
    const bundle = await loadExportBundle(admin, [data.clientId]);
    const counts = exportCounts(bundle);
    if (!data.send) return { ok: true as const, sent: false as const, counts, bundle };
    if (!patientFlag(BUDDY_FLAGS.dataExportSend)) {
      return { ok: false as const, reason: "off" as const, counts };
    }
    const link = await mintExportLink(admin, data.clientId, context.userId);
    if (!link) return { ok: false as const, reason: "link" as const, counts };
    const { whatsappConfigFromEnv } = await import("@/lib/whatsapp/worker.server");
    const cfg = whatsappConfigFromEnv();
    const sent = cfg
      ? await sendExportLink(admin, cfg, data.clientId, link.url, new Date())
      : "window_closed";
    const { data: client } = await admin.from("clients").select("full_name").eq("id", data.clientId).maybeSingle();
    const name = String((client as { full_name?: string } | null)?.full_name ?? "They");
    return {
      ok: true as const,
      sent: true as const,
      how: sent,
      note: exportReadyNote(name, counts, sent),
      bundle,
    };
  });
