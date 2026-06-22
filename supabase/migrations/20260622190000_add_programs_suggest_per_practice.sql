-- Per-practitioner control of the Suggested Programs feature.
-- Super admin can turn program suggestions on/off for a given practitioner from
-- the admin practitioner detail screen; when off, no client under that
-- practitioner receives a program suggestion. Defaults to true so existing
-- practices keep their current behaviour.
ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS programs_suggest_enabled boolean NOT NULL DEFAULT true;
