## Problem

The wireframe is inconsistent: the practitioner's **Add Client** form generates a 4-digit `login_code` and shows it to share with the client, but the **Client Login** screen asks for **email + password**. Clients receive a code that they can never actually use.

You chose to keep password-based login, so the fix is on the **Add Client** side.

## Changes

### 1. `src/routes/practitioner.app.add-client.tsx`
- Remove all code-generation UI and logic: `genCode`, `generateUniqueCode`, the `code` state, the `RefreshCw` "regenerate" button, and the read-only code display block.
- Replace it with a **Password** field (required, min 8 chars) that the practitioner sets for the client. Add a small "Copy password" helper and a "Generate strong password" button for convenience.
- Make `email` required (it's the login identifier).
- On submit, call a new server function `createClientAccount` (see #2) instead of inserting directly. This is required because creating the Supabase auth user needs the service-role key, which only lives server-side.
- Success message changes from "their login code is 1234" to "Account created. Share these credentials with your client: email + password."

### 2. New server function `src/lib/clients.functions.ts`
- `createClientAccount` — protected with `requireSupabaseAuth` so only the signed-in practitioner can call it.
- Validates input with Zod (email, password ≥ 8 chars, full_name, complaint, frequency, optional notes).
- Uses `supabaseAdmin` to:
  1. Create the auth user (`auth.admin.createUser` with `email_confirm: true`).
  2. Insert the `clients` row with `practitioner_id = context.userId`, `email`, etc.
- Returns `{ clientId }` or a typed error (e.g. "email already in use").
- Handles cleanup if the clients insert fails after the auth user was created.

### 3. `src/start.ts`
- Verify `attachSupabaseAuth` is in `functionMiddleware` so the practitioner's bearer token reaches the new server fn (it should already be wired from previous work; only add if missing).

### 4. Database / schema
- Keep the `login_code` column for now (existing rows depend on it) but stop writing to it from the form. No migration needed for this fix.
- Optional follow-up (not in this change): drop `login_code` once existing demo data is reseeded.

### 5. `scripts/seed-demo.ts`
- No change needed — the demo client already has email `client@demo.com` / password `Demo1234!`, which works with the existing client login.

## Out of scope
- Email-invite flow (magic link / "set your own password"). Can be added later if you prefer clients to choose their own password instead of the practitioner setting one.
- Removing the `login_code` column.
- Any visual redesign beyond swapping the code field for a password field.
