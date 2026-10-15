-- 0038_capability_review
--
-- Exercise adherence on a check-in (null when they did not answer: a missed
-- tap is not "did not exercise"). One goal on the client. Programme-reminder
-- opt-in, off until the physio sets the days. Quiet-nudge bookkeeping so a
-- silent patient is not messaged twice, and not at all until the practitioner
-- confirms. Exercise photo/video metadata for the treating physio. No vision
-- model, no Heidi text, no patient_memory.
--
-- Server tables: RLS on, no policies. Safe to run twice.

ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS exercise_adherence text;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS goal text;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS programme_reminder_opt_in boolean NOT NULL DEFAULT false;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS programme_reminder_days smallint[] NOT NULL DEFAULT '{}';

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS programme_reminder_last_sent_on date;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS reply_hour smallint;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS reply_hour_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.quiet_patient_nudges (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  last_physio_notified_on date,
  last_patient_sent_on date,
  nudges_in_window integer NOT NULL DEFAULT 0,
  window_started_on date,
  pending_confirm boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quiet_patient_nudges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quiet_patient_nudges FROM anon, authenticated;
GRANT ALL ON public.quiet_patient_nudges TO service_role;

CREATE TABLE IF NOT EXISTS public.client_exercise_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  practitioner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_kind text NOT NULL,
  provider_media_id text,
  caption text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_exercise_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_exercise_media FROM anon, authenticated;
GRANT ALL ON public.client_exercise_media TO service_role;
