
-- 1. Add stable auth mapping to clients
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS auth_user_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS clients_auth_user_id_key ON public.clients(auth_user_id) WHERE auth_user_id IS NOT NULL;

-- Backfill from auth.users by matching confirmed email
UPDATE public.clients c
SET auth_user_id = u.id
FROM auth.users u
WHERE c.auth_user_id IS NULL
  AND c.email IS NOT NULL
  AND lower(u.email) = lower(c.email)
  AND u.email_confirmed_at IS NOT NULL;

-- 2. Rewrite current_client_id to use auth.uid() mapping (no email spoofing)
CREATE OR REPLACE FUNCTION public.current_client_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT id FROM public.clients WHERE auth_user_id = auth.uid() LIMIT 1
$$;

-- 3. Update handle_new_user to also link an existing client row by confirmed email
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

  IF NEW.email IS NOT NULL THEN
    UPDATE public.clients
       SET auth_user_id = NEW.id
     WHERE auth_user_id IS NULL
       AND email IS NOT NULL
       AND lower(email) = lower(NEW.email);
  END IF;

  RETURN NEW;
END;
$$;

-- Ensure handle_new_user trigger is attached
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Also link on email confirmation
CREATE OR REPLACE FUNCTION public.handle_user_email_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL
     AND (OLD.email_confirmed_at IS NULL OR OLD.email IS DISTINCT FROM NEW.email)
     AND NEW.email IS NOT NULL THEN
    UPDATE public.clients
       SET auth_user_id = NEW.id
     WHERE auth_user_id IS NULL
       AND email IS NOT NULL
       AND lower(email) = lower(NEW.email);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE OF email_confirmed_at, email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_email_confirmed();

-- 4. Tighten profiles SELECT: practitioner visible only to self, admin, or own clients
DROP POLICY IF EXISTS "profiles select own or admin or practitioner" ON public.profiles;
CREATE POLICY "profiles select own admin or linked practitioner"
ON public.profiles FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.practitioner_id = profiles.id
      AND c.auth_user_id = auth.uid()
  )
);

-- 5. Prevent role escalation: simplify policy + ensure trigger is attached
DROP POLICY IF EXISTS "profiles update own" ON public.profiles;
CREATE POLICY "profiles update own"
ON public.profiles FOR UPDATE TO authenticated
USING (id = auth.uid() OR public.is_super_admin(auth.uid()))
WITH CHECK (id = auth.uid() OR public.is_super_admin(auth.uid()));

DROP TRIGGER IF EXISTS prevent_role_escalation_trigger ON public.profiles;
CREATE TRIGGER prevent_role_escalation_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_role_escalation();

-- 6. Allow clients to read their own alerts
DROP POLICY IF EXISTS "alerts client select own" ON public.alerts;
CREATE POLICY "alerts client select own"
ON public.alerts FOR SELECT TO authenticated
USING (client_id = public.current_client_id());

-- 7. Restrict EXECUTE on SECURITY DEFINER helpers not meant for direct calls
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.current_client_id() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_user_email_confirmed() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_role_escalation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- Convert insert_alert / insert_check_in to SECURITY INVOKER so RLS applies as caller
CREATE OR REPLACE FUNCTION public.insert_alert(
  p_practitioner_id uuid, p_client_id uuid, p_alert_type text, p_message text, p_urgency text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  INSERT INTO public.alerts (practitioner_id, client_id, alert_type, message, urgency)
  VALUES (p_practitioner_id, p_client_id, p_alert_type, p_message, p_urgency)
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  INSERT INTO public.check_ins (
    client_id, practitioner_id, pain_level, sleep_quality, stress_level,
    energy_level, mood, notes, medication_taken, flagged
  ) VALUES (
    p_client_id, p_practitioner_id, p_pain_level, p_sleep_quality, p_stress_level,
    p_energy_level, p_mood, p_notes, p_medication_taken, p_flagged
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
