-- 0031_practitioner_updates
--
-- Practitioners can ask Buddy on WhatsApp for regular client updates
-- ("update me daily at 7am", "every Monday", "stop updates") and ask Buddy
-- to check in with a client, getting the answers back when the client replies.
--
-- practitioner_update_prefs: one row per practitioner. frequency daily,
--   weekdays, weekly or off; weekday 1 = Monday ... 7 = Sunday (weekly only);
--   send_time HH:MM South African time; last_sent_at stops double sends.
-- practitioner_checkin_requests: one row per "check in with Sam". The minute
--   job sends the practitioner the answers once the client checks in, and
--   closes requests left unanswered for 2 days.
--
-- Server only: RLS on, no policies. No patient data beyond ids.
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS public.practitioner_update_prefs (
  practitioner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekdays', 'weekly', 'off')),
  weekday smallint NOT NULL DEFAULT 1 CHECK (weekday BETWEEN 1 AND 7),
  send_time text NOT NULL DEFAULT '07:30' CHECK (send_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  last_sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.practitioner_update_prefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.practitioner_update_prefs FROM anon, authenticated;
GRANT ALL ON public.practitioner_update_prefs TO service_role;

CREATE TABLE IF NOT EXISTS public.practitioner_checkin_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  practitioner_id uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  notified_at timestamptz
);

CREATE INDEX IF NOT EXISTS practitioner_checkin_requests_open_idx
  ON public.practitioner_checkin_requests (notified_at, requested_at);

ALTER TABLE public.practitioner_checkin_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.practitioner_checkin_requests FROM anon, authenticated;
GRANT ALL ON public.practitioner_checkin_requests TO service_role;
