GRANT EXECUTE ON FUNCTION public.current_client_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_alert(uuid, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_check_in(uuid, uuid, integer, integer, integer, integer, text, text, boolean, boolean) TO authenticated;

GRANT EXECUTE ON FUNCTION public.current_client_id() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.insert_alert(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.insert_check_in(uuid, uuid, integer, integer, integer, integer, text, text, boolean, boolean) TO service_role;