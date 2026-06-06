
CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    -- Allow trusted backend (service_role) writes through.
    IF current_user = 'service_role'
       OR session_user = 'service_role'
       OR auth.role() = 'service_role'
       OR current_setting('request.jwt.claim.role', true) = 'service_role'
       OR (current_setting('request.jwt.claims', true) <> ''
           AND (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role')
    THEN
      RETURN NEW;
    END IF;

    IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Not authorized to change role';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
