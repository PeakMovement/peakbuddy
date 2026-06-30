// Polar (AccessLink, OAuth2) integration logic — pure HTTP, no DB.
// Ported from predictivmvp's polar-auth-* / fetch-polar-* edge functions.
// Polar tokens are long-lived (no refresh). Auth UI, token, and API live on
// three different hosts.
import type { Database } from "@/integrations/supabase/types";

type SessionInsert = Database["public"]["Tables"]["wearable_sessions"]["Insert"];
export type PolarDailyRow = Omit<SessionInsert, "client_id" | "id" | "fetched_at">;

export const POLAR = {
  AUTHORIZE_URL: "https://flow.polar.com/oauth2/authorization",
  TOKEN_URL: "https://polarremote.com/v2/oauth2/token",
  API_BASE: "https://www.polaraccesslink.com/v3",
  SCOPE: "accesslink.read_all",
} as const;

export class PolarError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "PolarError";
  }
}

export function buildPolarAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const u = new URL(POLAR.AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", args.clientId);
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("scope", POLAR.SCOPE);
  u.searchParams.set("state", args.state);
  return u.toString();
}

export type PolarTokenResponse = { access_token: string; x_user_id: string; scope: string };

/** Token exchange — HTTP Basic auth, form-encoded; redirect_uri must match. */
export async function exchangePolarCode(args: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<PolarTokenResponse> {
  const credentials = btoa(`${args.clientId}:${args.clientSecret}`);
  const res = await fetch(POLAR.TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json;charset=UTF-8",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: args.redirectUri,
    }).toString(),
  });
  if (!res.ok) {
    throw new PolarError(
      "token_exchange_failed",
      `Polar token exchange failed: ${await res.text()}`,
    );
  }
  const data = (await res.json()) as Partial<PolarTokenResponse>;
  if (!data.access_token || !data.x_user_id) {
    throw new PolarError("INVALID_RESPONSE", "Polar token response missing access_token/x_user_id");
  }
  return {
    access_token: data.access_token,
    x_user_id: String(data.x_user_id),
    scope: data.scope ?? POLAR.SCOPE,
  };
}

/**
 * Register the user with AccessLink (required before data is available).
 * 403 => the user hasn't granted consent; 409 => already registered (fine).
 */
export async function registerPolarUser(args: {
  accessToken: string;
  memberId: string;
}): Promise<void> {
  const res = await fetch(`${POLAR.API_BASE}/users`, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ "member-id": args.memberId }),
  });
  if (res.status === 403) {
    throw new PolarError("consent_required", "Polar consent required");
  }
  if (!res.ok && res.status !== 409) {
    throw new PolarError("registration_failed", `Polar user registration failed: ${res.status}`);
  }
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

/** GET /users/sleep → one partial row per night (sleep fields). */
export async function fetchPolarSleep(accessToken: string): Promise<PolarDailyRow[]> {
  const res = await fetch(`${POLAR.API_BASE}/users/sleep`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (res.status === 403) throw new PolarError("consent_required", "Polar consent required");
  if (res.status === 401) throw new PolarError("invalid_grant", "Polar token revoked");
  if (res.status === 404) return [];
  if (!res.ok) return [];

  const data = (await res.json()) as { nights?: Record<string, unknown>[] };
  const out: PolarDailyRow[] = [];
  for (const night of data.nights ?? []) {
    const date = night.date as string | undefined;
    if (!date) continue;
    const toMin = (s: unknown) => (typeof s === "number" ? Math.round(s / 60) : 0);
    const light = toMin(night.light_sleep);
    const deep = toMin(night.deep_sleep);
    const rem = toMin(night.rem_sleep);
    out.push({
      source: "polar",
      date,
      sleep_score: num(night.sleep_score),
      light_sleep_duration: light,
      deep_sleep_duration: deep,
      rem_sleep_duration: rem,
      total_sleep_duration: light + deep + rem,
    });
  }
  return out;
}

/** Parse an ISO-8601 duration (PT#H#M#S) into seconds. */
function parseIsoDuration(iso: unknown): number {
  if (typeof iso !== "string") return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** GET /exercises → one partial row per day (activity fields), aggregated. */
export async function fetchPolarExercises(accessToken: string): Promise<PolarDailyRow[]> {
  const res = await fetch(`${POLAR.API_BASE}/exercises?samples=true&zones=true&route=false`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (res.status === 403) throw new PolarError("consent_required", "Polar consent required");
  if (res.status === 401) throw new PolarError("invalid_grant", "Polar token revoked");
  if (res.status === 404) return [];
  if (!res.ok) return [];

  const raw = (await res.json()) as
    | Record<string, unknown>[]
    | { exercises?: Record<string, unknown>[] };
  const exercises = Array.isArray(raw) ? raw : (raw.exercises ?? []);

  const byDay = new Map<string, Record<string, unknown>[]>();
  for (const ex of exercises) {
    const start = ex.start_time as string | undefined;
    if (!start) continue;
    const day = start.slice(0, 10);
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(ex);
  }

  const out: PolarDailyRow[] = [];
  for (const [date, list] of byDay) {
    const primary = list.reduce((a, b) =>
      parseIsoDuration(b.duration) > parseIsoDuration(a.duration) ? b : a,
    );
    const totalSec = list.reduce((s, e) => s + parseIsoDuration(e.duration), 0);
    const calories = list.reduce((s, e) => s + ((e.calories as number) ?? 0), 0);
    const distanceKm = list.reduce((s, e) => s + ((e.distance as number) ?? 0) / 1000, 0);
    const load = list.reduce(
      (s, e) => s + ((e.training_load_pro as { ["cardio-load"]?: number })?.["cardio-load"] ?? 0),
      0,
    );
    const hr = primary.heart_rate as { average?: number; maximum?: number } | undefined;
    out.push({
      source: "polar",
      date,
      duration_minutes: Math.round(totalSec / 60) || null,
      active_calories: calories || null,
      total_distance_km: distanceKm ? Math.round(distanceKm * 100) / 100 : null,
      avg_heart_rate: hr?.average ?? null,
      max_heart_rate: hr?.maximum ?? null,
      training_load: load || null,
      session_type: (primary.detailed_sport_info as string) ?? (primary.sport as string) ?? null,
    });
  }
  return out;
}
