-- Fix: client login broken by orphaned RLS policy + missing auth_user_id linkage
--
-- Root cause (June 2026):
--   1. private.current_client_id() maps a signed-in client to their row via
--      auth_user_id = auth.uid(). Clients created before auth_user_id linkage
--      (and not caught by the email-confirmed backfill) have a NULL auth_user_id,
--      so RLS cannot match them to their own row.
--   2. A leftover "clients self read" policy still calls public.current_client_id(),
--      whose EXECUTE was revoked from `authenticated`. When the practitioner-manage
--      policy does not short-circuit (i.e. exactly when auth_user_id is NULL), RLS
--      evaluates this policy and raises "permission denied for function
--      current_client_id" -- surfacing in the app as
--      "No client record found for this account."
--
-- This migration backfills the linkage, removes the orphaned function reference,
-- and restores the intended access model (clients read-only on their own row;
-- only practitioners/admins can write or delete client rows).

-- 1. Backfill auth_user_id for any client with a matching auth user (case-insensitive
--    email). Unlike the original backfill, this does NOT require email_confirmed_at,
--    since client accounts are created with email_confirm: true and may predate that.
UPDATE public.clients c
SET auth_user_id = u.id
FROM auth.users u
WHERE c.auth_user_id IS NULL
  AND c.email IS NOT NULL
  AND lower(u.email) = lower(c.email);

-- 2. Rewrite practitioner-manage so clients can NOT write/delete their own row
--    (the previous FOR ALL policy authorised DELETE for the client via USING).
DROP POLICY IF EXISTS "clients practitioner manage" ON public.clients;
CREATE POLICY "clients practitioner manage" ON public.clients
  FOR ALL TO authenticated
  USING (auth.uid() = practitioner_id OR private.is_super_admin(auth.uid()))
  WITH CHECK (auth.uid() = practitioner_id OR private.is_super_admin(auth.uid()));

-- 3. Replace the orphaned self-read policy (which called the revoked
--    public.current_client_id()) with one that uses the granted private function.
DROP POLICY IF EXISTS "clients self read" ON public.clients;
CREATE POLICY "clients self read" ON public.clients
  FOR SELECT TO authenticated
  USING (id = private.current_client_id());
