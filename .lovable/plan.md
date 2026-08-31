# Quick sign-in with a 4-digit code

Let clients, practitioners and admins skip typing their email + password every time. After their first normal login they can set a 4-digit code, then sign in with **email + 4-digit code**.

## How it will feel

1. First login is normal (email + password) — unchanged.
2. Straight after that first successful login, a one-time prompt appears: "Set a 4-digit quick code?" — enter code, confirm code, or skip (can be set later in Profile/Settings).
3. On the login screens there's a "Use quick code" toggle. The user enters their email and taps 4 digits on a large keypad — signed in.
4. The code can be changed or turned off any time from Profile (client) / Settings (practitioner and admin).
5. Sessions from a quick-code login last 90 days, matching the existing idle sign-out behaviour.
6. After 5 wrong codes the quick code is locked; the user must sign in with email + password, which unlocks it again.

## Security notes (important)

A 4-digit code that works from any device is weaker than a password, so the plan adds:

- Codes are never stored in readable form — only a salted hash, checked on the server.
- Server-side attempt counter per account: 5 failures locks quick sign-in until a full password login.
- Extra throttle: a short cool-down after 3 rapid failures to block automated guessing.
- Obvious codes (0000, 1234, 1111, repeated/sequential digits) rejected when setting.
- Quick sign-in never reveals whether an email exists.
- Quick code is disabled automatically on password reset, and the practitioner-visible client `login_code` field stays separate from this (it is not the quick code).

## Technical approach

**Database (one migration)**

- New table `public.quick_login_codes`: `user_id` (PK, references auth users), `code_hash`, `code_salt`, `failed_attempts`, `locked_at`, `last_used_at`, `created_at`, `updated_at`.
- RLS: no direct client access (all reads/writes go through server functions with the service role); `GRANT ALL` to `service_role` only, plus the standard `updated_at` trigger.

**Server functions** — new `src/lib/quick-login.functions.ts`, following existing patterns:

- `setQuickCode` / `clearQuickCode` / `getQuickCodeStatus` — `.middleware([requireSupabaseAuth])`, zod-validated 4-digit input, hashing via Web Crypto (`crypto.subtle`, PBKDF2 with per-user salt) to stay Worker-compatible.
- `signInWithQuickCode` — public function taking `{ email, code }`. Looks up the user with the admin client, verifies the hash, applies lockout/throttle rules, and on success mints a one-time magic-link token (`admin.auth.admin.generateLink`) and returns its `token_hash`. The browser exchanges it via `supabase.auth.verifyOtp` to create a real session. Generic error text on every failure path.

**UI**

- Shared `<QuickCodeKeypad />` component (brand tokens only: navy card, cold-blue accent) plus a `<SetQuickCodePrompt />` modal.
- `src/routes/client.login.tsx`, `practitioner.login.tsx`, `admin.login.tsx`: add the "Use quick code" mode alongside existing password + magic-link options.
- Post-login prompt shown once, tracked in `localStorage` per user, on `client.app.tsx` / `practitioner.app.tsx` / `admin.app.tsx`.
- Manage/disable rows added to `client.app.profile.tsx`, `practitioner.app.settings.tsx`, `admin.app.settings.tsx`.
- `src/lib/idle-signout.ts`: extend the max idle window to 90 days for quick-code sessions.

No existing login flow is removed — email + password and the magic link keep working exactly as they do now.
