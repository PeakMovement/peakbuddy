
CREATE TABLE public.push_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL,
  sent_by uuid,
  title text NOT NULL,
  body text NOT NULL,
  provider text NOT NULL DEFAULT 'onesignal',
  status text NOT NULL,
  attempted int NOT NULL DEFAULT 0,
  delivered int NOT NULL DEFAULT 0,
  response jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.push_send_log TO authenticated;
GRANT ALL ON public.push_send_log TO service_role;

ALTER TABLE public.push_send_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admin can read push log"
ON public.push_send_log FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()));

CREATE INDEX push_send_log_created_idx ON public.push_send_log (created_at DESC);
CREATE INDEX push_send_log_recipient_idx ON public.push_send_log (recipient_user_id, created_at DESC);
