GRANT SELECT, INSERT, UPDATE, DELETE ON public.alerts TO authenticated;
GRANT ALL ON public.alerts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;

REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_client_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_client_id() TO authenticated, service_role;

ALTER TABLE public.practices ADD COLUMN IF NOT EXISTS gamification_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.practices ADD COLUMN IF NOT EXISTS auto_reward_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS calendar_feed_token text UNIQUE;