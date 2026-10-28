-- 0047_buddy_job_claims
--
-- One row per job, per subject, per South African day, claimed before a
-- once-a-day send so two overlapping minute runs can never send it twice.
-- Used by the daily Buddy report, red flag escalation, the Monday summary,
-- the weekly patient progress note and outcome score prompts.
-- key is "global", a practitioner id or a client id. No message text.
-- RLS on, no policies. Service role only. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.buddy_job_claims (
  job text NOT NULL,
  key text NOT NULL,
  run_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job, key, run_on)
);

CREATE INDEX IF NOT EXISTS buddy_job_claims_created_idx
  ON public.buddy_job_claims (created_at);

ALTER TABLE public.buddy_job_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.buddy_job_claims FROM anon, authenticated;
GRANT ALL ON public.buddy_job_claims TO service_role;
