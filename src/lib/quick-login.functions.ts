import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------------------------------------------------------------------------
// Quick sign-in with a 4-digit code.
//
// Codes are never stored in readable form: we keep a PBKDF2 hash + per-user
// salt. Verification, lockout and throttling all happen server-side.
// ---------------------------------------------------------------------------

const MAX_FAILED_ATTEMPTS = 5;
const PBKDF2_ITERATIONS = 150_000;

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

async function hashCode(code: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = Uint8Array.from(saltHex.match(/.{2}/g) ?? [], (h) => parseInt(h, 16));
  const key = await crypto.subtle.importKey("raw", enc.encode(code), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return toHex(bits);
}

function newSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
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
    const { supabaseAdmin: gadmin } = await import("@/integrations/supabase/client.server");
    const { data: gProf } = await gadmin
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
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { error } = await admin.from("quick_login_codes").upsert(
      {
        user_id: context.userId,
        code_hash: hash,
        code_salt: salt,
        failed_attempts: 0,
        locked_at: null,
        last_failed_at: null,
      },
      { onConflict: "user_id" },
    );
    if (error) return { ok: false as const, error: "Could not save your code. Try again." };
    return { ok: true as const };
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

    // Resolve the auth user for this email.
    let userId: string | null = null;
    for (let page = 1; page <= 5 && !userId; page += 1) {
      const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      const users = list?.users ?? [];
      const match = users.find((u) => u.email?.toLowerCase() === data.email.toLowerCase());
      if (match) userId = match.id;
      if (users.length < 200) break;
    }
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
    const { data: claimRows } = await admin.rpc("claim_quick_login_attempt", {
      p_user_id: userId,
    });
    const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
    if (!claim || !claim.allowed) {
      // Locked or no code — keep the response generic (no enumeration) and
      // equalize timing.
      await dummyHash(data.code);
      return { ok: false as const, error: GENERIC_ERROR };
    }

    const candidate = await hashCode(data.code, row.code_salt);
    if (!safeEqual(candidate, row.code_hash)) {
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
      })
      .eq("user_id", userId);

    return { ok: true as const, tokenHash };
  });
