import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { latestStatusByMessage, outboundFailed } from "./transcript-delivery";

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

export const TRANSCRIPT_PAGE = 100;

export interface TranscriptPage {
  /** Oldest first, ready to render top to bottom. */
  lines: TranscriptLine[];
  linked: boolean;
  /** Pass as `before` to fetch the page older than this one; null when none. */
  nextBefore: string | null;
}

/**
 * Merge newest-first rows from both tables into one time-ordered page.
 * Each table is read with limit pageSize + 1, so if the merged set is longer
 * than a page there is definitely more history behind it.
 */
export function mergeTranscriptPage(
  inbound: TranscriptLine[],
  outbound: TranscriptLine[],
  pageSize: number = TRANSCRIPT_PAGE,
): { lines: TranscriptLine[]; hasMore: boolean } {
  const ts = (l: TranscriptLine) => Date.parse(l.at) || 0;
  const merged = [...inbound, ...outbound].sort((a, b) => ts(b) - ts(a));
  const page = merged.slice(0, pageSize);
  return { lines: page.reverse(), hasMore: merged.length > pageSize };
}

const isoTimestamp = z
  .string()
  .max(64)
  .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid timestamp");

export const getWhatsAppTranscript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ clientId: z.string().uuid(), before: isoTimestamp.optional() }).parse(i),
  )
  .handler(async ({ data, context }): Promise<TranscriptPage> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { canAccessClient } = await import("@/lib/practice-members.functions");
    const access = await canAccessClient(supabaseAdmin, context.userId, data.clientId);
    if (!access.allowed) throw new Error("Not authorized");

    const db = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;
    let inQ = db
      .from("whatsapp_inbound")
      .select("received_at, body, reply_title, kind, status")
      .eq("client_id", data.clientId)
      .neq("status", "ignored")
      .order("received_at", { ascending: false })
      .limit(TRANSCRIPT_PAGE + 1);
    let outQ = db
      .from("whatsapp_outbound")
      .select("created_at, body, sent_ok, provider_message_id")
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false })
      .limit(TRANSCRIPT_PAGE + 1);
    if (data.before) {
      inQ = inQ.lt("received_at", data.before);
      outQ = outQ.lt("created_at", data.before);
    }
    const [inbound, outbound] = await Promise.all([inQ, outQ]);
    if (inbound.error) throw new Error("Could not load the conversation");

    const inLines: TranscriptLine[] = (
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
    }));
    // whatsapp_outbound arrives with migration 0014; until then this is empty.
    const outRows = (
      outbound.error ? [] : (outbound.data ?? [])
    ) as Array<{
      created_at: string;
      body: string;
      sent_ok: boolean;
      provider_message_id: string | null;
    }>;
    const ids = outRows.map((r) => r.provider_message_id).filter((id): id is string => Boolean(id));
    let statusById = new Map<string, string>();
    if (ids.length) {
      const status = await db
        .from("whatsapp_message_status")
        .select("provider_message_id, status, occurred_at")
        .in("provider_message_id", ids);
      if (!status.error) {
        statusById = latestStatusByMessage(
          (status.data ?? []) as Array<{
            provider_message_id: string;
            status: string;
            occurred_at: string;
          }>,
        );
      }
    }
    const outLines: TranscriptLine[] = outRows.map((r) => ({
      at: r.created_at,
      from: "buddy" as const,
      text: r.body,
      failed:
        outboundFailed(r.sent_ok, r.provider_message_id ? statusById.get(r.provider_message_id) : null) ||
        undefined,
    }));

    const { lines: page, hasMore } = mergeTranscriptPage(inLines, outLines);
    // Cursor from the oldest row in the page (blank-text rows included) so the
    // next page starts exactly where this one stopped.
    const nextBefore = hasMore && page.length ? page[0].at : null;
    const lines = page.filter((l) => l.text);
    return { lines, linked: lines.length > 0 || !!data.before, nextBefore };
  });
