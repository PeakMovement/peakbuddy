GRANT ALL ON public.whatsapp_inbound TO service_role;
GRANT ALL ON public.whatsapp_message_status TO service_role;
GRANT ALL ON public.consent_records TO service_role;
GRANT SELECT ON public.consent_records TO authenticated;