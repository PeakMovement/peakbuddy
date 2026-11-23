/**
 * "Connect your watch" links sent on WhatsApp.
 *
 * The link opens /connect-watch and starts the same Garmin / Oura / Polar
 * OAuth flow the app uses, for that profile. It works whether or not the
 * client also has a Buddy app login, so WhatsApp never asks them to sign in.
 * The in-app Wearables section stays for people who are already in the app.
 *
 * Token: `<clientId>.<expiry seconds>.<signature>`, HMAC-SHA256 signed and
 * domain-separated ("buddy-watch-link-v1"), valid 7 days. Stateless, so no
 * table or migration. Reusable within its lifetime because people may connect
 * more than one device; the most it allows is linking a device to that one
 * profile, and the OAuth step still needs the device owner's own login.
 */

const TTL_SECONDS = 7 * 24 * 60 * 60;
const DOMAIN = "buddy-watch-link-v1";
const SIG_HEX = 32; // 128 bits, keeps the WhatsApp link short

function secret(): string | null {
  return (
    process.env.WATCH_LINK_SECRET ??
    process.env.ALERT_ACTION_SECRET ??
    process.env.META_APP_SECRET ??
    null
  );
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sign(key: string, payload: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${DOMAIN}|${payload}`));
  return toHex(sig).slice(0, SIG_HEX);
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A fresh token for this profile, or null if no signing secret is configured. */
export async function mintWatchToken(
  clientId: string,
  now: Date = new Date(),
  key: string | null = secret(),
): Promise<string | null> {
  if (!key || !UUID.test(clientId)) return null;
  const exp = Math.floor(now.getTime() / 1000) + TTL_SECONDS;
  return `${clientId}.${exp}.${await sign(key, `${clientId}|${exp}`)}`;
}

/** The profile a token is for, if it is genuine and unexpired. */
export async function verifyWatchToken(
  token: string,
  now: Date = new Date(),
  key: string | null = secret(),
): Promise<string | null> {
  if (!key) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [clientId, expRaw, sig] = parts;
  if (!UUID.test(clientId) || !/^\d{9,11}$/.test(expRaw)) return null;
  const exp = Number(expRaw);
  if (exp * 1000 < now.getTime()) return null;
  return sameHex(sig, await sign(key, `${clientId}|${exp}`)) ? clientId : null;
}

/** The page link Buddy sends on WhatsApp. */
export function watchLinkUrl(origin: string, token: string): string {
  return `${origin}/connect-watch?t=${encodeURIComponent(token)}`;
}

/** ISO expiry carried in a token, or null if the token is not shaped like one. */
export function watchTokenExpiresAt(token: string): string | null {
  const expRaw = token.split(".")[1] ?? "";
  if (!/^\d{9,11}$/.test(expRaw)) return null;
  return new Date(Number(expRaw) * 1000).toISOString();
}

const WATCH_OAUTH_PREFIX = "w.";

/**
 * OAuth `state` from /connect-watch is prefixed so the callback can return
 * there. In-app connects keep a plain random state and return to the profile.
 */
export function prefixWatchOAuthState(state: string, returnTo: "app" | "watch" = "app"): string {
  return returnTo === "watch" ? `${WATCH_OAUTH_PREFIX}${state}` : state;
}

export function connectStartedOnWatchLink(state: string | null | undefined): boolean {
  return typeof state === "string" && state.startsWith(WATCH_OAUTH_PREFIX);
}

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

/**
 * Where an OAuth callback sends the browser.
 *
 * A connect that started on /connect-watch always returns there, including
 * when the client also has an app login. An in-app connect still returns to
 * the profile Wearables section for a client who can sign in, and to the
 * public page when they cannot.
 */
export async function wearableReturnUrl(
  admin: Admin,
  base: string,
  clientId: string | null,
  provider: string,
  status: string,
  fromWatchLink = false,
): Promise<string> {
  const appUrl = `${base}/client/app/profile?wearable=${provider}&status=${status}`;
  const publicUrl = async (): Promise<string | null> => {
    if (!clientId) return null;
    const token = await mintWatchToken(clientId);
    if (!token) return null;
    return `${watchLinkUrl(base, token)}&wearable=${provider}&status=${status}`;
  };
  if (fromWatchLink) {
    return (await publicUrl()) ?? `${base}/connect-watch?wearable=${provider}&status=${status}`;
  }
  if (!clientId) return appUrl;
  try {
    const { data } = await admin
      .from("clients")
      .select("auth_user_id")
      .eq("id", clientId)
      .maybeSingle();
    if (data && !(data as { auth_user_id: string | null }).auth_user_id) {
      return (await publicUrl()) ?? appUrl;
    }
  } catch {
    /* fall back to the app */
  }
  return appUrl;
}
