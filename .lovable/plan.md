## What's going wrong

When a practitioner adds a client, two things happen in `createClientAccount`:

1. An auth user is created for the client's email.
2. A row is inserted into the `clients` table.

The order is the problem. The auth user is created **first**, which fires the `on_auth_user_created` trigger (`handle_new_user`). That trigger tries to link the new auth user to an existing `clients` row by matching email — but the row does not exist yet, so nothing gets linked. Then the `clients` row is inserted **without** `auth_user_id`.

I confirmed this against the live data: the `clients` row for `justin@peakmovement.co.za` exists, the auth user exists, but `clients.auth_user_id` is `NULL`.

The client login page then signs the user in successfully, but the follow-up lookup `select id from clients where email = ...` runs under that user's session. The clients RLS policy only lets a signed-in client see their own row via `auth_user_id = auth.uid()`. With `auth_user_id` still `NULL`, the policy filters the row out and the UI shows "No client record found for this account."

## Fix

One small change plus a backfill:

1. In `src/lib/clients.functions.ts` (`createClientAccount`), set `auth_user_id: userId` on the `clients` insert. This is the only behaviour change. Both the create-user and find-existing-user branches already populate `userId` before the insert runs.

2. Backfill existing broken rows with a one-off migration that links any `clients` row whose `auth_user_id` is `NULL` to the matching `auth.users.id` by lowercased email. This unblocks Justin and any other client already added during testing.

Nothing else needs to change. The login flow, RLS policies, and the email-confirmation linking trigger all stay as they are.

## Out of scope

- No changes to the login UI, the helper copy, or the practitioner add-client form.
- No change to how passwords are set (still practitioner-set, as today).
- No change to RLS or the existing triggers.
