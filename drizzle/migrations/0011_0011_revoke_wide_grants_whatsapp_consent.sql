REVOKE ALL ON public.whatsapp_inbound FROM anon, authenticated;
REVOKE ALL ON public.whatsapp_message_status FROM anon, authenticated;
REVOKE ALL ON public.consent_records FROM anon;
REVOKE ALL ON public.consent_records FROM authenticated;
GRANT SELECT ON public.consent_records TO authenticated;