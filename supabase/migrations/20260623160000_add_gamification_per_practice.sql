-- Per-practitioner control of check-in gamification (streaks + rewards).
-- Super admin can turn gamification on/off for a practitioner from the admin
-- practitioner detail screen; when off, their clients see no streak card and
-- earn no rewards. Defaults to true.
ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS gamification_enabled boolean NOT NULL DEFAULT true;
