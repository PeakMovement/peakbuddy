## Diagnosis

Two things on that screen:

1. **"Invalid API key"** — The Add Client server function (`src/lib/clients.functions.ts`) builds its own admin client from `process.env.SEED_SERVICE_ROLE_KEY`. That secret value is stale / doesn't match this Cloud project, so Supabase rejects every `auth.admin.createUser` call. The project already has the correct, auto-managed admin client at `@/integrations/supabase/client.server` using `SUPABASE_SERVICE_ROLE_KEY`.
2. **"Screen situation"** — the long red error sits flush under the password helper text with no spacing/box, which is what looks visually broken in the screenshot.

## Fix

1. **Rewrite `src/lib/clients.functions.ts`** to use the managed admin client:
   - Remove `SEED_SERVICE_ROLE_KEY` and the manual `createClient(...)` block.
   - Inside the `.handler`, `const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");` (per TanStack rule: server-only import stays inside the handler).
   - Keep all existing behavior: createUser → fallback to listUsers + updateUserById if email exists → insert into `public.clients` with the same payload and return shape.

2. **Polish the error display in `src/routes/practitioner.app.add-client.tsx`**:
   - Wrap the `error` message in a bordered red card (matching the green success card already above it) with padding, rounded corners, and `margin-top`, so it reads as an alert rather than stray red text crammed against the helper line.
   - No logic changes.

## Out of scope

- No DB migration. The role-escalation trigger isn't involved (this writes to `clients`, not `profiles`).
- No UI restructure of the form itself.

## Verification

Submit the form again as the practitioner:
- Expected: green success card with email + generated password, fields reset.
- The "Invalid API key" red text no longer appears.
