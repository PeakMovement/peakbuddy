import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * The WhatsApp conversation between Buddy and one patient, for the
 * practitioner's client page. Both tables are service-role only, so this is
 * the single way a practitioner sees them, and it checks they may access the
 * client first (own client, practice owner, or super admin).
 */

export interface TranscriptLine {
  at: string;
  from: "patient" | "buddy";
  text: string;
  failed?: boolean;
}

export const getWhatsAppTranscript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ clientId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ lines: TranscriptLine[]; linked: boolean }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { canAccessClient } = await import("@/lib/practice-members.functions");
    const access = await canAccessClient(supabaseAdmin, context.userId, data.clientId);
    if (!access.allowed) throw new Error("Not authorized");

    const db = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;
    const [inbound, outbound] = await Promise.all([
      db
        .from("whatsapp_inbound")
        .select("received_at, body, reply_title, kind, status")
        .eq("client_id", data.clientId)
        .neq("status", "ignored")
        .order("received_at", { ascending: false })
        .limit(80),
      db
        .from("whatsapp_outbound")
        .select("created_at, body, sent_ok")
        .eq("client_id", data.clientId)
        .order("created_at", { ascending: false })
        .limit(80),
    ]);

    const lines: TranscriptLine[] = [
      ...(
        (inbound.data ?? []) as Array<{
          received_at: string;
          body: string | null;
          reply_title: string | null;
          kind: string;
        }>
      ).map((r) => ({
        at: r.received_at,
        from: "patient" as const,
        text: r.body || r.reply_title || (r.kind === "media" ? "[media]" : ""),
      })),
      // whatsapp_outbound arrives with migration 0014; until then this is empty.
      ...(
        (outbound.error ? [] : (outbound.data ?? [])) as Array<{
          created_at: string;
          body: string;
          sent_ok: boolean;
        }>
      ).map((r) => ({
        at: r.created_at,
        from: "buddy" as const,
        text: r.body,
        failed: r.sent_ok === false || undefined,
      })),
    ]
      .filter((l) => l.text)
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(-120);

    return { lines, linked: lines.length > 0 };
  });
