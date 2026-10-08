CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name)
  VALUES (
    NEW.id,
    'client',
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_user_email_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_user_email_confirmed() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.caller_is_staff_for_client(p_client uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = p_client AND c.practitioner_id = auth.uid()
    )
    OR public.is_owner_of_client_practice(p_client)
    OR COALESCE(public.is_super_admin(auth.uid()), false)
  );
$$;

CREATE OR REPLACE FUNCTION public.caller_can_access_client(p_client uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = p_client AND c.auth_user_id = auth.uid()
    )
    OR public.caller_is_staff_for_client(p_client)
  );
$$;

CREATE OR REPLACE FUNCTION public.caller_may_write_for_client(p_client uuid, p_practitioner uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.caller_can_access_client(p_client)
     AND EXISTS (
       SELECT 1 FROM public.clients c
       WHERE c.id = p_client AND c.practitioner_id IS NOT DISTINCT FROM p_practitioner
     );
$$;

REVOKE ALL ON FUNCTION public.caller_is_staff_for_client(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.caller_can_access_client(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.caller_may_write_for_client(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_is_staff_for_client(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.caller_can_access_client(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.caller_may_write_for_client(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "check_ins access" ON public.check_ins;
DROP POLICY IF EXISTS "check_ins client select own" ON public.check_ins;
DROP POLICY IF EXISTS "check_ins client insert own" ON public.check_ins;
DROP POLICY IF EXISTS "check_ins select with access" ON public.check_ins;
DROP POLICY IF EXISTS "check_ins insert with access" ON public.check_ins;

CREATE POLICY "check_ins select with access" ON public.check_ins
  FOR SELECT TO authenticated
  USING (public.caller_can_access_client(client_id));

CREATE POLICY "check_ins insert with access" ON public.check_ins
  FOR INSERT TO authenticated
  WITH CHECK (public.caller_may_write_for_client(client_id, practitioner_id));

DROP POLICY IF EXISTS "alerts client insert own" ON public.alerts;
DROP POLICY IF EXISTS "alerts client select own" ON public.alerts;
DROP POLICY IF EXISTS "alerts practitioner manage" ON public.alerts;
DROP POLICY IF EXISTS "alerts select with access" ON public.alerts;
DROP POLICY IF EXISTS "alerts insert with access" ON public.alerts;
DROP POLICY IF EXISTS "alerts staff update" ON public.alerts;
DROP POLICY IF EXISTS "alerts staff delete" ON public.alerts;

CREATE POLICY "alerts select with access" ON public.alerts
  FOR SELECT TO authenticated
  USING (public.caller_can_access_client(client_id));

CREATE POLICY "alerts insert with access" ON public.alerts
  FOR INSERT TO authenticated
  WITH CHECK (public.caller_may_write_for_client(client_id, practitioner_id));

CREATE POLICY "alerts staff update" ON public.alerts
  FOR UPDATE TO authenticated
  USING (public.caller_is_staff_for_client(client_id))
  WITH CHECK (public.caller_is_staff_for_client(client_id));

CREATE POLICY "alerts staff delete" ON public.alerts
  FOR DELETE TO authenticated
  USING (public.caller_is_staff_for_client(client_id));

DROP POLICY IF EXISTS "training_sessions access" ON public.training_sessions;
DROP POLICY IF EXISTS "training_sessions select with access" ON public.training_sessions;
DROP POLICY IF EXISTS "training_sessions staff insert" ON public.training_sessions;
DROP POLICY IF EXISTS "training_sessions staff update" ON public.training_sessions;
DROP POLICY IF EXISTS "training_sessions staff delete" ON public.training_sessions;

CREATE POLICY "training_sessions select with access" ON public.training_sessions
  FOR SELECT TO authenticated
  USING (public.caller_can_access_client(client_id));

CREATE POLICY "training_sessions staff insert" ON public.training_sessions
  FOR INSERT TO authenticated
  WITH CHECK (public.caller_is_staff_for_client(client_id));

CREATE POLICY "training_sessions staff update" ON public.training_sessions
  FOR UPDATE TO authenticated
  USING (public.caller_is_staff_for_client(client_id))
  WITH CHECK (public.caller_is_staff_for_client(client_id));

CREATE POLICY "training_sessions staff delete" ON public.training_sessions
  FOR DELETE TO authenticated
  USING (public.caller_is_staff_for_client(client_id));

CREATE OR REPLACE FUNCTION public.insert_alert(
  p_practitioner_id uuid, p_client_id uuid, p_alert_type text, p_message text, p_urgency text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_practitioner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.caller_can_access_client(p_client_id) THEN
    RAISE EXCEPTION 'Not authorized for this client';
  END IF;
  SELECT practitioner_id INTO v_practitioner FROM public.clients WHERE id = p_client_id;
  INSERT INTO public.alerts (practitioner_id, client_id, alert_type, message, urgency)
  VALUES (COALESCE(v_practitioner, p_practitioner_id), p_client_id, p_alert_type, p_message, p_urgency)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_check_in(
  p_client_id uuid, p_practitioner_id uuid, p_pain_level integer, p_sleep_quality integer,
  p_stress_level integer, p_energy_level integer, p_mood text, p_notes text,
  p_medication_taken boolean, p_flagged boolean
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_practitioner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.caller_can_access_client(p_client_id) THEN
    RAISE EXCEPTION 'Not authorized for this client';
  END IF;
  SELECT practitioner_id INTO v_practitioner FROM public.clients WHERE id = p_client_id;
  INSERT INTO public.check_ins (
    client_id, practitioner_id, pain_level, sleep_quality, stress_level,
    energy_level, mood, notes, medication_taken, flagged
  ) VALUES (
    p_client_id, COALESCE(v_practitioner, p_practitioner_id), p_pain_level, p_sleep_quality,
    p_stress_level, p_energy_level, p_mood, p_notes, p_medication_taken, p_flagged
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_alert(uuid, uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.insert_check_in(uuid, uuid, integer, integer, integer, integer, text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.insert_alert(uuid, uuid, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.insert_check_in(uuid, uuid, integer, integer, integer, integer, text, text, boolean, boolean) TO authenticated, service_role;

UPDATE public.practices
   SET join_enabled = true
 WHERE join_token IS NOT NULL
   AND join_enabled IS DISTINCT FROM true;

CREATE OR REPLACE FUNCTION public.guard_practice_admin_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(public.is_super_admin(auth.uid()), false) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.ai_features_enabled := false;
    NEW.programs_suggest_enabled := true;
    NEW.max_members := 1;
    NEW.practice_type := 'individual';
    RETURN NEW;
  END IF;

  IF NEW.ai_features_enabled IS DISTINCT FROM OLD.ai_features_enabled
     OR NEW.programs_suggest_enabled IS DISTINCT FROM OLD.programs_suggest_enabled
     OR NEW.max_members IS DISTINCT FROM OLD.max_members
     OR NEW.practice_type IS DISTINCT FROM OLD.practice_type THEN
    RAISE EXCEPTION 'Not authorized to change practice plan or AI settings';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_practice_admin_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS practices_guard_admin_columns ON public.practices;
CREATE TRIGGER practices_guard_admin_columns
  BEFORE INSERT OR UPDATE ON public.practices
  FOR EACH ROW EXECUTE FUNCTION public.guard_practice_admin_columns();

CREATE OR REPLACE FUNCTION public.guard_yves_ai_consent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NEW.yves_ai_consent IS TRUE
     AND (TG_OP = 'INSERT' OR OLD.yves_ai_consent IS DISTINCT FROM true)
     AND (NEW.auth_user_id IS NULL OR auth.uid() IS NULL OR NEW.auth_user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'Only the patient can give AI consent';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_yves_ai_consent() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clients_guard_yves_ai_consent ON public.clients;
CREATE TRIGGER clients_guard_yves_ai_consent
  BEFORE INSERT OR UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.guard_yves_ai_consent();