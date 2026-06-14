CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_super_admin(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _uid AND role = 'super_admin')
$$;

CREATE OR REPLACE FUNCTION private.current_client_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.clients WHERE auth_user_id = auth.uid() LIMIT 1
$$;

REVOKE ALL ON FUNCTION private.is_super_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.current_client_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_super_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.current_client_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $function$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF current_user = 'service_role'
       OR session_user = 'service_role'
       OR auth.role() = 'service_role'
       OR current_setting('request.jwt.claim.role', true) = 'service_role'
       OR (current_setting('request.jwt.claims', true) <> ''
           AND (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role')
    THEN
      RETURN NEW;
    END IF;

    IF auth.uid() IS NULL OR NOT private.is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Not authorized to change role';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP POLICY IF EXISTS "alerts client insert own" ON public.alerts;
DROP POLICY IF EXISTS "alerts client select own" ON public.alerts;
DROP POLICY IF EXISTS "alerts practitioner manage" ON public.alerts;
CREATE POLICY "alerts client insert own" ON public.alerts
FOR INSERT TO authenticated
WITH CHECK (client_id = private.current_client_id());
CREATE POLICY "alerts client select own" ON public.alerts
FOR SELECT TO authenticated
USING (client_id = private.current_client_id());
CREATE POLICY "alerts practitioner manage" ON public.alerts
FOR ALL TO authenticated
USING (auth.uid() = practitioner_id OR private.is_super_admin(auth.uid()))
WITH CHECK (auth.uid() = practitioner_id OR private.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "check_ins access" ON public.check_ins;
CREATE POLICY "check_ins access" ON public.check_ins
FOR ALL TO authenticated
USING (auth.uid() = practitioner_id OR private.is_super_admin(auth.uid()) OR client_id = private.current_client_id())
WITH CHECK (auth.uid() = practitioner_id OR client_id = private.current_client_id());

DROP POLICY IF EXISTS "clients practitioner manage" ON public.clients;
CREATE POLICY "clients practitioner manage" ON public.clients
FOR ALL TO authenticated
USING (auth.uid() = practitioner_id OR private.is_super_admin(auth.uid()) OR id = private.current_client_id())
WITH CHECK (auth.uid() = practitioner_id OR private.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "practices owner manage" ON public.practices;
CREATE POLICY "practices owner manage" ON public.practices
FOR ALL TO authenticated
USING (auth.uid() = practitioner_id OR private.is_super_admin(auth.uid()))
WITH CHECK (auth.uid() = practitioner_id OR private.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "profiles select own admin or linked practitioner" ON public.profiles;
DROP POLICY IF EXISTS "profiles update own" ON public.profiles;
CREATE POLICY "profiles select own admin or linked practitioner" ON public.profiles
FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR private.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.practitioner_id = profiles.id
      AND c.auth_user_id = auth.uid()
  )
);
CREATE POLICY "profiles update own" ON public.profiles
FOR UPDATE TO authenticated
USING (id = auth.uid() OR private.is_super_admin(auth.uid()))
WITH CHECK (id = auth.uid() OR private.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "symptom_queries access" ON public.symptom_queries;
CREATE POLICY "symptom_queries access" ON public.symptom_queries
FOR ALL TO authenticated
USING (auth.uid() = practitioner_id OR private.is_super_admin(auth.uid()) OR client_id = private.current_client_id())
WITH CHECK (auth.uid() = practitioner_id OR client_id = private.current_client_id());

REVOKE EXECUTE ON FUNCTION public.current_client_id() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon, authenticated;