-- 1. Add tracking columns to alerts
ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS email_fired boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Alert action tokens table (single-use links in practitioner emails)
CREATE TABLE IF NOT EXISTS public.alert_action_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES public.alerts(id) ON DELETE CASCADE,
  practitioner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('checkin', 'reviewed')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_action_tokens_alert_id_idx ON public.alert_action_tokens(alert_id);

-- 3. Grants — service_role only; the public action route uses admin client.
GRANT ALL ON public.alert_action_tokens TO service_role;

-- 4. RLS: locked down. No policies means no anon/authenticated access.
ALTER TABLE public.alert_action_tokens ENABLE ROW LEVEL SECURITY;