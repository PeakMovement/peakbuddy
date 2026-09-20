/**
 * Single helper for public origin used in emails, OAuth redirects, and OG tags.
 *
 * Set BUDDY_APP_BASE_URL (and VITE_BUDDY_APP_BASE_URL for the browser bundle)
 * to https://buddy.peakmovement.co.za in production. When unset, server
 * redirects keep the historic Lovable origin so existing deploys and Supabase
 * redirect allow-lists do not break.
 */
export const CANONICAL_APP_ORIGIN = "https://buddy.peakmovement.co.za";
export const LEGACY_APP_ORIGIN = "https://peakbuddy.lovable.app";

function envBase(): string | undefined {
  const raw =
    (typeof process !== "undefined" ? process.env.BUDDY_APP_BASE_URL : undefined) ||
    (typeof import.meta !== "undefined"
      ? (import.meta.env?.VITE_BUDDY_APP_BASE_URL as string | undefined)
      : undefined);
  if (!raw || !raw.trim()) return undefined;
  return raw.trim().replace(/\/$/, "");
}

/** Emails, OAuth, magic-link redirects. Never uses window.location. */
export function appBaseUrl(): string {
  return envBase() || LEGACY_APP_ORIGIN;
}

/** Public marketing/legal canonical host (privacy, support, OG). */
export function publicSiteOrigin(): string {
  return envBase() || CANONICAL_APP_ORIGIN;
}

export function passwordResetRedirectUrl(): string {
  return `${appBaseUrl()}/reset-password`;
}
