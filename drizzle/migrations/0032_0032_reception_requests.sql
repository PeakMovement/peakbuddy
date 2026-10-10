CREATE TABLE IF NOT EXISTS public.reception_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_text text NOT NULL CHECK (char_length(request_text) <= 1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_reply text CHECK (last_reply IS NULL OR char_length(last_reply) <= 2000),
  replied_at timestamptz,
  done_at timestamptz
);

CREATE INDEX IF NOT EXISTS reception_requests_open_idx
  ON public.reception_requests (status, sent_at);

ALTER TABLE public.reception_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reception_requests FROM anon, authenticated;
GRANT ALL ON public.reception_requests TO service_role;