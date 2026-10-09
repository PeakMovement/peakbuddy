-- 0028_patient_memory
--
-- Everyday things a patient tells Buddy about their life ("training for the
-- Two Oceans half", "works night shifts", "daughter's wedding in March"), so
-- Buddy can remember them weeks later. Written only by the server; the
-- treating team can read them. No health conditions, medication, money or ID
-- numbers are stored here (filtered in code, see src/lib/whatsapp/converse.ts).
--
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS public.patient_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  fact text NOT NULL CHECK (char_length(fact) BETWEEN 3 AND 200),
  source text NOT NULL DEFAULT 'whatsapp',
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS patient_memory_client_idx
  ON public.patient_memory (client_id, created_at DESC);

ALTER TABLE public.patient_memory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_memory FROM anon;
GRANT SELECT ON public.patient_memory TO authenticated;
GRANT ALL ON public.patient_memory TO service_role;

DROP POLICY IF EXISTS "Treating staff read patient memory" ON public.patient_memory;
CREATE POLICY "Treating staff read patient memory"
  ON public.patient_memory FOR SELECT
  TO authenticated
  USING (public.caller_is_staff_for_client(client_id));
