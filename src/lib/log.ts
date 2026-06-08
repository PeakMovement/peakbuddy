// Central logger — use instead of console.* (enforced by ESLint no-console).
// debug/info are silenced in production builds; warn/error always emit.
//
// PHI safety: never log free-text symptom descriptions, names, emails or
// phone numbers — log IDs and status codes instead. sanitize() redacts known
// PHI keys from plain objects as a backstop, not a licence.

const PHI_KEYS = new Set([
  "email", "full_name", "fullname", "clientname", "client_name", "phone",
  "query_text", "symptomdescription", "symptom_description", "notes",
  "password", "token", "access_token", "login_code",
]);

function sanitize(value: unknown): unknown {
  if (value instanceof Error) return value;
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = PHI_KEYS.has(k.toLowerCase()) ? "[redacted]" : sanitize(v);
    }
    return out;
  }
  return value;
}

const isProd =
  typeof import.meta !== "undefined" &&
  Boolean((import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD);

/* eslint-disable no-console */
export const log = {
  debug: (...args: unknown[]) => {
    if (!isProd) console.debug(...args.map(sanitize));
  },
  info: (...args: unknown[]) => {
    if (!isProd) console.info(...args.map(sanitize));
  },
  warn: (...args: unknown[]) => console.warn(...args.map(sanitize)),
  error: (...args: unknown[]) => console.error(...args.map(sanitize)),
};
/* eslint-enable no-console */
