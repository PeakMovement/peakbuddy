-- Idempotency guard for the weekly practitioner digest: record the date a
-- practitioner was last emailed so a retry / double-schedule can't re-send.
ALTER TABLE public.practices ADD COLUMN IF NOT EXISTS last_digest_sent_on date;
