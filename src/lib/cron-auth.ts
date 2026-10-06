/**
 * Shared gate for POST /api/public/hooks/* cron routes. Fail closed.
 *
 * A request is let in when its secret (x-cron-secret header, or
 * "Authorization: Bearer ...") matches either:
 *  - the CRON_SECRET environment setting, or
 *  - the 'cron_secret' value in Supabase Vault, checked inside the database
 *    by public.verify_cron_secret (migration 0018). The scheduled jobs read
 *    that same Vault value when they run, so the two always match and nobody
 *    ever has to copy a secret between screens.
 *
 * The secret itself is never returned to the app; the database only answers
 * yes or no.
 */

function providedSecret(request: Request): string | null {
  return (
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    null
  );
}

/** The synchronous check against CRON_SECRET only. Null means allowed. */
export function authorizeCronRequestEnv(
  request: Request,
  cronSecret: string | undefined = process.env.CRON_SECRET,
): Response | null {
  const provided = providedSecret(request);
  if (cronSecret && provided && provided === cronSecret) return null;
  return new Response("Unauthorized", { status: 401 });
}

type VaultCheck = (token: string) => Promise<boolean>;

async function vaultCheck(token: string): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (
      supabaseAdmin as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: unknown }>;
      }
    ).rpc("verify_cron_secret", { p_token: token });
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Null means allowed; otherwise the 401 to return. */
export async function authorizeCronRequest(
  request: Request,
  cronSecret: string | undefined = process.env.CRON_SECRET,
  checkVault: VaultCheck = vaultCheck,
): Promise<Response | null> {
  if (!authorizeCronRequestEnv(request, cronSecret)) return null;
  const provided = providedSecret(request);
  if (provided && provided.length >= 32 && (await checkVault(provided))) return null;
  return new Response("Unauthorized", { status: 401 });
}
