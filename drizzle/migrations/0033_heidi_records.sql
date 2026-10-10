-- 0033_heidi_records
--
-- Short Heidi summaries a practitioner asked Buddy to read, plus the Heidi
-- patient profile id and the session ids Buddy was able to match. Heidi has
-- no call that lists one patient's sessions or documents, so the next read
-- uses these session ids when the linked-user list cannot be filtered.
--
-- The summary is clinical text. Service role only. It is not patient_memory
-- and it is never sent as a WhatsApp template variable.
--
-- Server only: RLS on, no policies. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.heidi_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  practitioner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  heidi_patient_profile_id text,
  session_ids text[] NOT NULL DEFAULT '{}',
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 4000),
  newest_note_at timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, practitioner_id)
);

CREATE INDEX IF NOT EXISTS heidi_records_client_idx
  ON public.heidi_records (client_id, fetched_at DESC);

ALTER TABLE public.heidi_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.heidi_records FROM anon, authenticated;
GRANT ALL ON public.heidi_records TO service_role;
