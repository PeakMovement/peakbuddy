CREATE TABLE IF NOT EXISTS public.wearable_oauth_state (
  state text PRIMARY KEY,
  client_id uuid NOT NULL,
  provider text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.wearable_oauth_state TO service_role;
ALTER TABLE public.wearable_oauth_state ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS wearable_oauth_state_client_provider_idx ON public.wearable_oauth_state (client_id, provider);