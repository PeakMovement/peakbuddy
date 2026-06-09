ALTER FUNCTION public.insert_check_in(uuid,uuid,integer,integer,integer,integer,text,text,boolean,boolean) SECURITY INVOKER;
ALTER FUNCTION public.insert_alert(uuid,uuid,text,text,text) SECURITY INVOKER;
REVOKE EXECUTE ON FUNCTION public.prevent_role_escalation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_role_escalation() FROM anon;
REVOKE EXECUTE ON FUNCTION public.prevent_role_escalation() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.insert_check_in(uuid,uuid,integer,integer,integer,integer,text,text,boolean,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_alert(uuid,uuid,text,text,text) TO authenticated;