-- 0034_safety_privacy
--
-- 1. grading_settings: any signed-in user could read the row (USING true).
--    Only super admins may read it through the Data API. The app reads the
--    mode with the service role in getGradingMode.
-- 2. alerts.client_id may be null for a red flag from a WhatsApp number that
--    is not on a profile yet. The practice owner is practitioner_id.
-- 3. whatsapp_fired so a failed WhatsApp alert can be retried without
--    sending the push again.
--
-- Safe to run twice. grading_settings was created by Lovable; the policy
-- change is skipped if that table is not on this database.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'grading_settings'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS "Any authed can read grading settings" ON public.grading_settings';
    EXECUTE 'DROP POLICY IF EXISTS "Only super admins can read grading settings" ON public.grading_settings';
    EXECUTE $policy$
      CREATE POLICY "Only super admins can read grading settings"
        ON public.grading_settings
        FOR SELECT
        TO authenticated
        USING (public.is_super_admin(auth.uid()))
    $policy$;
  END IF;
END $$;

ALTER TABLE public.alerts ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS whatsapp_fired boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "alerts select with access" ON public.alerts;
CREATE POLICY "alerts select with access" ON public.alerts
  FOR SELECT TO authenticated
  USING (
    public.caller_can_access_client(client_id)
    OR (client_id IS NULL AND practitioner_id = auth.uid())
  );

DROP POLICY IF EXISTS "alerts staff update" ON public.alerts;
CREATE POLICY "alerts staff update" ON public.alerts
  FOR UPDATE TO authenticated
  USING (
    public.caller_is_staff_for_client(client_id)
    OR (client_id IS NULL AND practitioner_id = auth.uid())
  )
  WITH CHECK (
    public.caller_is_staff_for_client(client_id)
    OR (client_id IS NULL AND practitioner_id = auth.uid())
  );
