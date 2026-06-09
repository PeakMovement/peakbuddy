
CREATE OR REPLACE FUNCTION public.insert_check_in(
  p_client_id uuid,
  p_practitioner_id uuid,
  p_pain_level integer,
  p_sleep_quality integer,
  p_stress_level integer,
  p_energy_level integer,
  p_mood text,
  p_notes text,
  p_medication_taken boolean,
  p_flagged boolean
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
  v_ok boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = p_client_id
      AND c.practitioner_id = p_practitioner_id
      AND (c.user_id = v_uid OR c.practitioner_id = v_uid)
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'Not authorized';
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

CREATE OR REPLACE FUNCTION public.insert_alert(
  p_practitioner_id uuid,
  p_client_id uuid,
  p_alert_type text,
  p_message text,
  p_urgency text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
  v_ok boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = p_client_id
      AND c.practitioner_id = p_practitioner_id
      AND (c.user_id = v_uid OR c.practitioner_id = v_uid)
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  INSERT INTO public.alerts (
    practitioner_id, client_id, alert_type, message, urgency
  ) VALUES (
    p_practitioner_id, p_client_id, p_alert_type, p_message, p_urgency
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
