ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS yves_ai_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS yves_ai_consent_at timestamptz NULL;