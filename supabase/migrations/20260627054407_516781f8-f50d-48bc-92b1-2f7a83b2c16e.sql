ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS ai_features_enabled boolean NOT NULL DEFAULT false;

-- Grandfather all existing practices so current users don't lose access
UPDATE public.practices SET ai_features_enabled = true;

-- New practices from here on default to OFF (super admin must enable)
ALTER TABLE public.practices ALTER COLUMN ai_features_enabled SET DEFAULT false;