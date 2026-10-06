-- 0018_cron_auth_vault
--
-- Fixes every scheduled job getting 401 from /api/public/hooks/*.
--
-- The jobs never sent the CRON_SECRET the app checks, and nobody could copy
-- the value across safely. Now the secret lives only in Supabase Vault:
--   1. A random 'cron_secret' is created in Vault (only if there isn't one).
--   2. public.verify_cron_secret(token) answers true/false inside the
--      database. The app calls it (service role only); the secret itself is
--      never returned to the app or shown to anyone.
--   3. Every pg_cron job that calls /api/public/hooks/* is rewritten to read
--      the Vault value at run time and send it as "Authorization: Bearer".
--      Each job keeps its schedule and URL.
--
-- Safe to run twice. No table data changes.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret') THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'cron_secret',
      'Sent by scheduled jobs to /api/public/hooks/*. Checked by public.verify_cron_secret.'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.verify_cron_secret(p_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_token IS NOT NULL
     AND length(p_token) >= 32
     AND EXISTS (
       SELECT 1 FROM vault.decrypted_secrets
       WHERE name = 'cron_secret' AND decrypted_secret = p_token
     );
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
    'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 30000
);$cmd$,
        u
      )
    );
  END LOOP;
END $$;
