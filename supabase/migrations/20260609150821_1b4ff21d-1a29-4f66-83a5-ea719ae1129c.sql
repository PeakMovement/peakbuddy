REVOKE EXECUTE ON FUNCTION public.insert_check_in(uuid,uuid,integer,integer,integer,integer,text,text,boolean,boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_check_in(uuid,uuid,integer,integer,integer,integer,text,text,boolean,boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_alert(uuid,uuid,text,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_alert(uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_check_in(uuid,uuid,integer,integer,integer,integer,text,text,boolean,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_alert(uuid,uuid,text,text,text) TO authenticated;