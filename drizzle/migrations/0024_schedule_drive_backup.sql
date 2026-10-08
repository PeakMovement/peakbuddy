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
    'whatsapp-drive-backup-weekly',
    '0 1 * * 1',
    format(
      $cmd$SELECT net.http_post(
  url := %L,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (SELECT token FROM private.cron_auth WHERE id = 1)
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 60000
);$cmd$,
      base || '/api/public/hooks/whatsapp-drive-backup'
    )
  );
END $$;