-- 0043_client_admin_audit
--
-- Who archived or erased a client, and from where. The row stores the
-- client id and the action. It does not store message text.
-- Erase keeps the id after the client row is gone, so there is no foreign key.
--
-- Next number after 0042_client_archive. Safe to run twice.
-- Do not copy this file into supabase/migrations.

CREATE TABLE IF NOT EXISTS public.client_admin_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id uuid,
  action text NOT NULL CHECK (action IN ('archive', 'unarchive', 'erase')),
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'admin')),
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_admin_audit_client_idx
  ON public.client_admin_audit (client_id, created_at DESC);

ALTER TABLE public.client_admin_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_admin_audit FROM anon, authenticated;
GRANT ALL ON public.client_admin_audit TO service_role;
