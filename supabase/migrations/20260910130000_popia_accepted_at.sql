-- Audit trail for when a client accepts POPIA data-processing consent.
-- popia_accepted (boolean) already exists (default false); this records WHEN.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS popia_accepted_at timestamptz;
