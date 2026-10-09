CREATE TABLE IF NOT EXISTS public.practitioner_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  practitioner_id uuid NOT NULL,
  phone text,
  status text NOT NULL CHECK (status IN ('sent', 'emailed', 'collecting', 'done', 'declined', 'failed', 'no_phone')),
  created_at timestamptz NOT NULL DEFAULT now(),
  opened_at timestamptz,
  last_message_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS practitioner_intakes_phone_idx
  ON public.practitioner_intakes (phone, status, created_at DESC);

ALTER TABLE public.practitioner_intakes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.practitioner_intakes FROM anon, authenticated;
GRANT ALL ON public.practitioner_intakes TO service_role;