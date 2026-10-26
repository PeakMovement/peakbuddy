ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS archived_by uuid;
CREATE INDEX IF NOT EXISTS clients_archived_at_idx ON public.clients (archived_at) WHERE archived_at IS NOT NULL;