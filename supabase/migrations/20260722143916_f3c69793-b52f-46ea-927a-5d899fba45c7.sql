
ALTER TABLE public.client_insight_logs
  ADD COLUMN IF NOT EXISTS grade text CHECK (grade IN ('good','poor')),
  ADD COLUMN IF NOT EXISTS grade_note text,
  ADD COLUMN IF NOT EXISTS graded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS graded_at timestamptz;

DROP POLICY IF EXISTS "super admins update insight logs" ON public.client_insight_logs;
CREATE POLICY "super admins update insight logs"
  ON public.client_insight_logs
  FOR UPDATE
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS client_insight_logs_grade_idx
  ON public.client_insight_logs (grade, memory_version, created_at DESC);
