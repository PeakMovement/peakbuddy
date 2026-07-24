// Garmin (OAuth2 + PKCE) integration logic — pure HTTP, no DB.
// Ported from predictivmvp's garmin-auth / garmin-backfill / garmin-webhook /
// fetch-garmin-data. Garmin OAuth2 apps are PUSH-ONLY: after connect we request a
// backfill and Garmin pushes history to our webhook (live pull throws
// InvalidPullTokenException), so the webhook is the real data path.
import type { Database } from "@/integrations/supabase/types";

type SessionInsert = Database["public"]["Tables"]["wearable_sessions"]["Insert"];
export type GarminDailyRow = Omit<SessionInsert, "client_id" | "id" | "fetched_at">;

export const GARMIN = {
  AUTHORIZE_URL: "https://connect.garmin.com/oauth2Confirm",
  TOKEN_URL: "https://diauth.garmin.com/di-oauth2-service/oauth/token",
  API_BASE: "https://apis.garmin.com/wellness-api/rest",
  BACKFILL_ENDPOINTS: [
    "dailies",
    "sleeps",
    "activities",
    "epochs",
    "stressDetails",
    "userMetrics",
    "hrv",
  ],
} as const;

export class GarminError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "GarminError";
  }
}

// ---- PKCE ----
const PKCE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

export function generateCodeVerifier(length = 64): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes)
    .map((v) => PKCE_CHARS[v % PKCE_CHARS.length])
    .join("");
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function generateState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function buildGarminAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  return (
    `${GARMIN.AUTHORIZE_URL}?response_type=code` +
    `&client_id=${encodeURIComponent(args.clientId)}` +
    `&redirect_uri=${encodeURIComponent(args.redirectUri)}` +
    `&code_challenge=${encodeURIComponent(args.codeChallenge)}` +
    `&code_challenge_method=S256` +
    `&state=${encodeURIComponent(args.state)}`
  );
}

export type GarminTokenResponse = {
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  token_type: string;
};

/** Token exchange (confidential client + PKCE: client_secret AND code_verifier). */
export async function exchangeGarminCode(args: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GarminTokenResponse> {
  const res = await fetch(GARMIN.TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: args.clientId,
      client_secret: args.clientSecret,
      code: args.code,
      code_verifier: args.codeVerifier,
      redirect_uri: args.redirectUri,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    let code = "token_exchange_failed";
    try {
      const j = JSON.parse(body) as { error?: string };
      if (j.error === "invalid_grant") code = "code_expired";
      else if (j.error === "invalid_client") code = "invalid_credentials";
    } catch {
      /* ignore */
    }
    throw new GarminError(code, `Garmin token exchange failed: ${body}`);
  }
  const data = (await res.json()) as Partial<GarminTokenResponse>;
  if (!data.access_token)
    throw new GarminError("INVALID_RESPONSE", "Garmin response missing access_token");
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    expires_in: data.expires_in ?? 86400,
    token_type: data.token_type ?? "bearer",
  };
}

export async function refreshGarminToken(args: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<GarminTokenResponse> {
  const res = await fetch(GARMIN.TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: args.clientId.trim(),
      client_secret: args.clientSecret.trim(),
      refresh_token: args.refreshToken,
    }),
  });
  if (!res.ok)
    throw new GarminError("refresh_failed", `Garmin refresh failed: ${await res.text()}`);
  const data = (await res.json()) as Partial<GarminTokenResponse>;
  if (!data.access_token)
    throw new GarminError("INVALID_RESPONSE", "Garmin refresh missing access_token");
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? args.refreshToken,
    expires_in: data.expires_in ?? 86400,
    token_type: data.token_type ?? "bearer",
  };
}

/** Fetch the stable Garmin user id (for webhook routing). Non-fatal on failure. */
export async function fetchGarminUserId(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${GARMIN.API_BASE}/user/id`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { userId?: string };
    return data.userId ?? null;
  } catch {
    return null;
  }
}

/**
 * Request a backfill of the last `days` (1–90) of history. Garmin accepts
 * (202/200/409) and pushes the data asynchronously to our webhook.
 *
 * Throws `GarminError('consent_required')` when Garmin rejects every attempt
 * with 403 — that means the user hasn't granted the required data scopes in
 * Garmin Connect, so no push data will ever arrive.
 */
export async function requestGarminBackfill(args: {
  accessToken: string;
  days?: number;
}): Promise<{ attempted: number; accepted: number; forbidden: number }> {
  const days = Math.min(90, Math.max(1, args.days ?? 30));
  const nowS = Math.floor(Date.now() / 1000);
  let attempted = 0;
  let accepted = 0;
  let forbidden = 0;
  for (const endpoint of GARMIN.BACKFILL_ENDPOINTS) {
    for (let d = 0; d < days; d++) {
      const end = nowS - d * 86400;
      const start = end - 86400;
      const url = `${GARMIN.API_BASE}/backfill/${endpoint}?summaryStartTimeInSeconds=${start}&summaryEndTimeInSeconds=${end}`;
      attempted++;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${args.accessToken}` },
        });
        if (res.status === 403) forbidden++;
        else if (res.ok || res.status === 409) accepted++;
      } catch {
        /* best effort */
      }
      await new Promise((r) => setTimeout(r, 120)); // pace requests
    }
  }
  if (attempted > 0 && accepted === 0 && forbidden / attempted > 0.9) {
    throw new GarminError(
      "consent_required",
      "Garmin denied backfill — user consent / scopes missing",
    );
  }
  return { attempted, accepted, forbidden };
}

// ---------------------------------------------------------------------------
// Webhook payload → wearable_sessions partial rows (push path)
// ---------------------------------------------------------------------------
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
// Garmin uses negative sentinels (-1 no data, -2 too much motion) for stress.
const nonNeg = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n >= 0 ? n : null;
};
const min = (sec: unknown): number | null =>
  typeof sec === "number" ? Math.round(sec / 60) : null;

export function mapGarminDaily(
  item: Record<string, unknown>,
): { date: string; row: GarminDailyRow } | null {
  const date = item.calendarDate as string | undefined;
  if (!date) return null;
  const active = item.activeKilocalories as number | undefined;
  const bmr = item.bmrKilocalories as number | undefined;
  const total =
    (item.totalKilocalories as number | undefined) ??
    (active != null || bmr != null ? (active ?? 0) + (bmr ?? 0) : null);
  const distanceM = item.distanceInMeters as number | undefined;
  return {
    date,
    row: {
      source: "garmin",
      date,
      total_steps: num(item.steps),
      total_calories: total,
      active_calories: num(active),
      resting_hr: num(item.restingHeartRateInBeatsPerMinute),
      // Garmin sends these inside the daily summary too — capture them rather
      // than making a second round-trip for stress / Body Battery.
      avg_heart_rate: num(item.averageHeartRateInBeatsPerMinute),
      max_heart_rate: num(item.maxHeartRateInBeatsPerMinute),
      stress_avg: nonNeg(item.averageStressLevel),
      body_battery_charged: num(item.bodyBatteryChargedValue),
      body_battery_drained: num(item.bodyBatteryDrainedValue),
      total_distance_km:
        typeof distanceM === "number" ? Math.round((distanceM / 1000) * 100) / 100 : null,
    },
  };
}

/** userMetrics → VO2 max (Garmin's fitness metrics summary). */
export function mapGarminUserMetrics(
  item: Record<string, unknown>,
): { date: string; row: GarminDailyRow } | null {
  const date = item.calendarDate as string | undefined;
  if (!date) return null;
  const vo2 = num(item.vo2Max) ?? num(item.vo2MaxRunning) ?? num(item.vo2MaxCycling);
  if (vo2 === null) return null;
  return { date, row: { source: "garmin", date, vo2_max: vo2 } };
}

export function mapGarminSleep(
  item: Record<string, unknown>,
): { date: string; row: GarminDailyRow } | null {
  const date = item.calendarDate as string | undefined;
  if (!date) return null;
  const score =
    (item.overallSleepScoreValue as number | undefined) ??
    (item.overallSleepScore as { value?: number } | undefined)?.value ??
    null;
  return {
    date,
    row: {
      source: "garmin",
      date,
      sleep_score: score,
      total_sleep_duration: min(item.durationInSeconds),
      deep_sleep_duration: min(item.deepSleepDurationInSeconds),
      rem_sleep_duration: min(item.remSleepInSeconds),
      light_sleep_duration: min(item.lightSleepDurationInSeconds),
    },
  };
}

export function mapGarminHrv(
  item: Record<string, unknown>,
): { date: string; row: GarminDailyRow } | null {
  const date = item.calendarDate as string | undefined;
  if (!date) return null;
  return { date, row: { source: "garmin", date, hrv_avg: num(item.lastNightAvg) } };
}

/** Activities accumulate distance per user+date. */
export function mapGarminActivity(
  item: Record<string, unknown>,
): { date: string; distanceKm: number } | null {
  const start = item.startTimeInSeconds as number | undefined;
  if (typeof start !== "number") return null;
  const date = new Date(start * 1000).toISOString().split("T")[0];
  const meters = (item.distanceInMeters as number | undefined) ?? 0;
  return { date, distanceKm: meters / 1000 };
}
