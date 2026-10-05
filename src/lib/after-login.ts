/**
 * Where to send a patient after they sign in, when they arrived at a page
 * inside the app while signed out. The WhatsApp agent sends links straight to
 * /client/app/profile#wearables; without this, signing in would drop them on
 * the check-in screen and they would have to find Wearables themselves.
 *
 * Only paths inside /client/app/ are ever honoured, so this can never be used
 * to bounce someone to another site.
 */

const KEY = "buddy.after_login";

export function rememberReturnTo(pathWithHash: string): void {
  try {
    if (isSafe(pathWithHash)) window.sessionStorage.setItem(KEY, pathWithHash);
  } catch {
    /* private mode or storage blocked: fall back to the default landing page */
  }
}

/** Reads and clears the remembered destination. */
export function takeReturnTo(): { to: string; hash?: string } | null {
  let value: string | null = null;
  try {
    value = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  return value && isSafe(value) ? splitHash(value) : null;
}

export function isSafe(path: string): boolean {
  return /^\/client\/app\/[a-z0-9/_-]*(#[a-z0-9_-]+)?$/i.test(path);
}

export function splitHash(path: string): { to: string; hash?: string } {
  const i = path.indexOf("#");
  return i === -1 ? { to: path } : { to: path.slice(0, i), hash: path.slice(i + 1) };
}
