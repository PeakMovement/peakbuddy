
CREATE TABLE public.yves_triage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  practitioner_id uuid NOT NULL,
  symptom_query_id uuid REFERENCES public.symptom_queries(id) ON DELETE SET NULL,
  prompt_version text NOT NULL,
  query_text_len int,
  extraction_model text,
  extraction_output jsonb,
  first_pass_model text,
  first_pass_urgency text,
  first_pass_severity int,
  first_pass_confidence numeric,
  escalated boolean NOT NULL DEFAULT false,
  escalation_reasons text[] NOT NULL DEFAULT '{}',
  final_model text,
  final_urgency text,
  final_severity int,
  final_red_flag_category text,
  floor_terms_hit text[] NOT NULL DEFAULT '{}',
  combination_floor_hit text[] NOT NULL DEFAULT '{}',
  hard_override_hit text[] NOT NULL DEFAULT '{}',
  total_latency_ms int,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX yves_triage_logs_client_created_idx ON public.yves_triage_logs (client_id, created_at DESC);
CREATE INDEX yves_triage_logs_practitioner_created_idx ON public.yves_triage_logs (practitioner_id, created_at DESC);

GRANT ALL ON public.yves_triage_logs TO service_role;
GRANT SELECT ON public.yves_triage_logs TO authenticated;

ALTER TABLE public.yves_triage_logs ENABLE ROW LEVEL SECURITY;

-- Super admin read only via existing profiles.role convention
CREATE POLICY "yves_triage_logs super admin select"
  ON public.yves_triage_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );
