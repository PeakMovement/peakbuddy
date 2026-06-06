
-- Helper: super admin check via security definer (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.is_super_admin(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _uid AND role = 'super_admin')
$$;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;

-- Helper: returns clients.id for the currently authenticated client (matched by email)
CREATE OR REPLACE FUNCTION public.current_client_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.clients
  WHERE lower(email) = lower(NULLIF(auth.jwt() ->> 'email', ''))
  LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.current_client_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_client_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_client_id() TO authenticated, service_role;

-- ============ profiles ============
DROP POLICY IF EXISTS "profiles read all" ON public.profiles;
DROP POLICY IF EXISTS "profiles self write" ON public.profiles;

CREATE POLICY "profiles select own or admin or practitioner"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.is_super_admin(auth.uid())
    OR role = 'practitioner'
  );

CREATE POLICY "profiles insert own"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles update own"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_super_admin(auth.uid()))
  WITH CHECK (id = auth.uid() OR public.is_super_admin(auth.uid()));

-- Prevent role escalation: block role change unless caller is a super admin.
CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Not authorized to change role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_prevent_role_escalation ON public.profiles;
CREATE TRIGGER profiles_prevent_role_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_role_escalation();

-- ============ practices ============
DROP POLICY IF EXISTS "practices owner write" ON public.practices;
DROP POLICY IF EXISTS "practices read all" ON public.practices;

CREATE POLICY "practices owner manage"
  ON public.practices FOR ALL TO authenticated
  USING (auth.uid() = practitioner_id OR public.is_super_admin(auth.uid()))
  WITH CHECK (auth.uid() = practitioner_id OR public.is_super_admin(auth.uid()));

-- ============ clients ============
DROP POLICY IF EXISTS "clients all access" ON public.clients;

CREATE POLICY "clients practitioner manage"
  ON public.clients FOR ALL TO authenticated
  USING (
    auth.uid() = practitioner_id
    OR public.is_super_admin(auth.uid())
    OR id = public.current_client_id()
  )
  WITH CHECK (
    auth.uid() = practitioner_id
    OR public.is_super_admin(auth.uid())
  );

-- ============ check_ins ============
DROP POLICY IF EXISTS "check_ins all access" ON public.check_ins;

CREATE POLICY "check_ins access"
  ON public.check_ins FOR ALL TO authenticated
  USING (
    auth.uid() = practitioner_id
    OR public.is_super_admin(auth.uid())
    OR client_id = public.current_client_id()
  )
  WITH CHECK (
    auth.uid() = practitioner_id
    OR client_id = public.current_client_id()
  );

-- ============ alerts ============
DROP POLICY IF EXISTS "alerts all access" ON public.alerts;

CREATE POLICY "alerts practitioner manage"
  ON public.alerts FOR ALL TO authenticated
  USING (auth.uid() = practitioner_id OR public.is_super_admin(auth.uid()))
  WITH CHECK (auth.uid() = practitioner_id OR public.is_super_admin(auth.uid()));

-- Allow the owning client to create alerts about themselves (used by Yves triage)
CREATE POLICY "alerts client insert own"
  ON public.alerts FOR INSERT TO authenticated
  WITH CHECK (client_id = public.current_client_id());

-- ============ symptom_queries ============
DROP POLICY IF EXISTS "symptom_queries all access" ON public.symptom_queries;

CREATE POLICY "symptom_queries access"
  ON public.symptom_queries FOR ALL TO authenticated
  USING (
    auth.uid() = practitioner_id
    OR public.is_super_admin(auth.uid())
    OR client_id = public.current_client_id()
  )
  WITH CHECK (
    auth.uid() = practitioner_id
    OR client_id = public.current_client_id()
  );

-- Remove anonymous access entirely from sensitive tables
REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.practices FROM anon;
REVOKE ALL ON public.clients FROM anon;
REVOKE ALL ON public.check_ins FROM anon;
REVOKE ALL ON public.alerts FROM anon;
REVOKE ALL ON public.symptom_queries FROM anon;
REVOKE ALL ON public.platform_settings FROM anon;

-- Lock down handle_new_user execute (it is a trigger function; no external callers should invoke it)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
