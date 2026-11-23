/**
 * POST /api/public/hooks/client-upsert
 *
 * The external Buddy WhatsApp agent (Periskope) adds a client taken from the
 * Notion list. The route stays off unless CLIENT_UPSERT_API_SECRET is set.
 * That secret is separate from WATCH_LINK_API_SECRET. The secret, the phone
 * and the login code are never logged.
 *
 * A new row is in the same not-yet-consented state as Add Client:
 * popia_accepted false and yves_ai_consent false. There is no app login
 * because the list has no email, and this request never sends email or
 * WhatsApp.
 */
import { log } from "@/lib/log";
import { samePhone, toE164Digits } from "@/lib/whatsapp/phone";
import { takeRateSlot, timingSafeEqualString } from "@/lib/wearables/watch-link-api.server";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 30;
const RATE_MAX_AUTH_FAILURES = 60;
const BODY_MAX = 4_000;

export const CLIENT_UPSERT_SOURCE = "notion-buddy-clients" as const;

const PRACTITIONER_ROLES = new Set(["practitioner", "super_admin", "admin"]);
const TITLE = /^(dr|mr|mrs|ms|miss)\.?\s+/i;

const requestBuckets = new Map<string, number[]>();
const authBuckets = new Map<string, number[]>();

export type ClientUpsertInput = {
  name: string;
  phoneDigits: string;
  practitionerFirstName: string;
  notionPageId: string;
  source: typeof CLIENT_UPSERT_SOURCE;
  unarchive: boolean;
};

export type NewClientRow = {
  practitioner_id: string;
  practice_id: string;
  full_name: string;
  phone: string;
  phone_e164: string;
  popia_accepted: false;
  yves_ai_consent: false;
  login_code: string;
  timezone: "Africa/Johannesburg";
  check_in_frequency: "daily";
  notes: "";
  program_status: "none";
  onboarding_source: typeof CLIENT_UPSERT_SOURCE;
  source: typeof CLIENT_UPSERT_SOURCE;
  notion_page_id: string;
};

export type UpsertOutcome =
  | { status: 200; client_id: string; created: boolean }
  | { status: 400; error: "unknown_practitioner" }
  | { status: 409; error: "duplicate" | "archived" }
  | { status: 503 };

export type PractitionerPerson = { id: string; fullName: string; role: string };
export type PracticeRow = { id: string; ownerId: string; approved: boolean };
export type Membership = { userId: string; practiceId: string; status: string };
export type PhoneHit = { id: string; archived: boolean };

export type ActivePractitioner = {
  id: string;
  fullName: string;
  /** Null when the person is on more than one approved practice and owns none. */
  practiceId: string | null;
};

/** Notion page ids are stored lowercase, with dashes, so the unique index matches. */
export function canonicalNotionPageId(value: string): string | null {
  const hex = value.trim().toLowerCase().replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * South African numbers only, in the same digit form WhatsApp uses to match
 * a client. Local 0… and +27… both become 27 plus nine digits.
 */
export function clientPhoneDigits(raw: string): string | null {
  if (raw.length < 8 || raw.length > 32) return null;
  if (!/^[+()\d\s.-]+$/.test(raw)) return null;
  const digits = toE164Digits(raw);
  if (!digits || !/^27\d{9}$/.test(digits)) return null;
  return digits;
}

export function practitionerFirstName(fullName: string): string {
  return fullName.trim().replace(TITLE, "").split(/\s+/)[0] ?? "";
}

export function sameFirstName(requested: string, fullName: string): boolean {
  const left = requested.trim();
  const right = practitionerFirstName(fullName);
  if (left.length < 2 || right.length < 2) return false;
  return left.localeCompare(right, "en", { sensitivity: "base" }) === 0;
}

/**
 * Active means a practitioner, practice admin, or super admin who owns an
 * approved practice, or is an active member of one. Pending sign-ups are not
 * included. First names are matched later.
 */
export function activePractitionerRoster(
  people: PractitionerPerson[],
  practices: PracticeRow[],
  members: Membership[],
): ActivePractitioner[] {
  const approved = new Map(practices.filter((p) => p.approved).map((p) => [p.id, p]));
  const out: ActivePractitioner[] = [];
  const seen = new Set<string>();
  for (const person of people) {
    if (!PRACTITIONER_ROLES.has(person.role) || seen.has(person.id)) continue;
    seen.add(person.id);
    const owned = [...approved.values()].find((p) => p.ownerId === person.id);
    if (owned) {
      out.push({ id: person.id, fullName: person.fullName, practiceId: owned.id });
      continue;
    }
    const practiceIds = [
      ...new Set(
        members
          .filter(
            (m) => m.userId === person.id && m.status === "active" && approved.has(m.practiceId),
          )
          .map((m) => m.practiceId),
      ),
    ];
    if (practiceIds.length === 1) {
      out.push({ id: person.id, fullName: person.fullName, practiceId: practiceIds[0] ?? null });
    } else if (practiceIds.length > 1) {
      out.push({ id: person.id, fullName: person.fullName, practiceId: null });
    }
  }
  return out;
}

type DbError = { message?: string; code?: string };
type DbResult<T> = { data: T | null; error: DbError | null };

interface ReadQuery {
  eq(column: string, value: string): ReadQuery;
  in(column: string, values: readonly string[]): ReadQuery;
  limit(n: number): PromiseLike<DbResult<unknown[]>>;
}

interface UpdateFilter {
  eq(
    column: string,
    value: string,
  ): {
    not(
      column: string,
      operator: "is",
      value: null,
    ): { select(columns: string): PromiseLike<DbResult<unknown[]>> };
  };
}

export interface UpsertAdmin {
  from(table: string): {
    select(columns: string): ReadQuery;
    insert(row: NewClientRow): {
      select(columns: string): { single(): PromiseLike<DbResult<unknown>> };
    };
    update(row: { archived_at: null; archived_by: null }): UpdateFilter;
  };
}

export type InsertFailure = {
  error: true;
  unique?: "login_code" | "phone" | "notion" | "other";
};

export interface ClientStore {
  roster(): Promise<
    | { people: PractitionerPerson[]; practices: PracticeRow[]; members: Membership[] }
    | { error: true }
  >;
  phones(digits: string): Promise<{ hits: PhoneHit[] } | { error: true }>;
  notionOwner(pageId: string): Promise<{ ids: string[] } | { error: true }>;
  insert(row: NewClientRow): Promise<{ id: string } | InsertFailure>;
  unarchive(id: string): Promise<{ ok: true } | { error: true }>;
}

function rowsOf(data: unknown): unknown[] | null {
  if (data == null) return [];
  return Array.isArray(data) ? data : null;
}

function asPeople(data: unknown): PractitionerPerson[] | null {
  const rows = rowsOf(data);
  if (!rows) return null;
  const out: PractitionerPerson[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") return null;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.role !== "string") return null;
    out.push({
      id: r.id,
      fullName: typeof r.full_name === "string" ? r.full_name : "",
      role: r.role,
    });
  }
  return out;
}

function asPractices(data: unknown): PracticeRow[] | null {
  const rows = rowsOf(data);
  if (!rows) return null;
  const out: PracticeRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") return null;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.practitioner_id !== "string") return null;
    if (typeof r.is_approved !== "boolean") return null;
    out.push({ id: r.id, ownerId: r.practitioner_id, approved: r.is_approved });
  }
  return out;
}

function asMembers(data: unknown): Membership[] | null {
  const rows = rowsOf(data);
  if (!rows) return null;
  const out: Membership[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") return null;
    const r = row as Record<string, unknown>;
    if (typeof r.user_id !== "string" || typeof r.practice_id !== "string") return null;
    if (typeof r.status !== "string") return null;
    out.push({ userId: r.user_id, practiceId: r.practice_id, status: r.status });
  }
  return out;
}

type PhoneRow = {
  id: string;
  phone: string | null;
  phone_e164: string | null;
  archived_at: string | null;
};

function asPhoneRows(data: unknown): PhoneRow[] | null {
  const rows = rowsOf(data);
  if (!rows) return null;
  const out: PhoneRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") return null;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string") return null;
    out.push({
      id: r.id,
      phone: typeof r.phone === "string" ? r.phone : null,
      phone_e164: typeof r.phone_e164 === "string" ? r.phone_e164 : null,
      archived_at: typeof r.archived_at === "string" ? r.archived_at : null,
    });
  }
  return out;
}

function asIds(data: unknown): string[] | null {
  const rows = rowsOf(data);
  if (!rows) return null;
  const ids: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") return null;
    const id = (row as { id?: unknown }).id;
    if (typeof id !== "string") return null;
    ids.push(id);
  }
  return ids;
}

function uniqueKind(error: DbError): InsertFailure["unique"] | null {
  const blob = `${error.code ?? ""} ${error.message ?? ""}`;
  const duplicate = error.code === "23505" || /duplicate key value/i.test(blob);
  if (!duplicate) return null;
  if (/notion_page_id/i.test(blob)) return "notion";
  if (/phone_e164|clients_notion_buddy_phone_active_uniq/i.test(blob)) return "phone";
  if (/login_code/i.test(blob)) return "login_code";
  return "other";
}

async function read(query: PromiseLike<DbResult<unknown[]>>): Promise<DbResult<unknown[]>> {
  try {
    return await query;
  } catch {
    return { data: null, error: { message: "query failed" } };
  }
}

/** Service-role reads and writes. No WhatsApp tables. */
export function storeFromAdmin(admin: UpsertAdmin): ClientStore {
  return {
    async roster() {
      const [peopleRes, practiceRes, memberRes] = await Promise.all([
        read(
          admin
            .from("profiles")
            .select("id, full_name, role")
            .in("role", ["practitioner", "super_admin", "admin"])
            .limit(500),
        ),
        read(admin.from("practices").select("id, practitioner_id, is_approved").limit(500)),
        read(
          admin
            .from("practice_members")
            .select("user_id, practice_id, status")
            .eq("status", "active")
            .limit(2000),
        ),
      ]);
      if (peopleRes.error || practiceRes.error || memberRes.error) return { error: true };
      const people = asPeople(peopleRes.data);
      const practices = asPractices(practiceRes.data);
      const members = asMembers(memberRes.data);
      if (!people || !practices || !members) return { error: true };
      return { people, practices, members };
    },
    async phones(digits) {
      const indexed = await read(
        admin
          .from("clients")
          .select("id, phone, phone_e164, archived_at")
          .eq("phone_e164", digits)
          .limit(20),
      );
      const scanned = await read(
        admin.from("clients").select("id, phone, phone_e164, archived_at").limit(5000),
      );
      if (scanned.error) return { error: true };
      const scannedRows = asPhoneRows(scanned.data);
      if (!scannedRows) return { error: true };
      const indexedRows = indexed.error ? [] : asPhoneRows(indexed.data);
      if (!indexedRows) return { error: true };
      const map = new Map<string, PhoneHit>();
      for (const row of [...indexedRows, ...scannedRows]) {
        if (!samePhone(row.phone, digits) && !samePhone(row.phone_e164, digits)) continue;
        const archived = row.archived_at != null;
        const prev = map.get(row.id);
        map.set(row.id, { id: row.id, archived: archived || prev?.archived === true });
      }
      return { hits: [...map.values()] };
    },
    async notionOwner(pageId) {
      const res = await read(
        admin.from("clients").select("id").eq("notion_page_id", pageId).limit(5),
      );
      if (res.error) return { error: true };
      const ids = asIds(res.data);
      if (!ids) return { error: true };
      return { ids };
    },
    async insert(row) {
      let res: DbResult<unknown>;
      try {
        res = await admin.from("clients").insert(row).select("id").single();
      } catch {
        return { error: true };
      }
      if (res.error) {
        const unique = uniqueKind(res.error);
        return unique ? { error: true, unique } : { error: true };
      }
      const id =
        res.data && typeof res.data === "object" && !Array.isArray(res.data)
          ? (res.data as { id?: unknown }).id
          : null;
      return typeof id === "string" ? { id } : { error: true };
    },
    async unarchive(id) {
      let res: DbResult<unknown[]>;
      try {
        res = await admin
          .from("clients")
          .update({ archived_at: null, archived_by: null })
          .eq("id", id)
          .not("archived_at", "is", null)
          .select("id");
      } catch {
        return { error: true };
      }
      if (res.error) return { error: true };
      const ids = asIds(res.data);
      if (!ids || ids.length !== 1) return { error: true };
      return { ok: true };
    },
  };
}

function loginCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(1000 + ((buf[0] ?? 0) % 9000));
}

function newRow(
  input: ClientUpsertInput,
  practitioner: ActivePractitioner,
  code: string,
): NewClientRow | null {
  if (!practitioner.practiceId) return null;
  return {
    practitioner_id: practitioner.id,
    practice_id: practitioner.practiceId,
    full_name: input.name,
    phone: `+${input.phoneDigits}`,
    phone_e164: input.phoneDigits,
    popia_accepted: false,
    yves_ai_consent: false,
    login_code: code,
    timezone: "Africa/Johannesburg",
    check_in_frequency: "daily",
    notes: "",
    program_status: "none",
    onboarding_source: CLIENT_UPSERT_SOURCE,
    source: CLIENT_UPSERT_SOURCE,
    notion_page_id: input.notionPageId,
  };
}

/**
 * Find or create the client. An existing active row is returned as stored.
 * Name, practitioner and clinical fields are not written on that path.
 * Archived rows stay archived unless unarchive is true, and then only the
 * archive columns are cleared.
 */
export async function upsertClient(
  input: ClientUpsertInput,
  store: ClientStore,
  codes: () => string = loginCode,
): Promise<UpsertOutcome> {
  const roster = await store.roster();
  if ("error" in roster) return { status: 503 };
  const matches = activePractitionerRoster(roster.people, roster.practices, roster.members).filter(
    (p) => sameFirstName(input.practitionerFirstName, p.fullName),
  );
  if (matches.length !== 1) return { status: 400, error: "unknown_practitioner" };
  const practitioner = matches[0];
  if (!practitioner) return { status: 400, error: "unknown_practitioner" };

  const phones = await store.phones(input.phoneDigits);
  if ("error" in phones) return { status: 503 };
  const active = phones.hits.filter((h) => !h.archived);
  const archived = phones.hits.filter((h) => h.archived);
  if (active.length > 1) return { status: 409, error: "duplicate" };
  if (active.length === 1 && active[0]) {
    return { status: 200, client_id: active[0].id, created: false };
  }
  if (archived.length > 1) return { status: 409, error: "duplicate" };
  if (archived.length === 1 && archived[0]) {
    if (!input.unarchive) return { status: 409, error: "archived" };
    const restored = await store.unarchive(archived[0].id);
    if ("error" in restored) return { status: 503 };
    return { status: 200, client_id: archived[0].id, created: false };
  }

  if (!practitioner.practiceId) return { status: 503 };
  const notion = await store.notionOwner(input.notionPageId);
  if ("error" in notion) return { status: 503 };
  if (notion.ids.length > 0) return { status: 409, error: "duplicate" };

  for (let attempt = 0; attempt < 5; attempt++) {
    const row = newRow(input, practitioner, codes());
    if (!row) return { status: 503 };
    const inserted = await store.insert(row);
    if ("id" in inserted) return { status: 200, client_id: inserted.id, created: true };
    if (inserted.unique === "login_code") continue;
    if (inserted.unique === "phone") {
      const again = await store.phones(input.phoneDigits);
      if (!("error" in again)) {
        const winners = again.hits.filter((h) => !h.archived);
        if (winners.length === 1 && winners[0]) {
          return { status: 200, client_id: winners[0].id, created: false };
        }
      }
      return { status: 409, error: "duplicate" };
    }
    if (inserted.unique === "notion") return { status: 409, error: "duplicate" };
    return { status: 503 };
  }
  return { status: 503 };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function providedSecret(request: Request): string {
  const header = request.headers.get("x-client-upsert-secret");
  if (header !== null) return header;
  const auth = request.headers.get("authorization");
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "");
  return "";
}

function cleanName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 120) return null;
  if (!/^[\p{L}][\p{L}'’.\- ]*$/u.test(name)) return null;
  if (!/\p{L}{2}/u.test(name)) return null;
  return name;
}

function cleanFirstName(value: string): string | null {
  const name = value.trim();
  if (name.length < 2 || name.length > 40) return null;
  if (!/^[\p{L}][\p{L}'’-]*$/u.test(name)) return null;
  return name;
}

export function parseClientUpsertBody(body: unknown): ClientUpsertInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const allowed = new Set([
    "name",
    "phone",
    "practitioner",
    "notion_page_id",
    "source",
    "unarchive",
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return null;
  }
  if (typeof record.name !== "string" || typeof record.phone !== "string") return null;
  if (typeof record.practitioner !== "string" || typeof record.notion_page_id !== "string") {
    return null;
  }
  if (record.source !== CLIENT_UPSERT_SOURCE) return null;
  if (record.unarchive !== undefined && typeof record.unarchive !== "boolean") return null;
  const name = cleanName(record.name);
  const phoneDigits = clientPhoneDigits(record.phone);
  const practitionerFirstName = cleanFirstName(record.practitioner);
  const notionPageId = canonicalNotionPageId(record.notion_page_id);
  if (!name || !phoneDigits || !practitionerFirstName || !notionPageId) return null;
  return {
    name,
    phoneDigits,
    practitionerFirstName,
    notionPageId,
    source: CLIENT_UPSERT_SOURCE,
    unarchive: record.unarchive === true,
  };
}

export type ClientUpsertDeps = {
  /** Pass null to force the endpoint off. Omit to read CLIENT_UPSERT_API_SECRET. */
  secret?: string | null;
  now?: Date;
  requestBuckets?: Map<string, number[]>;
  authBuckets?: Map<string, number[]>;
  upsert?: (input: ClientUpsertInput) => Promise<UpsertOutcome>;
};

async function defaultUpsert(input: ClientUpsertInput): Promise<UpsertOutcome> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return upsertClient(input, storeFromAdmin(supabaseAdmin as unknown as UpsertAdmin));
}

export async function handleClientUpsertRequest(
  request: Request,
  deps: ClientUpsertDeps = {},
): Promise<Response> {
  const configured =
    deps.secret !== undefined
      ? (deps.secret?.trim() ?? "")
      : (process.env.CLIENT_UPSERT_API_SECRET?.trim() ?? "");
  if (!configured) return new Response(null, { status: 404 });

  const nowMs = (deps.now ?? new Date()).getTime();
  const authMap = deps.authBuckets ?? authBuckets;
  if (!timingSafeEqualString(providedSecret(request), configured)) {
    if (takeRateSlot(authMap, "auth", nowMs, RATE_MAX_AUTH_FAILURES, RATE_WINDOW_MS)) {
      return json({ error: "too_many_requests" }, 429);
    }
    return new Response("Unauthorized", { status: 401, headers: { "cache-control": "no-store" } });
  }

  const requestMap = deps.requestBuckets ?? requestBuckets;
  if (takeRateSlot(requestMap, "all", nowMs, RATE_MAX_REQUESTS, RATE_WINDOW_MS)) {
    return json({ error: "too_many_requests" }, 429);
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > BODY_MAX) return json({ error: "bad_request" }, 400);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const input = parseClientUpsertBody(body);
  if (!input) return json({ error: "bad_request" }, 400);

  try {
    const upsert = deps.upsert ?? defaultUpsert;
    const result = await upsert(input);
    if (result.status === 200) {
      return json({ client_id: result.client_id, created: result.created }, 200);
    }
    if (result.status === 400) return json({ error: result.error }, 400);
    if (result.status === 409) return json({ error: result.error }, 409);
    return json({ error: "unavailable" }, 503);
  } catch {
    log.warn("client-upsert hook failed");
    return json({ error: "unavailable" }, 503);
  }
}
