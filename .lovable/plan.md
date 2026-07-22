## Goal
When a practitioner adds a new client, the welcome email should let the client set their own password instead of only offering the temporary one shared by the practitioner.

## Changes

### 1. Generate a "set password" link when creating the client
`src/lib/clients.functions.ts` — after the auth user is created/updated and before sending the welcome email, mint a recovery link with the admin client:

```
admin.auth.admin.generateLink({
  type: "recovery",
  email: data.email,
  options: { redirectTo: "https://peakbuddy.lovable.app/reset-password" },
});
```

Pass the resulting `action_link` into the email as `setPasswordUrl`. If link generation fails, still send the email (fallback to the temporary password copy).

### 2. Update the welcome email template
`src/lib/email-templates/client-welcome.tsx`:
- Add `setPasswordUrl?: string` prop.
- Reword the body so the primary CTA becomes **"Set your password"** (when the URL is present), with a short line explaining they can pick their own password.
- Keep **"Sign in to Buddy"** as a secondary link and keep the "temporary password your practitioner shared" fallback text only when `setPasswordUrl` is absent.
- Update `previewData` with a sample URL.

No changes to `registry.ts` (same template name).

### 3. New public `/reset-password` route
`src/routes/reset-password.tsx` (top-level, public — no auth gate):
- Branded Buddy screen matching `client.login.tsx` styling.
- On mount, wait for Supabase to auto-parse the recovery token from the URL hash (`detectSessionInUrl` is already on) and confirm a session via `supabase.auth.getUser()`.
- Show a "new password" + "confirm password" form (min 8 chars).
- On submit call `supabase.auth.updateUser({ password })`.
- On success, resolve the user's role the same way `auth.callback.tsx` does and redirect (client → `/client/app/checkin`, practitioner → dashboard, admin → admin dashboard).
- Error states: expired/invalid link → prompt to request a new one from the sign-in screen.

### 4. Nothing else touched
- Practitioner add-client form still collects a temporary password (kept as the fallback / immediate access).
- No DB migrations. No changes to `auth.callback.tsx`, `client.login.tsx`, or the invite flow for practitioners.

## Technical notes
- `generateLink` with `type: "recovery"` works whether the user was just created or already existed, so both branches in `createClientAccount` are covered.
- The recovery link puts an access token in the URL hash and Supabase's client persists the session on the reset-password page, which is exactly the state `updateUser({ password })` needs.
- `redirectTo` must be an allow-listed URL in Supabase Auth → URL Configuration. `https://peakbuddy.lovable.app/*` is already used for the app; if the reset link errors with `redirect_to not allowed`, add `https://peakbuddy.lovable.app/reset-password` there.
