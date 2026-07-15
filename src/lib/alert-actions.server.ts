// Server-only helpers for practitioner alert action links (Request check-in,
// Mark reviewed). Tokens are HMAC-SHA256 signed with ALERT_ACTION_SECRET,
// single-use (enforced by used_at), and expire after 7 days.

import { createHmac, timingSafeEqual, randomBytes, createHash } from "crypto";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AlertAction = "checkin" | "reviewed";

function secret(): string {
  const s = process.env.ALERT_ACTION_SECRET;
  if (!s) throw new Error("ALERT_ACTION_SECRET is not configured");
  return s;
}

function signPayload(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mint a fresh alert action token, persist its hash + metadata, and return the
 * raw token string suitable for embedding in an email URL. The token itself is
 * `<random>.<hmac>` — nothing sensitive; the DB row is the source of truth for
 * validity and single-use.
 */
export async function mintAlertActionToken(args: {
  alertId: string;
  practitionerId: string;
  action: AlertAction;
}): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const nonce = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  const payload = `${args.alertId}|${args.practitionerId}|${args.action}|${expiresAt.toISOString()}|${nonce}`;
  const sig = signPayload(payload);
  const token = `${nonce}.${sig}`;
  const token_hash = hashToken(token);

  const { error } = await supabaseAdmin.from("alert_action_tokens").insert({
    alert_id: args.alertId,
    practitioner_id: args.practitionerId,
    action: args.action,
    token_hash,
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw error;
  return token;
}

export type VerifiedToken = {
  alertId: string;
  practitionerId: string;
  action: AlertAction;
  tokenRowId: string;
};

export type VerifyResult =
  | { ok: true; token: VerifiedToken }
  | { ok: false; reason: "not_found" | "expired" | "already_used" | "bad_signature" };

/**
 * Look up the token by hash. Reject if missing, expired, already used, or the
 * signature over the row's payload doesn't match.
 */
export async function verifyAlertActionToken(rawToken: string): Promise<VerifyResult> {
  if (!rawToken || !rawToken.includes(".")) return { ok: false, reason: "not_found" };
  const [nonce, sig] = rawToken.split(".");
  if (!nonce || !sig) return { ok: false, reason: "not_found" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const token_hash = hashToken(rawToken);
  const { data: row } = await supabaseAdmin
    .from("alert_action_tokens")
    .select("id, alert_id, practitioner_id, action, expires_at, used_at")
    .eq("token_hash", token_hash)
    .maybeSingle();
  if (!row) return { ok: false, reason: "not_found" };
  if (row.used_at) return { ok: false, reason: "already_used" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };

  // Re-derive signature and compare.
  const payload = `${row.alert_id}|${row.practitioner_id}|${row.action}|${new Date(row.expires_at).toISOString()}|${nonce}`;
  const expected = signPayload(payload);
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  return {
    ok: true,
    token: {
      alertId: row.alert_id,
      practitionerId: row.practitioner_id,
      action: row.action as AlertAction,
      tokenRowId: row.id,
    },
  };
}

/** Mark a token used. Idempotent. */
export async function consumeAlertActionToken(tokenRowId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("alert_action_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", tokenRowId)
    .is("used_at", null);
}
