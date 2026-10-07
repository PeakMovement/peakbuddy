-- 0018_cron_auth_vault
--
-- Fixes every scheduled job getting 401 from /api/public/hooks/*.
--
-- The jobs never sent the CRON_SECRET the app checks. Instead of Vault (which
-- Lovable's agent is not allowed to touch), the job key lives in a locked
-- table in a "private" schema that the website API cannot see:
--   1. private.cron_auth holds one random key, created here if missing.
--      No grants to anon or authenticated, RLS on, not exposed by the API.
--   2. public.verify_cron_secret(token) answers true/false inside the
--      database. Service role only. The key itself is never returned.
--   3. Every pg_cron job that calls /api/public/hooks/* is rewritten to read
--      the key when it runs and send it as "Authorization: Bearer".
--      Each job keeps its schedule and URL.
--
-- Safe to run twice. No patient data touched.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS private.cron_auth (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.cron_auth ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.cron_auth FROM PUBLIC;
REVOKE ALL ON private.cron_auth FROM anon, authenticated;

INSERT INTO private.cron_auth (id, token)
VALUES (1, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.verify_cron_secret(p_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_token IS NOT NULL
     AND length(p_token) >= 32
     AND EXISTS (SELECT 1 FROM private.cron_auth WHERE token = p_token);
$$;

REVOKE ALL ON FUNCTION public.verify_cron_secret(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_cron_secret(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_cron_secret(text) TO service_role;

DO $$
DECLARE
  j record;
  u text;
BEGIN
  FOR j IN SELECT jobid, command FROM cron.job WHERE command LIKE '%/api/public/hooks/%' LOOP
    u := substring(j.command from '(https?://[^''"[:space:]]+/api/public/hooks/[A-Za-z0-9_-]+)');
    IF u IS NULL THEN
      RAISE NOTICE 'cron job % calls a hook but its URL could not be read; left unchanged', j.jobid;
      CONTINUE;
    END IF;
    PERFORM cron.alter_job(
      job_id := j.jobid,
      command := format(
        $cmd$SELECT net.http_post(
  url := %L,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (SELECT token FROM private.cron_auth WHERE id = 1)
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 30000
);$cmd$,
        u
      )
    );
    RAISE NOTICE 'cron job % now authenticates to %', j.jobid, u;
  END LOOP;
END $$;