-- RLS audit fixes (June 8, 2026)
--
-- 1. The previous FOR ALL policy let a client DELETE (and theoretically
--    UPDATE rows hit only via USING) their own clients row, because DELETE
--    is authorised by USING alone and USING included id = current_client_id().
--    Clients should be able to READ their record, never modify or delete it.

DROP POLICY IF EXISTS "clients practitioner manage" ON public.clients;

CREATE POLICY "clients practitioner manage"
  ON public.clients FOR ALL TO authenticated
  USING (
    auth.uid() = practitioner_id
    OR public.is_super_admin(auth.uid())
  )
  WITH CHECK (
    auth.uid() = practitioner_id
    OR public.is_super_admin(auth.uid())
  );

CREATE POLICY "clients self read"
  ON public.clients FOR SELECT TO authenticated
  USING (id = public.current_client_id());

-- 2. current_client_id() resolves client identity by email with LIMIT 1.
--    Without a uniqueness guarantee, the same email on two client rows makes
--    identity resolution arbitrary (cross-practice data bleed for that user).
--    Pre-launch data is small enough that no duplicates should exist; if this
--    index fails to create, deduplicate clients.email first.

CREATE UNIQUE INDEX IF NOT EXISTS clients_email_unique_idx
  ON public.clients (lower(email))
  WHERE email IS NOT NULL;
