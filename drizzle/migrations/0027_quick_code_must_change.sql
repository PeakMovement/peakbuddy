-- 0027_quick_code_must_change
--
-- Practitioner PIN sign-in. A practitioner who has never set a 4-digit code
-- can sign in once with the starting code 1234; the app then creates their
-- code row with must_change = true and makes them choose their own code
-- before anything else. After that, 1234 no longer works for them.
--
-- Safe to run twice.

ALTER TABLE public.quick_login_codes
  ADD COLUMN IF NOT EXISTS must_change boolean NOT NULL DEFAULT false;
