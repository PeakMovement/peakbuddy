
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
BEGIN
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
BEGIN
  INSERT INTO public.alerts (
    practitioner_id, client_id, alert_type, message, urgency
  ) VALUES (
    p_practitioner_id, p_client_id, p_alert_type, p_message, p_urgency
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_check_in(uuid,uuid,integer,integer,integer,integer,text,text,boolean,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_alert(uuid,uuid,text,text,text) TO authenticated;
