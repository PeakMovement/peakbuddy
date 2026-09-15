-- Per-practice public sign-up link.
-- A practice shares https://<app>/join/<join_token>; a client opens it, creates
-- their own account, and is stamped straight into that practice (and picks a
-- practitioner when the practice has more than one).

ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS join_token   text,
  ADD COLUMN IF NOT EXISTS join_enabled boolean NOT NULL DEFAULT true;

-- Backfill an unguessable token for every existing practice.
UPDATE public.practices
   SET join_token = replace(gen_random_uuid()::text, '-', '')
 WHERE join_token IS NULL;

-- Tokens must be unique (the link resolves a single practice).
CREATE UNIQUE INDEX IF NOT EXISTS practices_join_token_key
  ON public.practices (join_token);

-- Reads/writes of the token go through service-role server functions, so no
-- new RLS policy is required here (practices RLS already enabled).
