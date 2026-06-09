
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS suggested_program_id uuid REFERENCES public.programs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS program_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS program_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_login_at timestamptz;

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_program_status_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_program_status_check
  CHECK (program_status IN ('none','pending','accepted','declined'));
