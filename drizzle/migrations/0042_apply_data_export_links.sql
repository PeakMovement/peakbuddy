CREATE TABLE IF NOT EXISTS public.data_export_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  practitioner_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  downloaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.data_export_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_export_links FROM anon, authenticated;
GRANT ALL ON public.data_export_links TO service_role;