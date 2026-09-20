-- Practice owners (admin) can read/update rows for every client in their
-- practice. Members keep assigned-caseload RLS (practitioner_id = auth.uid()).
-- Writes that create rows still require the caller to be the assigned
-- practitioner or super_admin (WITH CHECK unchanged except clients update).

CREATE OR REPLACE FUNCTION public.is_owner_of_practice(p_practice uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.practices
    WHERE id = p_practice AND practitioner_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_owner_of_client_practice(p_client uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clients c
    JOIN public.practices p ON p.id = c.practice_id
    WHERE c.id = p_client AND p.practitioner_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_owner_of_practice(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_owner_of_client_practice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_owner_of_practice(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_owner_of_client_practice(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "clients practitioner manage" ON public.clients;
CREATE POLICY "clients practitioner manage" ON public.clients
  FOR ALL TO authenticated
  USING (
    auth.uid() = practitioner_id
    OR private.is_super_admin(auth.uid())
    OR id = private.current_client_id()
    OR public.is_owner_of_practice(practice_id)
  )
  WITH CHECK (
    auth.uid() = practitioner_id
    OR private.is_super_admin(auth.uid())
    OR public.is_owner_of_practice(practice_id)
  );

DROP POLICY IF EXISTS "check_ins access" ON public.check_ins;
CREATE POLICY "check_ins access" ON public.check_ins
  FOR ALL TO authenticated
  USING (
    auth.uid() = practitioner_id
    OR private.is_super_admin(auth.uid())
    OR client_id = private.current_client_id()
    OR public.is_owner_of_client_practice(client_id)
  )
  WITH CHECK (
    auth.uid() = practitioner_id
    OR private.is_super_admin(auth.uid())
    OR client_id = private.current_client_id()
    OR public.is_owner_of_client_practice(client_id)
  );

DROP POLICY IF EXISTS "alerts practitioner manage" ON public.alerts;
CREATE POLICY "alerts practitioner manage" ON public.alerts
  FOR ALL TO authenticated
  USING (
    auth.uid() = practitioner_id
    OR private.is_super_admin(auth.uid())
    OR public.is_owner_of_client_practice(client_id)
  )
  WITH CHECK (
    auth.uid() = practitioner_id
    OR private.is_super_admin(auth.uid())
    OR public.is_owner_of_client_practice(client_id)
  );
