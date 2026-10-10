/**
 * Server-only Heidi reads for a practitioner WhatsApp command.
 *
 * Calls stay on the server. Nothing here writes clinical text to logs, to
 * patient_memory, or to a WhatsApp template. Request URLs are not logged:
 * they contain the practitioner email, the Buddy user id, and session ids.
 *
 * There is no patient-scoped session or document list. Discovery uses
 * GET /sessions/linked-user and keeps rows whose ehr_patient_id is this
 * client. If that list has no patient identifiers, only session ids already
 * stored for this practitioner and client are opened.
 */
import { log } from "@/lib/log";
import {
  buildHeidiSummary,
  heidiLinkUrl,
  heidiNoteDate,
  HEIDI_MSG,
  heidiPatientMatches,
  selectLinkedSessions,
  sessionPatientVerdict,
  uniqueProfileByName,
  type HeidiCommand,
  type HeidiDigestDoc,
  type HeidiPatient,
  type HeidiProfileName,
  type HeidiSessionDigest,
  type LinkedSessionRef,
} from "./heidi";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

const REGIONS = new Set(["au", "us", "uk", "eu", "ca"]);
const DETAIL_CAP = 3;
const LIST_SIZE = 20;

export interface HeidiConfig {
  apiKey: string;
  region: string;
  ehrProvider: string;
}

/** Null until all three secrets are set and the region is one Heidi publishes. */
export function heidiConfig(): HeidiConfig | null {
  const apiKey = process.env.HEIDI_API_KEY?.trim() ?? "";
  const region = process.env.HEIDI_REGION?.trim().toLowerCase() ?? "";
  const ehrProvider = process.env.HEIDI_EHR_PROVIDER?.trim() ?? "";
  if (!apiKey || !ehrProvider || !REGIONS.has(region)) return null;
  return { apiKey, region, ehrProvider };
}

interface CachedToken {
  token: string;
  exp: number;
}

const tokens = new Map<string, CachedToken>();

export function resetHeidiCache(): void {
  tokens.clear();
}

export interface HeidiTurnDeps {
  reply: (
    message:
      | { kind: "text"; body: string }
      | {
          kind: "list";
          body: string;
          buttonLabel: string;
          rows: Array<{ id: string; title: string }>;
        },
  ) => Promise<void>;
  now: Date;
}

function expiryMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now() + 10 * 60 * 1000;
}

function asArray(json: unknown, keys: string[]): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const row = json as Record<string, unknown>;
    for (const key of keys) {
      if (Array.isArray(row[key])) return row[key] as unknown[];
    }
  }
  return [];
}

function profilesFrom(json: unknown): HeidiProfileName[] {
  const profiles: HeidiProfileName[] = [];
  for (const item of asArray(json, ["data", "patient_profiles", "profiles"])) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id) continue;
    profiles.push({
      id: row.id,
      first_name: typeof row.first_name === "string" ? row.first_name : null,
      last_name: typeof row.last_name === "string" ? row.last_name : null,
    });
  }
  return profiles;
}

/** Step label and HTTP status only. Never the URL, body, or patient id. */
async function heidiGet(
  cfg: HeidiConfig,
  path: string,
  token: string | null,
  step: string,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { "Heidi-Api-Key": cfg.apiKey };
  if (token) headers.Authorization = `Bearer ${token}`;
  let status = 0;
  try {
    const res = await fetch(
      `https://${cfg.region}.api.heidihealth.com/api/v2/ml-scribe/open-api/${path}`,
      { method: "GET", headers },
    );
    status = res.status;
    if (status < 200 || status >= 300) {
      log.warn("heidi request failed", { step, status });
      return { status, json: null };
    }
    const json = await res.json().catch(() => null);
    return { status, json };
  } catch {
    log.warn("heidi request failed", { step, status });
    return { status, json: null };
  }
}

async function tokenFor(
  cfg: HeidiConfig,
  userId: string,
  email: string,
): Promise<{ token: string } | { error: "rejected" | "unreachable" }> {
  const cached = tokens.get(userId);
  if (cached && cached.exp - Date.now() > 30_000) return { token: cached.token };
  const q = new URLSearchParams({ email, third_party_internal_id: userId });
  const res = await heidiGet(cfg, `jwt?${q.toString()}`, null, "jwt");
  if (res.status === 401 || res.status === 403) return { error: "rejected" };
  const token =
    res.json && typeof res.json === "object" && typeof (res.json as { token?: unknown }).token === "string"
      ? (res.json as { token: string }).token
      : "";
  if (!token) return { error: res.status === 0 || res.status >= 500 ? "unreachable" : "rejected" };
  const exp = expiryMs(
    res.json && typeof res.json === "object" ? (res.json as { expiration_time?: unknown }).expiration_time : null,
  );
  tokens.set(userId, { token, exp });
  return { token };
}

function noteText(session: unknown): string | null {
  if (!session || typeof session !== "object") return null;
  const note = (session as { consult_note?: unknown }).consult_note;
  if (!note || typeof note !== "object") return null;
  const row = note as { status?: unknown; result?: unknown };
  if (row.status == null || row.status === "") return null;
  return typeof row.result === "string" && row.result.trim() ? row.result : null;
}

function transcriptText(json: unknown): string | null {
  if (typeof json === "string" && json.trim()) return json;
  if (!json || typeof json !== "object") return null;
  const row = json as Record<string, unknown>;
  for (const key of ["transcript", "text", "content", "result"]) {
    if (typeof row[key] === "string" && row[key].trim()) return row[key] as string;
  }
  return null;
}

function docsFrom(json: unknown): HeidiDigestDoc[] {
  return asArray(json, ["data", "documents", "context_documents"]).map((item) => {
    if (!item || typeof item !== "object") return { name: "Unnamed file", content: null };
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : "Unnamed file";
    const content = typeof row.content === "string" && row.content.trim() ? row.content : null;
    return { name, content };
  });
}

async function readSession(
  cfg: HeidiConfig,
  token: string,
  ref: LinkedSessionRef,
  clientId: string,
  profileId: string | null,
): Promise<HeidiSessionDigest | null> {
  const detail = await heidiGet(cfg, `sessions/${encodeURIComponent(ref.id)}`, token, "session");
  if (!detail.json) return null;
  if (sessionPatientVerdict(detail.json, clientId, profileId) === "other") return null;
  const at =
    detail.json && typeof detail.json === "object" && typeof (detail.json as { created_at?: unknown }).created_at === "string"
      ? (detail.json as { created_at: string }).created_at
      : ref.at;
  const [documents, contextDocs, transcript] = await Promise.all([
    heidiGet(cfg, `sessions/${encodeURIComponent(ref.id)}/documents`, token, "documents"),
    heidiGet(cfg, `sessions/${encodeURIComponent(ref.id)}/context-documents`, token, "context-documents"),
    heidiGet(cfg, `sessions/${encodeURIComponent(ref.id)}/transcript`, token, "transcript"),
  ]);
  return {
    id: ref.id,
    at,
    note: noteText(detail.json),
    transcript: transcript.status >= 200 && transcript.status < 300 ? transcriptText(transcript.json) : null,
    documents: [...docsFrom(documents.json), ...docsFrom(contextDocs.json)],
  };
}

async function resolveProfile(
  cfg: HeidiConfig,
  token: string,
  client: HeidiPatient,
  storedProfileId: string | null,
): Promise<string | null> {
  if (storedProfileId) return storedProfileId;
  const q = new URLSearchParams({
    ehr_patient_id: client.id,
    ehr_provider: cfg.ehrProvider,
  });
  const byId = await heidiGet(cfg, `patient-profiles?${q.toString()}`, token, "patient-profiles");
  const linked = profilesFrom(byId.json);
  if (linked.length === 1) return linked[0].id;
  const named = uniqueProfileByName(linked, client.full_name ?? "");
  if (named) return named;
  if (linked.length > 1) return null;
  const page = await heidiGet(cfg, "patient-profiles?page=1&page_size=50", token, "patient-profiles");
  return uniqueProfileByName(profilesFrom(page.json), client.full_name ?? "");
}

export async function handleHeidiTurn(
  adminIn: Admin,
  prac: { userId: string; firstName: string },
  cmd: HeidiCommand,
  patients: HeidiPatient[],
  deps: HeidiTurnDeps,
): Promise<void> {
  const cfg = heidiConfig();
  if (!cfg) return;
  const admin = adminIn as unknown as { from: (t: string) => any; auth: Admin["auth"] };

  let client: HeidiPatient | null = null;
  if (cmd.kind === "pick") {
    client = patients.find((p) => p.id === cmd.clientId) ?? null;
  } else {
    const hits = heidiPatientMatches(cmd.name, patients);
    if (hits.length > 1) {
      await deps.reply({
        kind: "list",
        body: HEIDI_MSG.which,
        buttonLabel: "Choose",
        rows: hits.slice(0, 10).map((p) => ({
          id: `heidi_${p.id}`,
          title: String(p.full_name ?? "Client").slice(0, 24),
        })),
      });
      return;
    }
    if (hits.length === 1) client = hits[0];
    else if (cmd.name.trim().split(/\s+/).length < 2) {
      await deps.reply({ kind: "text", body: HEIDI_MSG.needFullName(prac.firstName) });
      return;
    }
  }
  if (!client) {
    await deps.reply({ kind: "text", body: HEIDI_MSG.notOnList(prac.firstName) });
    return;
  }

  const fullName = String(client.full_name ?? "").trim() || "that client";
  const { data: userRes } = await admin.auth.admin.getUserById(prac.userId);
  const email = String(userRes?.user?.email ?? "").trim();
  if (!email) {
    await deps.reply({ kind: "text", body: HEIDI_MSG.noEmail });
    return;
  }

  const auth = await tokenFor(cfg, prac.userId, email);
  if ("error" in auth) {
    await deps.reply({
      kind: "text",
      body: auth.error === "rejected" ? HEIDI_MSG.rejected : HEIDI_MSG.unreachable,
    });
    return;
  }

  const access = await heidiGet(cfg, "users/linked-account/access", auth.token, "linked-account");
  const linked =
    access.json &&
    typeof access.json === "object" &&
    (access.json as { is_linked?: unknown }).is_linked === true;
  if (!linked) {
    await deps.reply({ kind: "text", body: heidiLinkUrl(cfg.region, auth.token) });
    return;
  }

  const existing = await admin
    .from("heidi_records")
    .select("heidi_patient_profile_id, session_ids")
    .eq("client_id", client.id)
    .eq("practitioner_id", prac.userId)
    .maybeSingle()
    .then(
      (row: { data?: { heidi_patient_profile_id?: string | null; session_ids?: string[] | null } | null }) =>
        row?.data ?? null,
      () => null,
    );
  const storedIds = Array.isArray(existing?.session_ids)
    ? existing.session_ids.filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  const profileId = await resolveProfile(
    cfg,
    auth.token,
    client,
    existing?.heidi_patient_profile_id ?? null,
  );

  const listed = await heidiGet(
    cfg,
    `sessions/linked-user?page_size=${LIST_SIZE}`,
    auth.token,
    "linked-user",
  );
  const selected = selectLinkedSessions(
    asArray(listed.json, ["sessions", "data"]),
    client.id,
    profileId,
  );
  const discovered = selected.usable ? selected.ids : [];
  const known = new Set(discovered.map((s) => s.id));
  const candidates: LinkedSessionRef[] = [
    ...discovered,
    ...storedIds.filter((id: string) => !known.has(id)).map((id: string) => ({ id, at: null })),
  ];
  candidates.sort((a, b) => {
    if (a.at && b.at) return a.at < b.at ? 1 : a.at > b.at ? -1 : 0;
    if (a.at) return -1;
    if (b.at) return 1;
    return 0;
  });

  if (!profileId && candidates.length === 0) {
    await deps.reply({ kind: "text", body: HEIDI_MSG.notInHeidi(fullName) });
    return;
  }

  const digests: HeidiSessionDigest[] = [];
  for (const ref of candidates) {
    if (digests.length >= DETAIL_CAP) break;
    const digest = await readSession(cfg, auth.token, ref, client.id, profileId);
    if (digest) digests.push(digest);
  }

  const summary = buildHeidiSummary(digests);
  const keptIds = digests.map((d) => d.id).slice(0, 10);
  if (profileId || keptIds.length) {
    try {
      const saved = await admin.from("heidi_records").upsert(
        {
          client_id: client.id,
          practitioner_id: prac.userId,
          heidi_patient_profile_id: profileId,
          session_ids: keptIds.length ? keptIds : storedIds.slice(0, 10),
          summary: summary.stored,
          newest_note_at: summary.newest,
          fetched_at: deps.now.toISOString(),
        },
        { onConflict: "client_id,practitioner_id" },
      );
      if (saved?.error) log.warn("heidi store failed", { step: "store" });
    } catch {
      log.warn("heidi store failed", { step: "store" });
    }
  }

  if (!summary.reply) {
    await deps.reply({ kind: "text", body: HEIDI_MSG.nothingToRead(fullName) });
    return;
  }

  const { practitionerContact, windowOpen } = await import("./practitioner-status.server");
  const contact = await practitionerContact(adminIn, prac.userId);
  const open = contact.phone ? await windowOpen(adminIn, contact.phone, deps.now) : true;
  if (!open) {
    await deps.reply({ kind: "text", body: HEIDI_MSG.readyInApp(fullName) });
    try {
      const { sendPushCore } = await import("@/lib/push.functions");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await sendPushCore(supabaseAdmin, {
        userId: prac.userId,
        title: "Buddy",
        body: HEIDI_MSG.readyInApp(fullName),
        data: { kind: "heidi_summary" },
      });
    } catch {
      log.warn("heidi push failed", { step: "push" });
    }
    return;
  }

  await deps.reply({
    kind: "text",
    body: HEIDI_MSG.summary(fullName, heidiNoteDate(summary.newest), summary.reply),
  });
}
