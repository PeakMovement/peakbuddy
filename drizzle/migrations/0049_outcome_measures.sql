-- 0049_outcome_measures
--
-- Standard outcome scores Buddy collects on WhatsApp (28 Oct 2026, Justin:
-- intake, every 2 weeks, discharge).
--   nprs: average pain over the last week, 0 to 10.
--   psfs: Patient-Specific Functional Scale. Up to 3 activities the patient
--         names once, each rated 0 (can't) to 10 (as before the injury);
--         score is their mean. items keeps [{activity, score}].
-- timepoint: intake (first), followup, or discharge.
-- RLS: the treating practitioner, practice owners and super admins read
-- through server functions using the service role. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.outcome_measures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  practitioner_id uuid,
  measure text NOT NULL CHECK (measure IN ('nprs', 'psfs')),
  timepoint text NOT NULL CHECK (timepoint IN ('intake', 'followup', 'discharge')),
  score numeric(4, 1) NOT NULL CHECK (score >= 0 AND score <= 10),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL DEFAULT 'whatsapp',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outcome_measures_client_idx
  ON public.outcome_measures (client_id, created_at DESC);

ALTER TABLE public.outcome_measures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.outcome_measures FROM anon, authenticated;
GRANT ALL ON public.outcome_measures TO service_role;
