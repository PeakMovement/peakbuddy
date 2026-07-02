
ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS condition_context text,
  ADD COLUMN IF NOT EXISTS condition_note text;

ALTER TABLE public.check_ins
  DROP CONSTRAINT IF EXISTS check_ins_condition_context_chk;
ALTER TABLE public.check_ins
  ADD CONSTRAINT check_ins_condition_context_chk
  CHECK (condition_context IS NULL OR condition_context IN ('same','different'));

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
  p_flagged boolean,
  p_condition_context text DEFAULT NULL,
  p_condition_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.check_ins (
    client_id, practitioner_id, pain_level, sleep_quality, stress_level,
    energy_level, mood, notes, medication_taken, flagged,
    condition_context, condition_note
  )
  VALUES (
    p_client_id, p_practitioner_id, p_pain_level, p_sleep_quality, p_stress_level,
    p_energy_level, p_mood, p_notes, p_medication_taken, p_flagged,
    p_condition_context, p_condition_note
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_check_in(
  uuid, uuid, integer, integer, integer, integer, text, text, boolean, boolean, text, text
) TO authenticated;
