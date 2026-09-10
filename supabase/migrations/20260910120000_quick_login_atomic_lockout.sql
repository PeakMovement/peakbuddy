-- Atomic attempt-claim for 4-digit quick sign-in.
-- The previous lockout was a read-then-write in the app: firing all ~10,000
-- codes concurrently, every request read failed_attempts=0 before any write
-- landed, so the 5-attempt lockout never tripped and the code was brute-forced.
-- This SECURITY DEFINER function consumes one attempt under a row lock, so
-- concurrent attempts serialize and are hard-capped at MAX_FAILED_ATTEMPTS.
CREATE OR REPLACE FUNCTION public.claim_quick_login_attempt(p_user_id uuid)
RETURNS TABLE(allowed boolean, locked boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max          int := 5;
  v_lock_window  interval := interval '15 minutes';
  v_attempts     int;
  v_locked_at    timestamptz;
BEGIN
  SELECT failed_attempts, locked_at
    INTO v_attempts, v_locked_at
  FROM public.quick_login_codes
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- No quick code configured for this user.
    RETURN QUERY SELECT false, false;
    RETURN;
  END IF;

  -- Auto-expire a stale lock.
  IF v_locked_at IS NOT NULL AND v_locked_at < (now() - v_lock_window) THEN
    v_attempts := 0;
    v_locked_at := NULL;
  END IF;

  IF v_locked_at IS NOT NULL THEN
    RETURN QUERY SELECT false, true;   -- currently locked
    RETURN;
  END IF;

  -- Consume one attempt atomically (row is locked by FOR UPDATE above).
  v_attempts := v_attempts + 1;
  UPDATE public.quick_login_codes
     SET failed_attempts = v_attempts,
         last_failed_at   = now(),
         locked_at        = CASE WHEN v_attempts >= v_max THEN now() ELSE NULL END
   WHERE user_id = p_user_id;

  RETURN QUERY SELECT true, (v_attempts >= v_max);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_quick_login_attempt(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_quick_login_attempt(uuid) TO service_role;
