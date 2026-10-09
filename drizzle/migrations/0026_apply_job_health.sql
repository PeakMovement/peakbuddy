CREATE TABLE IF NOT EXISTS public.job_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job text NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL,
  status integer,
  duration_ms integer,
  detail text
);

CREATE INDEX IF NOT EXISTS job_runs_job_ran_at_idx ON public.job_runs (job, ran_at DESC);

ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_runs FROM anon, authenticated;
GRANT ALL ON public.job_runs TO service_role;

DO $$
DECLARE
  base text;
BEGIN
  SELECT substring(command from '(https?://[^''"[:space:]/]+)/api/public/hooks/')
    INTO base
    FROM cron.job
   WHERE command LIKE '%/api/public/hooks/checkin-reminders%'
   LIMIT 1;
  IF base IS NULL THEN
    RAISE EXCEPTION 'No existing checkin-reminders job to take the app address from';
  END IF;

  PERFORM cron.schedule(
    'job-health-check-daily',
    '45 5 * * *',
    format(
      $cmd$SELECT net.http_post(
  url := %L,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (SELECT token FROM private.cron_auth WHERE id = 1)
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 30000
);$cmd$,
      base || '/api/public/hooks/job-health-check'
    )
  );
END $$;