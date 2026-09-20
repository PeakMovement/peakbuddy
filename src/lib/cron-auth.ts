/**
 * Shared gate for POST /api/public/hooks/* cron routes.
 * Fail closed: missing CRON_SECRET or mismatch → 401.
 */
export function authorizeCronRequest(
  request: Request,
  cronSecret: string | undefined = process.env.CRON_SECRET,
): Response | null {
  if (!cronSecret) {
    return new Response("Unauthorized", { status: 401 });
  }
  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("X-Cron-Secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    null;
  if (provided !== cronSecret) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
