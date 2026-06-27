CREATE OR REPLACE FUNCTION public.update_client_phone(p_phone text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.clients
  SET phone = p_phone
  WHERE id = private.current_client_id();
END;
$$;