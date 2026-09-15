-- Reconcile claim_quick_login_attempt() across migration histories.
--
-- 20260910120000_quick_login_atomic_lockout.sql created a 2-column version
-- (allowed, locked) of this function. That migration never actually reached
-- Buddy's live database (Lovable Cloud's deploy pipeline turned out not to
-- apply this repo's supabase/migrations/ automatically -- see the session
-- notes dated 2026-09-15). The function was simply missing live, which broke
-- 4-digit quick sign-in for every user (the RPC call failed closed, so no
-- code was ever accepted). Lovable's own assistant patched it directly via a
-- new drizzle/migrations/ pipeline, using a 1-column (allowed only) version,
-- which is what is actually live today and what src/lib/quick-login.functions.ts
-- is written against (it only reads `claim.allowed`, never `locked`).
--
-- This migration makes the supabase/migrations/ history match reality: it
-- drops whatever version may exist (so this is safe to run against either a
-- fresh DB that only ever saw the old 2-column file, or the current live DB
-- that already has the 1-column version) and recreates the exact 1-column
-- definition, so a from-scratch rebuild of this database converges on the
-- same function Lovable's pipeline produced, instead of erroring out on a
-- return-type change or leaving two contradictory histories.
DROP FUNCTION IF EXISTS public.claim_quick_login_attempt(uuid);

CREATE FUNCTION public.claim_quick_login_attempt(p_user_id uuid)
RETURNS TABLE(allowed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.quick_login_codes%rowtype;
BEGIN
  SELECT * INTO v_row FROM public.quick_login_codes WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  -- Auto-clear a lockout after 15 minutes.
  IF v_row.locked_at IS NOT NULL AND v_row.locked_at < now() - interval '15 minutes' THEN
    UPDATE public.quick_login_codes
      SET locked_at = NULL, failed_attempts = 0, last_failed_at = NULL
      WHERE user_id = p_user_id;
    v_row.locked_at := NULL;
    v_row.failed_attempts := 0;
  END IF;

  IF v_row.locked_at IS NOT NULL THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  UPDATE public.quick_login_codes
    SET failed_attempts = v_row.failed_attempts + 1,
        last_failed_at = now(),
        locked_at = CASE WHEN v_row.failed_attempts + 1 >= 5 THEN now() ELSE NULL END
    WHERE user_id = p_user_id;

  RETURN QUERY SELECT true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_quick_login_attempt(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_quick_login_attempt(uuid) TO service_role;
