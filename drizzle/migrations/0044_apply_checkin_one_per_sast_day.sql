CREATE OR REPLACE FUNCTION public.insert_check_in(
  p_client_id uuid, p_practitioner_id uuid, p_pain_level integer, p_sleep_quality integer,
  p_stress_level integer, p_energy_level integer, p_mood text, p_notes text,
  p_medication_taken boolean, p_flagged boolean,
  p_condition_context text DEFAULT NULL, p_condition_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_day date;
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('service_role', 'supabase_admin') THEN
    IF NOT (
      public.caller_is_staff_for_client(p_client_id)
      OR public.current_client_id() IS NOT DISTINCT FROM p_client_id
    ) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  v_day := (now() AT TIME ZONE 'Africa/Johannesburg')::date;

  SELECT id INTO v_id
  FROM public.check_ins
  WHERE client_id = p_client_id
    AND (created_at AT TIME ZONE 'Africa/Johannesburg')::date = v_day
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.check_ins (
      client_id, practitioner_id, pain_level, sleep_quality, stress_level,
      energy_level, mood, notes, medication_taken, flagged,
      condition_context, condition_note
    )
    VALUES (
      p_client_id, p_practitioner_id, p_pain_level, p_sleep_quality, p_stress_level,
      p_energy_level, p_mood, p_notes, p_medication_taken, COALESCE(p_flagged, false),
      p_condition_context, p_condition_note
    )
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  UPDATE public.check_ins SET
    pain_level = COALESCE(p_pain_level, pain_level),
    sleep_quality = COALESCE(sleep_quality, p_sleep_quality),
    stress_level = COALESCE(stress_level, p_stress_level),
    energy_level = COALESCE(energy_level, p_energy_level),
    mood = COALESCE(NULLIF(btrim(mood), ''), p_mood),
    notes = CASE
      WHEN p_notes IS NULL OR btrim(p_notes) = '' THEN notes
      WHEN notes IS NULL OR btrim(notes) = '' THEN p_notes
      WHEN position(btrim(p_notes) in notes) > 0 THEN notes
      ELSE notes || E'\n' || btrim(p_notes)
    END,
    medication_taken = COALESCE(medication_taken, p_medication_taken),
    flagged = flagged OR COALESCE(p_flagged, false),
    condition_context = COALESCE(condition_context, p_condition_context),
    condition_note = CASE
      WHEN p_condition_note IS NULL OR btrim(p_condition_note) = '' THEN condition_note
      WHEN condition_note IS NULL OR btrim(condition_note) = '' THEN p_condition_note
      WHEN position(btrim(p_condition_note) in condition_note) > 0 THEN condition_note
      ELSE condition_note || E'\n' || btrim(p_condition_note)
    END
  WHERE id = v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_check_in(
  uuid, uuid, integer, integer, integer, integer, text, text, boolean, boolean, text, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.insert_check_in(
  uuid, uuid, integer, integer, integer, integer, text, text, boolean, boolean, text, text
) TO authenticated, service_role;

DO $$
DECLARE
  grp record;
  keeper uuid;
  later record;
BEGIN
  FOR grp IN
    SELECT client_id, (created_at AT TIME ZONE 'Africa/Johannesburg')::date AS d
    FROM public.check_ins
    GROUP BY 1, 2
    HAVING count(*) > 1
  LOOP
    SELECT id INTO keeper
    FROM public.check_ins
    WHERE client_id = grp.client_id
      AND (created_at AT TIME ZONE 'Africa/Johannesburg')::date = grp.d
    ORDER BY created_at ASC
    LIMIT 1;

    FOR later IN
      SELECT *
      FROM public.check_ins
      WHERE client_id = grp.client_id
        AND (created_at AT TIME ZONE 'Africa/Johannesburg')::date = grp.d
        AND id <> keeper
      ORDER BY created_at ASC
    LOOP
      UPDATE public.check_ins SET
        pain_level = COALESCE(later.pain_level, pain_level),
        sleep_quality = COALESCE(sleep_quality, later.sleep_quality),
        stress_level = COALESCE(stress_level, later.stress_level),
        energy_level = COALESCE(energy_level, later.energy_level),
        mood = COALESCE(NULLIF(btrim(mood), ''), later.mood),
        notes = CASE
          WHEN later.notes IS NULL OR btrim(later.notes) = '' THEN notes
          WHEN notes IS NULL OR btrim(notes) = '' THEN later.notes
          WHEN position(btrim(later.notes) in notes) > 0 THEN notes
          ELSE notes || E'\n' || btrim(later.notes)
        END,
        medication_taken = COALESCE(medication_taken, later.medication_taken),
        flagged = flagged OR COALESCE(later.flagged, false),
        condition_context = COALESCE(condition_context, later.condition_context),
        condition_note = CASE
          WHEN later.condition_note IS NULL OR btrim(later.condition_note) = '' THEN condition_note
          WHEN condition_note IS NULL OR btrim(condition_note) = '' THEN later.condition_note
          WHEN position(btrim(later.condition_note) in condition_note) > 0 THEN condition_note
          ELSE condition_note || E'\n' || btrim(later.condition_note)
        END
      WHERE id = keeper;
    END LOOP;

    DELETE FROM public.check_ins
    WHERE client_id = grp.client_id
      AND (created_at AT TIME ZONE 'Africa/Johannesburg')::date = grp.d
      AND id <> keeper;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS check_ins_client_sast_day
  ON public.check_ins (client_id, ((created_at AT TIME ZONE 'Africa/Johannesburg')::date));