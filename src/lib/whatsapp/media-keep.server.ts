/**
 * A photo or short video a patient sends on WhatsApp is downloaded straight
 * away and filed as a session report for that patient, so the physio sees it
 * where they already look, and Yves can read it with the rest. WhatsApp's
 * own media links expire, so keeping only the id loses the picture.
 *
 * Buddy never comments on the picture itself. The physio gets a push.
 */
import { log } from "@/lib/log";
import type { WhatsAppProvider, ProviderSecrets } from "./provider";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

const MAX_BYTES = 15 * 1024 * 1024;
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
};

export async function keepWhatsAppMedia(
  admin: Admin,
  env: { provider: WhatsAppProvider; secrets: ProviderSecrets },
  input: {
    client: {
      id: string;
      practitioner_id: string;
      practice_id: string | null;
      full_name: string | null;
    };
    mediaId: string;
    kind: "image" | "video";
    caption: string | null;
    now: Date;
  },
): Promise<boolean> {
  if (!env.provider.fetchMedia) return false;
  const media = await env.provider.fetchMedia(input.mediaId, env.secrets).catch(() => null);
  if (!media || media.bytes.byteLength === 0 || media.bytes.byteLength > MAX_BYTES) return false;
  const mime = media.mimeType.split(";")[0].trim().toLowerCase();
  const ext = EXT[mime] ?? (input.kind === "image" ? "jpg" : "mp4");
  const day = input.now.toISOString().slice(0, 10);
  const path = `${input.client.id}/whatsapp-${day}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const { REPORTS_BUCKET } = await import("@/lib/session-reports.functions");
  const up = await admin.storage
    .from(REPORTS_BUCKET)
    .upload(path, media.bytes, { contentType: mime, upsert: false });
  if (up.error) {
    log.warn("whatsapp media keep: upload failed", { kind: input.kind });
    return false;
  }
  const label = input.kind === "image" ? "photo" : "video";
  const when = input.now.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  });
  const caption = (input.caption ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const { error } = await admin.from("session_reports").insert({
    client_id: input.client.id,
    practice_id: input.client.practice_id,
    uploaded_by: null,
    file_name: `WhatsApp ${label} ${when}${caption ? `: ${caption}` : ""}.${ext}`,
    mime_type: mime,
    size_bytes: media.bytes.byteLength,
    storage_path: path,
  });
  if (error) {
    log.warn("whatsapp media keep: report row failed", { code: error.code });
    return false;
  }
  try {
    const { sendPushCore } = await import("@/lib/push.functions");
    const first =
      String(input.client.full_name ?? "")
        .trim()
        .split(/\s+/)[0] || "A patient";
    await sendPushCore(admin, {
      userId: input.client.practitioner_id,
      title: "Buddy",
      body: `${first} sent a ${label} on WhatsApp. It's in their reports.`,
      data: { clientId: input.client.id, kind: "whatsapp_media" },
    });
  } catch {
    /* the report row is the record */
  }
  return true;
}
