-- #7 Practitioner weekly digest email — opt-in flag on practices.
-- Default false so no existing practitioner receives digests until they opt in.
ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS weekly_digest_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.practices.weekly_digest_enabled IS
  'When true, the weekly-practitioner-digest cron emails this practitioner a summary of the past 7 days. Opt-in, default off.';
