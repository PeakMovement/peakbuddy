/**
 * POST /api/public/hooks/watch-link
 *
 * An external WhatsApp agent (Periskope) cannot sign connect-watch tokens.
 * This hook mints one for an active client. It stays off unless
 * WATCH_LINK_API_SECRET is set. The secret and the token are never logged.
 */
import { log } from "@/lib/log";
import { samePhone, toE164Digits } from "@/lib/whatsapp/phone";
import { mintWatchToken, watchLinkUrl, watchTokenExpiresAt } from "./watch-link.server";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PHONE = 30;
const RATE_MAX_AUTH_FAILURES = 60;

const phoneBuckets = new Map<string, number[]>();
const authBuckets = new Map<string, number[]>();

/** True when this key is over the limit (the call is not counted). */
export function takeRateSlot(
  buckets: Map<string, number[]>,
  key: string,
  nowMs: number,
  max: number,
  windowMs = RATE_WINDOW_MS,
): boolean {
  if (buckets.size > 10_000) buckets.clear();
  const hits = (buckets.get(key) ?? []).filter((t) => nowMs - t < windowMs);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return true;
  }
  hits.push(nowMs);
  buckets.set(key, hits);
  return false;
}

/** Constant-time string compare. Different lengths still walk the longer input. */
export function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length, 1);
  let diff = ab.length === bb.length ? 0 : 1;
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export type PhoneLookup = {
  byE164: (digits: string) => Promise<{ ids: string[] } | { error: true }>;
  scan: () => Promise<
    | { rows: Array<{ id: string; phone: string | null; phone_e164: string | null }> }
    | { error: true }
  >;
};

export async function findActiveClientByPhone(
  rawPhone: string,
  lookup: PhoneLookup,
): Promise<
  { ok: true; clientId: string } | { ok: false; reason: "invalid" | "not_found" | "error" }
> {
  const digits = toE164Digits(rawPhone);
  if (!digits) return { ok: false, reason: "invalid" };
  const indexed = await lookup.byE164(digits);
  if (!("error" in indexed)) {
    if (indexed.ids.length === 1) return { ok: true, clientId: indexed.ids[0] };
    if (indexed.ids.length > 1) return { ok: false, reason: "not_found" };
  }
  const scanned = await lookup.scan();
  if ("error" in scanned) return { ok: false, reason: "error" };
  const ids = new Set<string>();
  for (const row of scanned.rows) {
    if (samePhone(row.phone, digits) || samePhone(row.phone_e164, digits)) ids.add(row.id);
  }
  if (ids.size === 1) {
    const clientId = [...ids][0];
    return clientId ? { ok: true, clientId } : { ok: false, reason: "not_found" };
  }
  return { ok: false, reason: "not_found" };
}

type QueryResult<T> = Promise<{ data: T[] | null; error: { message: string } | null }>;

export interface ClientPhoneAdmin {
  from(table: "clients"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        is(column: string, value: null): { limit(n: number): QueryResult<{ id: string }> };
      };
      is(
        column: string,
        value: null,
      ): {
        limit(
          n: number,
        ): QueryResult<{ id: string; phone: string | null; phone_e164: string | null }>;
      };
    };
  };
}

/** Active means not archived. A number on two active profiles is not a match. */
export function phoneLookup(admin: ClientPhoneAdmin): PhoneLookup {
  return {
    async byE164(digits) {
      const { data, error } = await admin
        .from("clients")
        .select("id")
        .eq("phone_e164", digits)
        .is("archived_at", null)
        .limit(5);
      if (error) return { error: true };
      return { ids: (data ?? []).map((row) => row.id) };
    },
    async scan() {
      const { data, error } = await admin
        .from("clients")
        .select("id, phone, phone_e164")
        .is("archived_at", null)
        .limit(5000);
      if (error) return { error: true };
      return {
        rows: (data ?? []).map((row) => ({
          id: row.id,
          phone: row.phone,
          phone_e164: row.phone_e164,
        })),
      };
    },
  };
}

export type IssueResult =
  | { status: 200; url: string; expires_at: string }
  | { status: 400 }
  | { status: 404 }
  | { status: 503 };

export async function issueWatchLink(
  rawPhone: string,
  now: Date,
  lookup: PhoneLookup,
  origin: string,
): Promise<IssueResult> {
  const found = await findActiveClientByPhone(rawPhone, lookup);
  if (!found.ok) {
    if (found.reason === "invalid") return { status: 400 };
    if (found.reason === "error") return { status: 503 };
    return { status: 404 };
  }
  const token = await mintWatchToken(found.clientId, now);
  if (!token) return { status: 503 };
  const expiresAt = watchTokenExpiresAt(token);
  if (!expiresAt) return { status: 503 };
  return { status: 200, url: watchLinkUrl(origin, token), expires_at: expiresAt };
}

export type WatchLinkDeps = {
  /** Pass null to force the endpoint off. Omit to read WATCH_LINK_API_SECRET. */
  secret?: string | null;
  now?: Date;
  phoneBuckets?: Map<string, number[]>;
  authBuckets?: Map<string, number[]>;
  issue?: (phone: string, now: Date) => Promise<IssueResult>;
};

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
  const header = request.headers.get("x-watch-link-secret");
  if (header !== null) return header;
  const auth = request.headers.get("authorization");
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "");
  return "";
}

async function defaultIssue(phone: string, now: Date): Promise<IssueResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { appBaseUrl } = await import("@/lib/app-url");
  return issueWatchLink(
    phone,
    now,
    phoneLookup(supabaseAdmin as unknown as ClientPhoneAdmin),
    appBaseUrl(),
  );
}

export async function handleWatchLinkRequest(
  request: Request,
  deps: WatchLinkDeps = {},
): Promise<Response> {
  const configured =
    deps.secret !== undefined
      ? (deps.secret?.trim() ?? "")
      : (process.env.WATCH_LINK_API_SECRET?.trim() ?? "");
  if (!configured) return new Response(null, { status: 404 });

  const now = deps.now ?? new Date();
  const nowMs = now.getTime();
  const authMap = deps.authBuckets ?? authBuckets;
  if (!timingSafeEqualString(providedSecret(request), configured)) {
    if (takeRateSlot(authMap, "auth", nowMs, RATE_MAX_AUTH_FAILURES)) {
      return json({ error: "too_many_requests" }, 429);
    }
    return new Response("Unauthorized", { status: 401, headers: { "cache-control": "no-store" } });
  }

  let body: unknown;
  try {
    const len = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(len) && len > 2_000) return json({ error: "bad_request" }, 400);
    body = await request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "bad_request" }, 400);
  }
  const phone = (body as { phone?: unknown }).phone;
  if (typeof phone !== "string" || phone.length < 8 || phone.length > 32) {
    return json({ error: "bad_request" }, 400);
  }
  const digits = toE164Digits(phone);
  if (!digits) return json({ error: "bad_request" }, 400);

  const phoneMap = deps.phoneBuckets ?? phoneBuckets;
  if (takeRateSlot(phoneMap, digits, nowMs, RATE_MAX_PHONE)) {
    return json({ error: "too_many_requests" }, 429);
  }

  try {
    const issue = deps.issue ?? defaultIssue;
    const result = await issue(digits, now);
    if (result.status === 200) {
      return json({ url: result.url, expires_at: result.expires_at }, 200);
    }
    if (result.status === 404) return json({ error: "not_found" }, 404);
    if (result.status === 400) return json({ error: "bad_request" }, 400);
    return json({ error: "unavailable" }, 503);
  } catch {
    log.warn("watch-link hook failed");
    return json({ error: "unavailable" }, 503);
  }
}
