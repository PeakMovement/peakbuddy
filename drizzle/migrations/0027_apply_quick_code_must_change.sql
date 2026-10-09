ALTER TABLE public.quick_login_codes
  ADD COLUMN IF NOT EXISTS must_change boolean NOT NULL DEFAULT false;