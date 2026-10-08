-- 0023_security_hardening
--
-- NOT APPLIED. Listed for Justin's approval first.
--
-- Database half of the October 2026 security hardening. The app code changes
-- on the security-hardening branch go with it. Every statement below is safe
-- to run more than once.
--
-- Apply this BEFORE (or together with) deploying the branch: the code now
-- refuses practice sign-up links that are switched off, and section 7 is what
-- switches the existing links on.


-- ---------------------------------------------------------------------------
-- 1. Stop linking patient records to logins by matching email address.
--
-- Plain English: when a login was created, or its email was confirmed or
-- changed, the database quietly attached every unlinked patient record with
-- the same email to that login. Combined with an email change, anyone could
-- take over a patient's record (check-ins, alerts, notes) just by putting the
-- patient's email on their own account. Every place in the app that creates a
-- patient login now sets clients.auth_user_id itself (practitioner adds a
-- client, practice sign-up link, WhatsApp app-account setup), so the database
-- no longer needs to guess. New logins still get their profiles row exactly
-- as before; only the email matching is removed.
-- ---------------------------------------------------------------------------

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
  -- Patient records are linked explicitly by the app, never by email here.
  RETURN NEW;
END;
$$;

-- Kept as a do-nothing function so the existing trigger on auth.users stays
-- valid without this migration needing rights over the auth schema.
CREATE OR REPLACE FUNCTION public.handle_user_email_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Intentionally no longer links patient records by email.
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_user_email_confirmed() FROM PUBLIC, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. Shared access checks used by the policies below.
--
-- Plain English: one definition of "who may see or write this patient's data",
-- matching the app's own canAccessClient check:
--   * staff for a patient = their assigned practitioner, the owner (admin) of
--     the patient's practice, or a super admin;
--   * access to a patient = the patient themselves, or staff for them;
--   * a write for a patient must also name that patient's current
--     practitioner, so nobody can aim a check-in or alert at someone else.
-- ---------------------------------------------------------------------------

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


-- ---------------------------------------------------------------------------
-- 3. check_ins: append-only, and only for a patient the caller may access.
--
-- Plain English: the old rule let any signed-in user write a check-in for ANY
-- patient as long as they put their own id in the practitioner column. Now a
-- check-in can only be written by the patient, or by staff for that patient,
-- and it must name the patient's real practitioner. Reading follows the same
-- access rule (this also restores read access for the patient's practitioner,
-- practice owner and super admin, which the 0006 rewrite had dropped).
-- No UPDATE or DELETE rule exists, so check-ins stay append-only as in 0006.
--
-- Note: 0006's own header still says NOT APPLIED, but the 4 Oct 2026 migration
-- record says it was applied. Its content is folded in here either way.
-- ---------------------------------------------------------------------------

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


-- ---------------------------------------------------------------------------
-- 4. alerts: same rule as check-ins.
--
-- Plain English: previously a practitioner could create or edit alerts for
-- any patient by naming themselves as the practitioner, and a patient could
-- raise an alert naming any practitioner. Now: the patient and staff for the
-- patient can read and raise alerts (aimed only at the patient's real
-- practitioner); only staff for the patient can update or delete them
-- (e.g. mark read or reviewed).
-- ---------------------------------------------------------------------------

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


-- ---------------------------------------------------------------------------
-- 5. training_sessions: only staff for the patient may write.
--
-- Plain English: the old write rule accepted anyone who put their own id in
-- the practitioner column, for any patient. Now writes need staff access to
-- that patient (their practitioner, practice owner, or super admin). Patients
-- can still read their own schedule. The app writes these through server
-- functions that already check access, so nothing legitimate changes.
-- ---------------------------------------------------------------------------

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


-- ---------------------------------------------------------------------------
-- 6. insert_check_in / insert_alert RPCs refuse patients the caller can't access.
--
-- Plain English: these are what the patient app calls to save a check-in and
-- raise an alert. They now look the patient up first (under the caller's own
-- permissions) and stop with "Not authorized for this client" if the caller
-- can't see them. The practitioner is taken from the patient's record rather
-- than trusted from the app, which also fixes stale offline check-ins after a
-- patient is transferred. Same names, same inputs, same result for legitimate
-- callers. They stay SECURITY INVOKER so the policies above still apply.
-- ---------------------------------------------------------------------------

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


-- ---------------------------------------------------------------------------
-- 7. Practice sign-up links: switch on the links that already exist.
--
-- Plain English: the app now honours practices.join_enabled, so a link that is
-- switched off stops working. The column was added with a default of false and
-- there is no switch in the app yet, so every existing link is "off" only by
-- default, not by choice. This turns on every practice that already has a
-- link so nothing stops working. Safe to re-run while there is no off switch
-- in the app; once one exists, drop this statement from any re-run.
-- ---------------------------------------------------------------------------

UPDATE public.practices
   SET join_enabled = true
 WHERE join_token IS NOT NULL
   AND join_enabled IS DISTINCT FROM true;


-- ---------------------------------------------------------------------------
-- 8. Practitioners can't change their own plan or AI switches.
--
-- Plain English: practices.ai_features_enabled, programs_suggest_enabled,
-- max_members and practice_type are set by a super admin (or by the server).
-- A practitioner editing their own practice row from the browser could turn
-- on AI features, enlarge their seat count or make themselves a group
-- practice. Same pattern as the existing is_approved guard: a signed-in
-- non-super-admin changing any of these is refused, and a practice they create
-- themselves starts on the standard defaults. The server (service role), a
-- super admin, and direct database maintenance are unaffected.
-- ---------------------------------------------------------------------------

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


-- ---------------------------------------------------------------------------
-- 9. Only the patient can give AI consent.
--
-- Plain English: clients.yves_ai_consent records the patient's own POPIA
-- consent to their symptom messages going to the AI provider. A practitioner
-- could previously tick it on the patient's behalf straight from the browser.
-- Now, for a signed-in user, turning it on is refused unless that user IS the
-- patient. Anyone with access may still turn it off (withdraw consent). The
-- server (service role), which records the patient's own choice, is
-- unaffected.
-- ---------------------------------------------------------------------------

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
