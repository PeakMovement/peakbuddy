/**
 * Weekly backup of WhatsApp conversations to Peak Movement's private Google
 * Drive, through Lovable's Google Drive connector.
 *
 * Layout in Drive (created by this app on first run, so the connector's
 * drive.file scope can write to it):
 *   Buddy WhatsApp Backups / 2026-10-05 to 2026-10-11 / <Patient name> (<id>).txt
 *
 * One file per patient per week, holding that week's messages both ways in
 * time order. A week already backed up for a patient is skipped, so re-runs
 * are safe.
 *
 * Only patients whose current WhatsApp consent covers the backup (version
 * 2026-10-07.1 or later, not withdrawn) are included. Message text is never
 * logged.
 */
import { log } from "@/lib/log";
import { currentConsent } from "@/lib/consent/wording";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";
export const ROOT_FOLDER = "Buddy WhatsApp Backups";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface DriveEnv {
  lovableKey: string;
  connectionKey: string;
  fetch: typeof fetch;
}

export function driveEnvFromProcess(): DriveEnv | null {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connectionKey = process.env.GOOGLE_DRIVE_API_KEY;
  if (!lovableKey || !connectionKey) return null;
  return { lovableKey, connectionKey, fetch: (...a) => fetch(...a) };
}

function headers(env: DriveEnv, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${env.lovableKey}`,
    "X-Connection-Api-Key": env.connectionKey,
    ...extra,
  };
}

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function findChild(
  env: DriveEnv,
  name: string,
  parentId: string | null,
  mime?: string,
): Promise<string | null> {
  const clauses = [`name = '${q(name)}'`, "trashed = false"];
  if (parentId) clauses.push(`'${q(parentId)}' in parents`);
  if (mime) clauses.push(`mimeType = '${mime}'`);
  const url = `${GATEWAY}/drive/v3/files?q=${encodeURIComponent(clauses.join(" and "))}&fields=files(id)&pageSize=1`;
  const r = await env.fetch(url, { headers: headers(env) });
  if (!r.ok) throw new Error(`Drive search failed [${r.status}]`);
  const j = (await r.json()) as { files?: Array<{ id: string }> };
  return j.files?.[0]?.id ?? null;
}

async function createFolder(env: DriveEnv, name: string, parentId: string | null): Promise<string> {
  const r = await env.fetch(`${GATEWAY}/drive/v3/files?fields=id`, {
    method: "POST",
    headers: headers(env, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!r.ok) throw new Error(`Drive folder create failed [${r.status}]`);
  return ((await r.json()) as { id: string }).id;
}

async function ensureFolder(env: DriveEnv, name: string, parentId: string | null): Promise<string> {
  return (await findChild(env, name, parentId, FOLDER_MIME)) ?? createFolder(env, name, parentId);
}

async function uploadText(env: DriveEnv, name: string, parentId: string, text: string) {
  const boundary = "buddy_backup_boundary";
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name, mimeType: "text/plain", parents: [parentId] }) +
    `\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n` +
    text +
    `\r\n--${boundary}--`;
  const r = await env.fetch(`${GATEWAY}/upload/drive/v3/files?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: headers(env, { "Content-Type": `multipart/related; boundary=${boundary}` }),
    body,
  });
  if (!r.ok) throw new Error(`Drive upload failed [${r.status}]`);
}

/* ------------------------------------------------------------------ */

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

/** The Monday to Sunday (SAST) week before `now`. */
export function previousWeek(now: Date): { start: Date; end: Date; label: string } {
  const sast = new Date(now.getTime() + SAST_OFFSET_MS);
  const dow = (sast.getUTCDay() + 6) % 7; // Monday = 0
  const thisMonday = Date.UTC(sast.getUTCFullYear(), sast.getUTCMonth(), sast.getUTCDate() - dow);
  const startSast = thisMonday - 7 * 86_400_000;
  const start = new Date(startSast - SAST_OFFSET_MS);
  const end = new Date(thisMonday - SAST_OFFSET_MS);
  const d = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { start, end, label: `${d(startSast)} to ${d(thisMonday - 86_400_000)}` };
}

function sastTime(iso: string): string {
  return new Date(new Date(iso).getTime() + SAST_OFFSET_MS)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
}

export interface BackupLine {
  at: string;
  who: "Patient" | "Buddy";
  text: string;
}

export function renderTranscript(name: string, weekLabel: string, lines: BackupLine[]): string {
  const head = [
    `Buddy WhatsApp conversation: ${name}`,
    `Week: ${weekLabel} (times are South African time)`,
    "Confidential patient record. Peak Movement (Pty) Ltd.",
    "",
  ];
  const body = [...lines]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((l) => `[${sastTime(l.at)}] ${l.who}: ${l.text}`);
  return [...head, ...body, ""].join("\n");
}

export interface BackupResult {
  ok: boolean;
  reason?: string;
  week?: string;
  patients: number;
  uploaded: number;
  skipped: number;
}

export async function runWeeklyDriveBackup(
  admin: Admin,
  now: Date = new Date(),
  env: DriveEnv | null = driveEnvFromProcess(),
): Promise<BackupResult> {
  if (!env)
    return {
      ok: false,
      reason: "drive connector not linked",
      patients: 0,
      uploaded: 0,
      skipped: 0,
    };
  const week = previousWeek(now);
  const from = week.start.toISOString();
  const to = week.end.toISOString();

  const [{ data: inbound }, { data: outbound }] = await Promise.all([
    admin
      .from("whatsapp_inbound")
      .select("*")
      .gte("received_at", from)
      .lt("received_at", to)
      .not("client_id", "is", null)
      .limit(20000),
    admin
      .from("whatsapp_outbound")
      .select("client_id, body, created_at, sent_ok")
      .gte("created_at", from)
      .lt("created_at", to)
      .not("client_id", "is", null)
      .limit(20000),
  ]);

  const byClient = new Map<string, BackupLine[]>();
  const add = (id: string, line: BackupLine) => {
    const list = byClient.get(id) ?? [];
    list.push(line);
    byClient.set(id, list);
  };
  for (const r of (inbound ?? []) as Array<Record<string, unknown>>) {
    const text =
      (r.transcript as string | undefined) ||
      (r.body as string | undefined) ||
      (r.reply_title as string | undefined) ||
      `[${String(r.kind ?? "message")}]`;
    add(String(r.client_id), { at: String(r.received_at), who: "Patient", text });
  }
  for (const r of (outbound ?? []) as Array<Record<string, unknown>>) {
    if (r.sent_ok === false) continue;
    add(String(r.client_id), {
      at: String(r.created_at),
      who: "Buddy",
      text: String(r.body ?? ""),
    });
  }
  if (byClient.size === 0) {
    return { ok: true, week: week.label, patients: 0, uploaded: 0, skipped: 0 };
  }

  // Only patients who agreed to the backup (current WhatsApp consent, not withdrawn).
  const minVersion = currentConsent("whatsapp_checkins").version;
  const ids = [...byClient.keys()];
  const [{ data: consents }, { data: clients }] = await Promise.all([
    admin
      .from("consent_records")
      .select("client_id, version")
      .in("client_id", ids)
      .eq("consent_type", "whatsapp_checkins")
      .is("withdrawn_at", null)
      .gte("version", minVersion),
    admin.from("clients").select("id, full_name").in("id", ids),
  ]);
  const covered = new Set(
    ((consents ?? []) as Array<{ client_id: string }>).map((c) => c.client_id),
  );
  const names = new Map(
    ((clients ?? []) as Array<{ id: string; full_name: string | null }>).map((c) => [
      c.id,
      (c.full_name ?? "Patient").replace(/[\\/:*?"<>|]/g, " ").trim() || "Patient",
    ]),
  );

  const root = await ensureFolder(env, ROOT_FOLDER, null);
  const weekFolder = await ensureFolder(env, week.label, root);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  for (const [clientId, lines] of byClient) {
    if (!covered.has(clientId)) {
      skipped++;
      continue;
    }
    const name = names.get(clientId) ?? "Patient";
    const fileName = `${name} (${clientId.slice(0, 8)}).txt`;
    try {
      if (await findChild(env, fileName, weekFolder)) {
        skipped++;
        continue;
      }
      await uploadText(env, fileName, weekFolder, renderTranscript(name, week.label, lines));
      uploaded++;
    } catch (e) {
      failed++;
      log.warn("whatsapp drive backup: upload failed", {
        client: clientId.slice(0, 8),
        error: e instanceof Error ? e.message : "unknown",
      });
    }
  }
  return {
    ok: failed === 0,
    ...(failed ? { reason: `${failed} upload(s) failed` } : {}),
    week: week.label,
    patients: byClient.size,
    uploaded,
    skipped,
  };
}
