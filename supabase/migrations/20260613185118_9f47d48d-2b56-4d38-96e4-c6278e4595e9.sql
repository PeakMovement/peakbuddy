
-- 1. Programs: super-admin approval gate (separate from active flag)
ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS approved_by_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_by uuid NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz NULL;

-- Backfill existing programs as approved so production keeps working
UPDATE public.programs
   SET approved_by_admin = true,
       approved_at = COALESCE(approved_at, now())
 WHERE approved_by_admin = false;

-- 2. Clients: extend program_status to include 'awaiting_practitioner'
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_program_status_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_program_status_check
  CHECK (program_status = ANY (ARRAY['none','awaiting_practitioner','pending','accepted','declined']::text[]));

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS program_suggested_by text NULL,
  ADD COLUMN IF NOT EXISTS program_suggested_at timestamptz NULL;

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_program_suggested_by_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_program_suggested_by_check
  CHECK (program_suggested_by IS NULL OR program_suggested_by = ANY (ARRAY['auto_rules','auto_ai','practitioner']::text[]));

-- 3. Reset existing pending/accepted suggestions into the practitioner queue
UPDATE public.clients
   SET program_status = 'awaiting_practitioner',
       program_decided_at = NULL,
       program_suggested_by = COALESCE(program_suggested_by, 'auto_rules'),
       program_suggested_at = COALESCE(program_suggested_at, now())
 WHERE program_status IN ('pending','accepted')
   AND suggested_program_id IS NOT NULL;
