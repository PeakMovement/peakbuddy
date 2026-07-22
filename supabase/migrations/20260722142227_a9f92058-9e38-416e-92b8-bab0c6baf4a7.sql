
-- 1. yves_memory
CREATE TABLE public.yves_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  scope text NOT NULL CHECK (scope IN ('global','insight','triage','pain_symptoms','sleep','stress','wearable','risk')),
  rule_type text NOT NULL CHECK (rule_type IN ('reasoning','phrasing','formatting','safety','do_not')),
  title text NOT NULL,
  rule_text text NOT NULL,
  rationale text,
  is_active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  supersedes uuid REFERENCES public.yves_memory(id),
  created_by uuid REFERENCES public.profiles(id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.yves_memory TO authenticated;
GRANT ALL ON public.yves_memory TO service_role;
ALTER TABLE public.yves_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "yves_memory super admin all" ON public.yves_memory
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 2. yves_memory_staging
CREATE TABLE public.yves_memory_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  scope text NOT NULL CHECK (scope IN ('global','insight','triage','pain_symptoms','sleep','stress','wearable','risk')),
  rule_type text NOT NULL CHECK (rule_type IN ('reasoning','phrasing','formatting','safety','do_not')),
  title text NOT NULL,
  rule_text text NOT NULL,
  rationale text,
  is_active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  supersedes uuid REFERENCES public.yves_memory(id),
  created_by uuid REFERENCES public.profiles(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  source_feedback_id uuid,
  proposed_by text NOT NULL DEFAULT 'yves' CHECK (proposed_by IN ('yves','admin')),
  conflict_flags jsonb DEFAULT '[]'::jsonb,
  review_note text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.yves_memory_staging TO authenticated;
GRANT ALL ON public.yves_memory_staging TO service_role;
ALTER TABLE public.yves_memory_staging ENABLE ROW LEVEL SECURITY;
CREATE POLICY "yves_memory_staging super admin all" ON public.yves_memory_staging
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 3. yves_feedback_log
CREATE TABLE public.yves_feedback_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  session_id uuid NOT NULL,
  admin_id uuid REFERENCES public.profiles(id),
  scope text,
  test_context jsonb,
  question text,
  yves_answer text,
  admin_correction text,
  resulted_in_staging_id uuid REFERENCES public.yves_memory_staging(id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.yves_feedback_log TO authenticated;
GRANT ALL ON public.yves_feedback_log TO service_role;
ALTER TABLE public.yves_feedback_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "yves_feedback_log super admin all" ON public.yves_feedback_log
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 4. yves_memory_versions
CREATE TABLE public.yves_memory_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  version_number int NOT NULL,
  snapshot jsonb NOT NULL,
  created_by uuid REFERENCES public.profiles(id),
  note text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.yves_memory_versions TO authenticated;
GRANT ALL ON public.yves_memory_versions TO service_role;
ALTER TABLE public.yves_memory_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "yves_memory_versions super admin all" ON public.yves_memory_versions
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- updated_at triggers
CREATE TRIGGER update_yves_memory_updated_at BEFORE UPDATE ON public.yves_memory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_yves_memory_staging_updated_at BEFORE UPDATE ON public.yves_memory_staging
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Add memory_version to client_insight_logs
ALTER TABLE public.client_insight_logs ADD COLUMN IF NOT EXISTS memory_version int;
