# Harden Buddy's forgot-password flow

## Problem
Users can request a password-reset email, but after they set a new password on `/reset-password` the new password sometimes fails at login. The flow needs to be more robust against recovery-session timing, typos, and expired links.

## What we will change

1. **Harden `/reset-password` recovery-session handling**
   - Explicitly detect `type=recovery` in the URL hash.
   - Use `onAuthStateChange` + `getSession()` together so the recovery token is exchanged into a session before the user submits the new password.
   - Increase the readiness wait window and surface a clearer message if the link is expired/invalid.
   - Clear the hash fragment after the session is consumed so a refresh doesn't re-attempt an already-used token.

2. **Improve the reset form UX**
   - Add show/hide toggles on both password fields to reduce accidental typos.
   - Show a short "Password saved" success state before redirecting.
   - Disable the form during submission and show backend error messages (e.g. "This link has expired").

3. **Improve forgot-password feedback on login pages**
   - Keep the privacy-preserving "If that email is registered..." copy for unknown addresses.
   - Surface actionable errors for real failures such as rate-limit, network error, or unverified domain.
   - Add a send cooldown so users can't request multiple links in quick succession.

4. **Verify the recovery email template**
   - Confirm the managed auth/reset-password email points to `${window.location.origin}/reset-password` and includes the recovery token in the URL fragment as expected by the Supabase client.

5. **End-to-end verification**
   - Test the full flow in a headless browser: request reset → click link → set password → sign in with new password.
   - Confirm the temporary password set during support can be replaced by the user-driven reset flow.

## Out of scope
- No changes to brand colors, icons, or Instagram assets.
- No changes to email-sending provider; this only fixes the client-side reset flow and template link format.

## Acceptance criteria
- A practitioner or client can request a reset, set a new password, and sign in with it on the first try.
- Expired/invalid links show a clear message and a link back to sign-in.
- The flow is tested in a browser and passes `npx tsgo --noEmit` / `npm run build`.
