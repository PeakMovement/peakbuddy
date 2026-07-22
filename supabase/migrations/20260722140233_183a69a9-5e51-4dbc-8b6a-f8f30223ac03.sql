
CREATE TABLE public.client_insight_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  generated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  focus text,
  model text,
  response text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.client_insight_logs TO authenticated;
GRANT ALL ON public.client_insight_logs TO service_role;
ALTER TABLE public.client_insight_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super admins read insight logs"
  ON public.client_insight_logs FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));
CREATE POLICY "super admins insert insight logs"
  ON public.client_insight_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()) AND generated_by = auth.uid());
CREATE INDEX idx_client_insight_logs_client ON public.client_insight_logs(client_id, created_at DESC);
