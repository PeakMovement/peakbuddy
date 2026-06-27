## Goal

Let clients (and optionally practitioners) sign in without typing a password every time. Two complementary pieces:

1. **Remember me** — keep the user signed in across app launches by default, with an opt-out.
2. **Magic link** — "Email me a sign-in link" button so a user who *did* get signed out doesn't have to remember a password at all; they tap the link in their email and land back in the app already signed in.

Both work the same in Safari and inside the Despia WebView — no iOS-specific APIs.

## What changes for the user

On `/client/login` (and `/practitioner/login`):

- The existing email + password form stays.
- A new **"Email me a sign-in link"** button appears below the password field. Tapping it sends a one-time link to the entered email and shows a "Check your inbox" confirmation.
- A **"Keep me signed in on this device"** checkbox, checked by default. Unchecking it means the session is cleared when the app/tab closes.
- Tapping the link in the email opens the app at `/auth/callback`, which finishes the sign-in and routes the user to the right home screen (client → Check-in, practitioner → Dashboard).

Existing password login keeps working exactly as today.

## What changes under the hood

- New route `/auth/callback` — public, handles the Supabase magic-link redirect, resolves the user's role, and forwards to `/client/app/checkin` or `/practitioner/app/dashboard`.
- New "send magic link" action on both login screens calling `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: '<origin>/auth/callback' } })`.
- "Remember me" toggle switches the Supabase client's session storage between `localStorage` (persistent — current behavior) and `sessionStorage` (cleared on app close).
- The Supabase **Magic Link** email template needs to point at `https://peakbuddy.lovable.app/auth/callback` (and the preview URL) in the allow-list. I'll scaffold the auth email templates with `email_domain--scaffold_auth_email_templates` so the magic-link email is branded to PeakBuddy instead of the generic Supabase default.

## Edge cases handled

- **Unknown email** — Supabase still returns success (so attackers can't enumerate users). UI says "If that email is registered, a link is on the way."
- **Client vs practitioner** — `/auth/callback` looks up the user's `profiles.role` and routes accordingly, same logic as today's password login.
- **Despia WebView opens the link in Safari, not the app** — common with iOS WebViews. Mitigation: the callback page detects this and shows a "Return to the PeakBuddy app and you're signed in" message; the session is already saved in browser storage that the WebView shares for the same domain. (If users report it doesn't carry over, the fallback is a one-time 6-digit OTP code emailed instead of a link — I can add that next.)
- **Rate limiting** — disable the button for 60 seconds after a send to avoid spam.

## Files I'll touch

- `src/routes/auth.callback.tsx` (new) — handles the magic-link return.
- `src/routes/client.login.tsx` — add magic-link button + remember-me checkbox.
- `src/routes/practitioner.login.tsx` — same additions.
- `src/lib/supabase.ts` / `src/integrations/supabase/client.ts` — switchable session storage based on the remember-me preference (stored in `localStorage` itself).
- Auth email templates via `email_domain--scaffold_auth_email_templates` so the magic-link email is branded.

## Out of scope (ask if you want them)

- Sign in with Apple / Google (one-tap, no email at all — different but related).
- 6-digit OTP code as a fallback to magic links.
- Practitioner magic links (I'll include them by default; say if you want clients only).

Shall I build this for both client and practitioner logins?