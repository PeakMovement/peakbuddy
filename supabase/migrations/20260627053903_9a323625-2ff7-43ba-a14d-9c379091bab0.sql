REVOKE EXECUTE ON FUNCTION public.update_client_phone(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_client_phone(text) FROM public;
GRANT EXECUTE ON FUNCTION public.update_client_phone(text) TO authenticated;