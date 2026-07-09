// Google Calendar OAuth helpers (per-user).
// Uses the standard Google OAuth 2.0 web flow with offline access + refresh tokens.

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

// Full calendar r/w scope. Swap for `calendar.readonly` if you only need reads.
export const GOOGLE_CALENDAR_SCOPE = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

export function googleCreds() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CALENDAR_CLIENT_ID / GOOGLE_CALENDAR_CLIENT_SECRET");
  }
  return { clientId, clientSecret };
}

export function googleRedirectUri() {
  const base = process.env.BUDDY_APP_BASE_URL ?? "https://peakbuddy.lovable.app";
  return (
    process.env.GOOGLE_CALENDAR_REDIRECT_URI ??
    `${base}/api/public/google-calendar/callback`
  );
}

export function generateState(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export function buildGoogleAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const q = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent", // ensures we get a refresh_token on re-auth
    state: params.state,
  });
  return `${GOOGLE_AUTH_URL}?${q.toString()}`;
}

export type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
};

export async function exchangeCodeForToken(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Google token exchange failed [${res.status}]: ${t}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

export async function refreshGoogleToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Google token refresh failed [${res.status}]: ${t}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

export async function fetchGoogleUserEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { email?: string };
    return j.email ?? null;
  } catch {
    return null;
  }
}

// ---- Calendar API (event writing) ----------------------------------------

const CALENDAR_EVENTS_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/**
 * Return a valid access token for the user, refreshing via the stored refresh
 * token when the current one is expired (or about to be). Updates the DB row.
 * `db` is the service-role client.
 */
export async function getFreshGoogleAccessToken(
  db: { from: (t: string) => any },
  userId: string,
): Promise<string | null> {
  const { data: row } = await db
    .from("google_calendar_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return null;

  const expiresAt = row.expires_at ? Date.parse(row.expires_at) : 0;
  const stillValid = expiresAt - Date.now() > 60_000; // 60s safety margin
  if (stillValid && row.access_token) return row.access_token as string;

  if (!row.refresh_token) return (row.access_token as string) ?? null;
  const { clientId, clientSecret } = googleCreds();
  const refreshed = await refreshGoogleToken({
    refreshToken: row.refresh_token as string,
    clientId,
    clientSecret,
  });
  const newExpiry = new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString();
  await db
    .from("google_calendar_tokens")
    .update({ access_token: refreshed.access_token, expires_at: newExpiry })
    .eq("user_id", userId);
  return refreshed.access_token;
}

const DOW_RRULE = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export type GoogleEventInput = {
  summary: string;
  description: string;
  /** "YYYY-MM-DD" first occurrence date. */
  startDate: string;
  /** "HH:MM" or "HH:MM:SS". */
  time: string;
  /** IANA timezone. */
  timeZone: string;
  /** 0=Sun..6=Sat; all 7 (or empty) => daily. */
  daysOfWeek: number[];
  /** Event length in minutes. */
  durationMin?: number;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function buildGoogleEventBody(ev: GoogleEventInput): Record<string, unknown> {
  const t = ev.time.length === 5 ? `${ev.time}:00` : ev.time;
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  const dur = ev.durationMin ?? 15;
  const startDateTime = `${ev.startDate}T${t}`;
  // Compute end time (same day; reminders are short).
  const endMinutes = h * 60 + m + dur;
  const endDateTime = `${ev.startDate}T${pad(Math.floor(endMinutes / 60) % 24)}:${pad(endMinutes % 60)}:00`;

  const days = [...new Set(ev.daysOfWeek)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  const daily = days.length === 0 || days.length === 7;
  const recurrence = daily
    ? "RRULE:FREQ=DAILY"
    : `RRULE:FREQ=WEEKLY;BYDAY=${days.map((d) => DOW_RRULE[d]).join(",")}`;

  return {
    summary: ev.summary,
    description: ev.description,
    start: { dateTime: startDateTime, timeZone: ev.timeZone },
    end: { dateTime: endDateTime, timeZone: ev.timeZone },
    recurrence: [recurrence],
    reminders: {
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 10 },
        { method: "popup", minutes: 0 },
      ],
    },
  };
}

export async function insertGoogleCalendarEvent(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<{ id: string; htmlLink?: string }> {
  const res = await fetch(CALENDAR_EVENTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Calendar insert failed [${res.status}]: ${await res.text()}`);
  }
  const json = (await res.json()) as { id: string; htmlLink?: string };
  return { id: json.id, htmlLink: json.htmlLink };
}

export async function deleteGoogleCalendarEvent(
  accessToken: string,
  eventId: string,
): Promise<void> {
  await fetch(`${CALENDAR_EVENTS_URL}/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => {});
}
