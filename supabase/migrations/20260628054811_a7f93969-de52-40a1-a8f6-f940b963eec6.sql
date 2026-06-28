ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS rewards_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS rewards_allowed_days smallint[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6]::smallint[];