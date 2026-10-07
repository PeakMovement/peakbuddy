-- 0020_schedule_all_hooks
--
-- Five hooks were built but never scheduled in the database (only check-in
-- reminders and nightly risk analysis were). This schedules them with the
-- same locked job key as 0018, at the same app address the existing jobs use.
--
--   whatsapp-worker              every minute   backstop: answers any WhatsApp
--                                               message the webhook missed
--   wearables-sync               00:00 UTC      daily Oura/Polar pull (replaces
--                                               the GitHub Actions job)
--   nightly-pattern-detection    01:30 UTC      no patient-facing effect, only
--                                               updates the pattern store
--   onboarding-library-nudge     07:00 UTC      one push to app users 3 to 10
--                                               days after sign-up, once each
--   weekly-practitioner-digest   Mon 05:00 UTC  only to practices that opted in
--
-- Needs 0018 (private.cron_auth). cron.schedule with a name replaces a job
-- of the same name, so this is safe to run twice.

DO $$
DECLARE
  base text;
  hook record;
BEGIN
  SELECT substring(command from '(https?://[^''"[:space:]/]+)/api/public/hooks/')
    INTO base
    FROM cron.job
   WHERE command LIKE '%/api/public/hooks/checkin-reminders%'
   LIMIT 1;
  IF base IS NULL THEN
    RAISE EXCEPTION 'No existing checkin-reminders job to take the app address from';
  END IF;

  FOR hook IN
    SELECT * FROM (VALUES
      ('whatsapp-worker-tick',        '* * * * *',  'whatsapp-worker'),
      ('wearables-sync-daily',        '0 0 * * *',  'wearables-sync'),
      ('nightly-pattern-detection',   '30 1 * * *', 'nightly-pattern-detection'),
      ('onboarding-library-nudge',    '0 7 * * *',  'onboarding-library-nudge'),
      ('weekly-practitioner-digest',  '0 5 * * 1',  'weekly-practitioner-digest')
    ) AS t(job_name, schedule, path)
  LOOP
    PERFORM cron.schedule(
      hook.job_name,
      hook.schedule,
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
        base || '/api/public/hooks/' || hook.path
      )
    );
  END LOOP;
END $$;