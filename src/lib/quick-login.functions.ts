import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { findAuthUserIdByEmail } from "@/lib/find-auth-user";

// ---------------------------------------------------------------------------
// Quick sign-in with a 4-digit code.
//
// Codes are never stored in readable form: we keep a PBKDF2 hash + per-user
// salt. Verification, lockout and throttling all happen server-side.
// ---------------------------------------------------------------------------

// Cloudflare Workers' WebCrypto caps PBKDF2 at 100k iterations; going higher
// throws "iteration counts above 100000 are not supported". 100k is the max
// supported and is ample here — the real brute-force protection is the
// server-side 5-attempt lockout, not the hash cost of a 4-digit code.
const PBKDF2_ITERATIONS = 100_000;

// Codes set before the 100k change were hashed at 150k, so they stopped
// verifying the moment the constant moved — the client typed their usual code,
// got "that email and code combination didn't work", and burned their five
// attempts into a lockout. Hashes are one-way so they can't be migrated in
// place; instead we verify against the old cost as a fallback and silently
// re-hash to the current cost on the next successful sign-in.
const LEGACY_PBKDF2_ITERATIONS = 150_000;

const WEAK_CODES = new Set([
  "0000",
  "1111",
  "2222",
  "3333",
  "4444",
  "5555",
  "6666",
  "7777",
  "8888",
  "9999",
  "1234",
  "2345",
  "3456",
  "4567",
  "5678",
  "6789",
  "0123",
  "9876",
  "8765",
  "7654",
  "6543",
  "5432",
  "4321",
  "3210",
]);

const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{4}$/, "Code must be exactly 4 digits");

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashCode(
  code: string,
  saltHex: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
  const enc = new TextEncoder();
  const salt = Uint8Array.from(saltHex.match(/.{2}/g) ?? [], (h) => parseInt(h, 16));
  try {
    const subtle = (globalThis.crypto ?? crypto).subtle;
    const key = await subtle.importKey("raw", enc.encode(code), "PBKDF2", false, [
      "deriveBits",
    ]);
    const bits = await subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      key,
      256,
    );
    return toHex(bits);
  } catch {
    // Fallback for server runtimes where WebCrypto PBKDF2 isn't available, and
    // for the legacy cost — Cloudflare's WebCrypto refuses iteration counts
    // above 100k outright, so the old 150k hash can only be recomputed here.
    const nodeCrypto = await import("node:crypto");
    const derived = nodeCrypto.pbkdf2Sync(code, Buffer.from(saltHex, "hex"), iterations, 32, "sha256");
    return derived.toString("hex");
  }
}

/** Same as hashCode but yields null instead of throwing — used for the
 *  best-effort legacy check, which must never break a normal sign-in. */
async function hashCodeOrNull(
  code: string,
  saltHex: string,
  iterations: number,
): Promise<string | null> {
  try {
    return await hashCode(code, saltHex, iterations);
  } catch {
    return null;
  }
}

function newSalt(): string {
  const bytes = new Uint8Array(16);
  try {
    (globalThis.crypto ?? crypto).getRandomValues(bytes);
    return toHex(bytes.buffer);
  } catch {
    // Non-crypto fallback for runtimes without WebCrypto (the salt only needs to
    // be unique per user, not cryptographically strong on its own).
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return toHex(bytes.buffer);
  }
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Run a throwaway PBKDF2 so "no such email / no code / locked" paths take about
// the same time as a real verify — removes the timing oracle that would reveal
// which emails have quick sign-in enabled.
const DUMMY_SALT = "00000000000000000000000000000000";
async function dummyHash(code: string): Promise<void> {
  try {
    await hashCode(code, DUMMY_SALT);
  } catch {
    /* ignore */
  }
}

// --- Status -----------------------------------------------------------------

export const getQuickCodeStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data } = await admin
      .from("quick_login_codes")
      .select("locked_at, last_used_at, created_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    return {
      enabled: Boolean(data),
      locked: Boolean(data?.locked_at),
      lastUsedAt: data?.last_used_at ?? null,
    };
  });

// --- Set / change -----------------------------------------------------------

export const setQuickCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ code: codeSchema }).parse(input))
  .handler(async ({ data, context }) => {
    // Fully guarded: this handler must never reject, so the client always gets a
    // precise reason instead of a generic "couldn't save".
    try {
      const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

      const { data: gProf } = await admin
        .from("profiles")
        .select("role")
        .eq("id", context.userId)
        .maybeSingle();
      if (gProf?.role === "super_admin") {
        return {
          ok: false as const,
          error: "Quick sign-in isn't available for admin accounts. Use your full password.",
        };
      }
      if (WEAK_CODES.has(data.code)) {
        return {
          ok: false as const,
          error: "That code is too easy to guess. Choose another 4 digits.",
        };
      }

      const salt = newSalt();
      const hash = await hashCode(data.code, salt);

      // Replace any existing row for this user. delete-then-insert avoids a
      // dependency on an ON CONFLICT unique constraint (which, if missing, makes
      // upsert fail every time).
      await admin.from("quick_login_codes").delete().eq("user_id", context.userId);
      const { error } = await admin.from("quick_login_codes").insert({
        user_id: context.userId,
        code_hash: hash,
        code_salt: salt,
        failed_attempts: 0,
        locked_at: null,
        last_failed_at: null,
      });
      if (error) {
        return { ok: false as const, error: error.message || "Could not save your code. Try again." };
      }
      return { ok: true as const };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : "Could not save your code. Try again.",
      };
    }
  });

// --- Remove -----------------------------------------------------------------

export const clearQuickCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    await admin.from("quick_login_codes").delete().eq("user_id", context.userId);
    return { ok: true as const };
  });

// Clears the lockout after a successful full email + password login.
export const unlockQuickCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    await admin
      .from("quick_login_codes")
      .update({ failed_attempts: 0, locked_at: null, last_failed_at: null })
      .eq("user_id", context.userId);
    return { ok: true as const };
  });

// --- Sign in ----------------------------------------------------------------

const GENERIC_ERROR = "That email and code combination didn't work.";

export const signInWithQuickCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ email: z.string().trim().email().max(255), code: codeSchema }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    // Resolve the auth user for this email (pages through the full user list).
    const userId: string | null = await findAuthUserIdByEmail(admin, data.email);
    if (!userId) {
      await dummyHash(data.code);
      return { ok: false as const, error: GENERIC_ERROR };
    }

    // Never allow quick sign-in for admin accounts (4 digits is too weak for
    // the highest-privilege role), regardless of any code they may have set.
    const { data: prof } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    if (prof?.role === "super_admin") {
      await dummyHash(data.code);
      return { ok: false as const, error: GENERIC_ERROR };
    }

    const { data: row } = await admin
      .from("quick_login_codes")
      .select("code_hash, code_salt")
      .eq("user_id", userId)
      .maybeSingle();
    if (!row) {
      await dummyHash(data.code);
      return { ok: false as const, error: GENERIC_ERROR };
    }

    // Atomically consume an attempt (bounded lockout — brute-force safe).
    const { data: claimRows } = await (admin.rpc as CallableFunction)(
      "claim_quick_login_attempt",
      { p_user_id: userId },
    );
    const claim = (Array.isArray(claimRows) ? claimRows[0] : claimRows) as
      | { allowed?: boolean }
      | null;
    if (!claim || !claim.allowed) {
      // Locked or no code — keep the response generic (no enumeration) and
      // equalize timing.
      await dummyHash(data.code);
      return { ok: false as const, error: GENERIC_ERROR };
    }

    const candidate = await hashCode(data.code, row.code_salt);
    let matched = safeEqual(candidate, row.code_hash);
    let needsRehash = false;

    if (!matched) {
      // Fall back to the pre-100k cost so codes set before that change still
      // work. Silent to the client either way.
      const legacy = await hashCodeOrNull(data.code, row.code_salt, LEGACY_PBKDF2_ITERATIONS);
      if (legacy && safeEqual(legacy, row.code_hash)) {
        matched = true;
        needsRehash = true;
      }
    }

    if (!matched) {
      // The attempt was already consumed atomically by the RPC above.
      return { ok: false as const, error: GENERIC_ERROR };
    }

    // Correct code — mint a one-time magic link token for the browser to exchange.
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: data.email,
    });
    const tokenHash = link?.properties?.hashed_token ?? null;
    if (linkErr || !tokenHash) {
      return { ok: false as const, error: "Could not start your session. Try again." };
    }

    await admin
      .from("quick_login_codes")
      .update({
        failed_attempts: 0,
        locked_at: null,
        last_failed_at: null,
        last_used_at: new Date().toISOString(),
        // Carry a legacy-cost hash forward to the current cost so this only
        // ever happens once per user.
        ...(needsRehash ? { code_hash: candidate } : {}),
      })
      .eq("user_id", userId);

    return { ok: true as const, tokenHash };
  });
