// Oura (OAuth2) integration logic — pure HTTP, no DB.
// Ported from predictivmvp's oura-auth-initiate / oura-auth / fetch-oura-data /
// _shared/oura-token-refresh / oura-webhook edge functions, adapted to PeakBuddy's
// client-centric model. Endpoints, scopes and the response→session mapping are the
// proven values from PREDICTIV.
import type { Database } from "@/integrations/supabase/types";

type SessionInsert = Database["public"]["Tables"]["wearable_sessions"]["Insert"];
/** A normalized daily row without the client_id (the caller attaches it). */
export type OuraDailyRow = Omit<SessionInsert, "client_id" | "id" | "fetched_at">;

export const OURA = {
  AUTHORIZE_URL: "https://cloud.ouraring.com/oauth/authorize",
  TOKEN_URL: "https://api.ouraring.com/oauth/token",
  API_BASE: "https://api.ouraring.com/v2/usercollection",
  // Exact scope string/order from PREDICTIV.
  SCOPES: "email personal daily heartrate workout tag session spo2",
} as const;

export type OuraTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

/** A typed error so callers can branch on invalid_grant (force reconnect). */
export class OuraError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "OuraError";
  }
}

/** Build the authorize URL. `state` carries our client_id through the round-trip. */
export function buildOuraAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  return (
    `${OURA.AUTHORIZE_URL}?response_type=code` +
    `&client_id=${args.clientId}` +
    `&redirect_uri=${encodeURIComponent(args.redirectUri)}` +
    `&scope=${encodeURIComponent(OURA.SCOPES)}` +
    `&state=${encodeURIComponent(args.state)}`
  );
}

/** Exchange an authorization code for tokens. */
export async function exchangeOuraCode(args: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<OuraTokenResponse> {
  const res = await fetch(OURA.TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: args.redirectUri,
      client_id: args.clientId,
      client_secret: args.clientSecret,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new OuraError(parseOuraErrorCode(body), `Oura token exchange failed: ${body}`);
  }
  const data = (await res.json()) as Partial<OuraTokenResponse>;
  if (!data.access_token || !data.refresh_token) {
    throw new OuraError("INVALID_RESPONSE", "Oura token response missing tokens");
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in ?? 0,
  };
}

/** Refresh an access token. Throws OuraError('invalid_grant') when reconnect is required. */
export async function refreshOuraToken(args: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<OuraTokenResponse> {
  const res = await fetch(OURA.TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: args.refreshToken,
      client_id: args.clientId,
      client_secret: args.clientSecret,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new OuraError(parseOuraErrorCode(body), `Oura token refresh failed: ${body}`);
  }
  const data = (await res.json()) as Partial<OuraTokenResponse>;
  if (!data.access_token) {
    throw new OuraError("INVALID_RESPONSE", "Oura refresh response missing access_token");
  }
  return {
    access_token: data.access_token,
    // Oura may not return a new refresh token; caller falls back to the old one.
    refresh_token: data.refresh_token ?? args.refreshToken,
    expires_in: data.expires_in ?? 0,
  };
}

function parseOuraErrorCode(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: string };
    return j.error ?? "REFRESH_FAILED";
  } catch {
    return "REFRESH_FAILED";
  }
}

// ---------------------------------------------------------------------------
// Data fetch + normalization
// ---------------------------------------------------------------------------

async function ouraGet(url: string, accessToken: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 401) throw new OuraError("invalid_grant", "Oura token expired");
  if (!res.ok) return []; // 429 / 403 / 404 → skip this endpoint gracefully
  const json = (await res.json()) as { data?: Record<string, unknown>[] };
  return json.data ?? [];
}

/**
 * Pull the six Oura v2 endpoints for [startDate, endDate] and normalize them into
 * one row per day. Mapping matches PREDICTIV's fetch-oura-data exactly, plus the
 * sleep-stage durations (we have columns for them).
 */
export async function fetchOuraSessions(args: {
  accessToken: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}): Promise<OuraDailyRow[]> {
  const { accessToken, startDate, endDate } = args;
  const q = `start_date=${startDate}&end_date=${endDate}`;
  const startDt = encodeURIComponent(`${startDate}T00:00:00+00:00`);
  const endDt = encodeURIComponent(`${endDate}T23:59:59+00:00`);

  const [readiness, dailySleep, activity, spo2, sleep, heartrate] = await Promise.all([
    ouraGet(`${OURA.API_BASE}/daily_readiness?${q}`, accessToken),
    ouraGet(`${OURA.API_BASE}/daily_sleep?${q}`, accessToken),
    ouraGet(`${OURA.API_BASE}/daily_activity?${q}`, accessToken),
    ouraGet(`${OURA.API_BASE}/daily_spo2?${q}`, accessToken),
    ouraGet(`${OURA.API_BASE}/sleep?${q}`, accessToken),
    ouraGet(
      `${OURA.API_BASE}/heartrate?start_datetime=${startDt}&end_datetime=${endDt}`,
      accessToken,
    ),
  ]);

  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const byDay = (rows: Record<string, unknown>[]) => {
    const m = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const day = r.day as string | undefined;
      if (day) m.set(day, r);
    }
    return m;
  };

  // heartrate → per-day {avg, min}
  const hrByDate = new Map<string, { total: number; count: number; min: number }>();
  for (const s of heartrate) {
    const bpm = s.bpm as number | undefined;
    const ts = s.timestamp as string | undefined;
    if (!bpm || bpm <= 0 || !ts) continue;
    const day = ts.split("T")[0];
    const cur = hrByDate.get(day) ?? { total: 0, count: 0, min: 999 };
    cur.total += bpm;
    cur.count += 1;
    cur.min = Math.min(cur.min, bpm);
    hrByDate.set(day, cur);
  }

  // detailed sleep → keep the longest sleep period per day (the primary sleep)
  const sleepByDate = new Map<string, Record<string, unknown>>();
  for (const s of sleep) {
    const day = s.day as string | undefined;
    if (!day) continue;
    const prev = sleepByDate.get(day);
    const dur = (s.total_sleep_duration as number) ?? 0;
    if (!prev || dur > ((prev.total_sleep_duration as number) ?? 0)) sleepByDate.set(day, s);
  }

  const readinessByDay = byDay(readiness);
  const dailySleepByDay = byDay(dailySleep);
  const activityByDay = byDay(activity);
  const spo2ByDay = byDay(spo2);

  const days = new Set<string>([
    ...readinessByDay.keys(),
    ...dailySleepByDay.keys(),
    ...activityByDay.keys(),
    ...spo2ByDay.keys(),
    ...sleepByDate.keys(),
  ]);

  const out: OuraDailyRow[] = [];
  for (const day of days) {
    const r = readinessByDay.get(day);
    const ds = dailySleepByDay.get(day);
    const act = activityByDay.get(day);
    const sp = spo2ByDay.get(day);
    const sd = sleepByDate.get(day);
    const hr = hrByDate.get(day);

    const restingHr =
      num(sd?.lowest_heart_rate) ??
      (hr && hr.min < 999 ? hr.min : null) ??
      (hr && hr.count ? Math.round(hr.total / hr.count) : null);

    const spo2Avg = (() => {
      const pct = sp?.spo2_percentage as { average?: number } | undefined;
      return typeof pct?.average === "number" ? pct.average : null;
    })();

    out.push({
      source: "oura",
      date: day,
      readiness_score: num(r?.score),
      sleep_score: num(ds?.score),
      activity_score: num(act?.score),
      total_steps: num(act?.steps),
      active_calories: num(act?.active_calories),
      total_calories: num(act?.total_calories),
      resting_hr: restingHr,
      // Full-day average HR from the /heartrate time-series (already fetched).
      avg_heart_rate: hr && hr.count ? Math.round(hr.total / hr.count) : null,
      hrv_avg: num(sd?.average_hrv),
      spo2_avg: spo2Avg,
      total_sleep_duration: num(sd?.total_sleep_duration),
      deep_sleep_duration: num(sd?.deep_sleep_duration),
      light_sleep_duration: num(sd?.light_sleep_duration),
      rem_sleep_duration: num(sd?.rem_sleep_duration),
      sleep_efficiency: num(sd?.efficiency),
    });
  }
  return out;
}

/**
 * Verify an Oura webhook POST signature.
 * HMAC-SHA256 over (timestamp + rawBody) with the client secret, hex, case-insensitive.
 */
export async function verifyOuraWebhookSignature(args: {
  secret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
}): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(args.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(args.timestamp + args.rawBody),
  );
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.toLowerCase() === args.signature.toLowerCase();
}
