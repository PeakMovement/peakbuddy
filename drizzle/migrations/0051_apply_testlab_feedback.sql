-- 0046_testlab_feedback
--
-- Justin's verdicts from the Test Lab: "looks right" or "wrong" on a
-- scenario or a manual conversation, with a note and the sandbox transcript.
-- The transcript only ever holds the made-up Test Lab practice, never a real
-- patient. Super admin reads and writes through server functions.
-- RLS on, no policies. Service role only. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.testlab_feedback (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  scenario_id text,
  verdict text NOT NULL CHECK (verdict IN ('right', 'wrong', 'note')),
  note text,
  transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS testlab_feedback_created_idx
  ON public.testlab_feedback (created_at DESC);

ALTER TABLE public.testlab_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.testlab_feedback FROM anon, authenticated;
GRANT ALL ON public.testlab_feedback TO service_role;
