/**
 * Build, link, and send a copy of one patient's Buddy record.
 * The link is single use. Heidi notes are not loaded. Tokens are not logged.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import { appBaseUrl } from "@/lib/app-url";
import { assembleExport, exportCounts, type ExportBundle } from "@/lib/data-export-bundle";
import { sha256Hex } from "./onboarding.server";
import { windowOpen, sendLogged } from "./practitioner-status.server";
import type { ProviderSecrets, WhatsAppProvider } from "./provider";

type Admin = SupabaseClient;

const LINK_MS = 48 * 60 * 60 * 1000;

function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const CLIENT_EXPORT_COLS =
  "id, full_name, email, phone, primary_complaint, notes, goal, created_at, popia_accepted_at, yves_ai_consent, yves_ai_consent_at, practitioner_id, discharged_at, next_appointment";

export async function loadExportBundle(admin: Admin, clientIds: string[]): Promise<ExportBundle> {
  const ids = [...new Set(clientIds)].filter(Boolean);
  const empty = assembleExport({
    generatedAt: new Date().toISOString(),
    clients: [],
    checkIns: [],
    consents: [],
    whatsappInbound: [],
    whatsappOutbound: [],
    wearableDays: [],
    exerciseMedia: [],
    reception: [],
  });
  if (!ids.length) return empty;

  const { data: clients, error } = await admin
    .from("clients")
    .select(CLIENT_EXPORT_COLS)
    .in("id", ids);
  if (error) {
    log.warn("data export client read failed", { code: error.code });
    const slim = await admin
      .from("clients")
      .select("id, full_name, email, phone, primary_complaint, notes, created_at, practitioner_id")
      .in("id", ids);
    if (slim.error || !slim.data) return empty;
    return finish(admin, (slim.data ?? []) as Array<Record<string, unknown>>);
  }
  return finish(admin, (clients ?? []) as Array<Record<string, unknown>>);
}

async function finish(admin: Admin, clients: Array<Record<string, unknown>>): Promise<ExportBundle> {
  const ids = clients.map((c) => String(c.id));
  const [checkIns, consents, inbound, outbound, wear, media] = await Promise.all([
    admin
      .from("check_ins")
      .select(
        "id, client_id, created_at, pain_level, sleep_quality, energy_level, stress_level, mood, notes, flagged, source, exercise_adherence",
      )
      .in("client_id", ids),
    admin
      .from("consent_records")
      .select("id, client_id, consent_type, version, wording_snapshot, channel, accepted_at, withdrawn_at")
      .in("client_id", ids),
    admin
      .from("whatsapp_inbound")
      .select("id, client_id, received_at, kind, body")
      .in("client_id", ids),
    admin.from("whatsapp_outbound").select("id, client_id, created_at, kind, body, sent_ok").in("client_id", ids),
    admin
      .from("wearable_sessions")
      .select("id, client_id, date, source, session_type, duration_minutes, sleep_score, resting_hr, hrv_avg")
      .in("client_id", ids),
    admin
      .from("client_exercise_media")
      .select("id, client_id, media_kind, caption, created_at")
      .in("client_id", ids),
  ]);

  const reception: unknown[] = [];
  for (const client of clients) {
    const name = String(client.full_name ?? "").trim();
    const practitionerId = String(client.practitioner_id ?? "");
    if (!name || !practitionerId) continue;
    const { data } = await admin
      .from("reception_requests")
      .select("id, request_text, last_reply, created_at, status")
      .eq("practitioner_id", practitionerId)
      .limit(200);
    for (const row of (data ?? []) as Array<{ request_text?: string; last_reply?: string }>) {
      const blob = `${row.request_text ?? ""} ${row.last_reply ?? ""}`.toLowerCase();
      if (blob.includes(name.toLowerCase())) reception.push(row);
    }
  }

  const list = (result: { data: unknown[] | null; error: { code?: string } | null }) =>
    result.error ? [] : (result.data ?? []);

  return assembleExport({
    generatedAt: new Date().toISOString(),
    clients,
    checkIns: list(checkIns as never),
    consents: list(consents as never),
    whatsappInbound: list(inbound as never),
    whatsappOutbound: list(outbound as never),
    wearableDays: list(wear as never),
    exerciseMedia: list(media as never),
    reception,
  });
}

export function exportLinkUrl(rawToken: string): string {
  return `${appBaseUrl()}/api/public/data-export/${rawToken}`;
}

export async function mintExportLink(
  admin: Admin,
  clientId: string,
  practitionerId: string,
  now = new Date(),
): Promise<{ url: string } | null> {
  const raw = token();
  const { error } = await admin.from("data_export_links").insert({
    token_hash: await sha256Hex(raw),
    client_id: clientId,
    practitioner_id: practitionerId,
    expires_at: new Date(now.getTime() + LINK_MS).toISOString(),
  });
  if (error) {
    log.warn("data export link not minted", { code: error.code });
    return null;
  }
  return { url: exportLinkUrl(raw) };
}

/** Spend the link and return the file. Null when it is unknown, spent, or expired. */
export async function claimExportDownload(admin: Admin, rawToken: string): Promise<ExportBundle | null> {
  if (!rawToken || rawToken.length < 20 || rawToken.length > 120) return null;
  const hash = await sha256Hex(rawToken);
  const now = new Date().toISOString();
  const { data } = await admin
    .from("data_export_links")
    .select("id, client_id, expires_at, downloaded_at")
    .eq("token_hash", hash)
    .maybeSingle();
  const row = data as { id: string; client_id: string; expires_at: string; downloaded_at: string | null } | null;
  if (!row || row.downloaded_at || row.expires_at <= now) return null;
  const { data: spent } = await admin
    .from("data_export_links")
    .update({ downloaded_at: now })
    .eq("id", row.id)
    .is("downloaded_at", null)
    .select("id")
    .maybeSingle();
  if (!spent) return null;
  return loadExportBundle(admin, [row.client_id]);
}

export async function sendExportLink(
  admin: Admin,
  env: { provider: WhatsAppProvider; secrets: ProviderSecrets },
  clientId: string,
  url: string,
  now: Date,
): Promise<"sent" | "window_closed" | "no_phone" | "failed"> {
  const { data: conv } = await admin
    .from("whatsapp_conversations")
    .select("phone")
    .eq("client_id", clientId)
    .limit(1);
  const phone = (conv as Array<{ phone?: string }> | null)?.[0]?.phone;
  if (!phone) return "no_phone";
  const open = await windowOpen(admin, phone, now);
  if (!open) return "window_closed";
  const body = `Here is a copy of what Buddy holds about you. The link works once, then it expires.\n\n${url}`;
  const ok = await sendLogged(admin, env, { kind: "text", to: phone, body }, "[data copy link]");
  return ok ? "sent" : "failed";
}

export function exportReadyNote(name: string, counts: string, sent: string): string {
  if (sent === "sent") return `Sent ${name} a one-time link. ${counts}.`;
  if (sent === "window_closed" || sent === "no_phone") {
    return `${name}'s copy is ready (${counts}). Their WhatsApp window is closed, so I did not message them. Please email it.`;
  }
  return `The copy is ready (${counts}). I could not send the link just now.`;
}

export { exportCounts };
