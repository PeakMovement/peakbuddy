-- 0037_morning_checkin
--
-- Weekday morning WhatsApp note (around 08:00 SAST) asking a practitioner
-- whether they want a patient update or reception to check in with someone.
-- One row per practitioner, created the first time we send or they opt out.
-- No row means the note is on. last_sent_on is the South African date of the
-- last attempt, so the minute job cannot send twice the same day.
--
-- Server only: RLS on, no policies. No patient data. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.practitioner_morning_checkins (
  practitioner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  last_sent_on date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.practitioner_morning_checkins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.practitioner_morning_checkins FROM anon, authenticated;
GRANT ALL ON public.practitioner_morning_checkins TO service_role;
