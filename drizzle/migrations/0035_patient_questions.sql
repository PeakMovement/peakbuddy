-- 0035_patient_questions
--
-- 1. patient_questions: a practitioner asks Buddy to put a question to a
--    client ("message Tayla and ask her when her events are"). Buddy asks on
--    WhatsApp, takes the client's next message as the answer, adds it to the
--    profile notes and sends it to the practitioner. status: draft (who is
--    not settled yet), pending (waiting for the client's 24 hour window),
--    asked, answered, cancelled.
-- 2. practitioner_intakes.pending_text: a message sent while Buddy was taking
--    notes that could be a note or an instruction, held until the
--    practitioner taps "Save as note" or "Do it".
--
-- Server only: RLS on, no policies. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.patient_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  practitioner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question text NOT NULL CHECK (char_length(question) <= 1000),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending', 'asked', 'answered', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  asked_at timestamptz,
  answer text CHECK (answer IS NULL OR char_length(answer) <= 4000),
  answered_at timestamptz
);

CREATE INDEX IF NOT EXISTS patient_questions_client_status_idx
  ON public.patient_questions (client_id, status);

ALTER TABLE public.patient_questions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_questions FROM anon, authenticated;
GRANT ALL ON public.patient_questions TO service_role;

ALTER TABLE public.practitioner_intakes ADD COLUMN IF NOT EXISTS pending_text text;
