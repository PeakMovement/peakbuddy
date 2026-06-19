
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS passive_monitoring_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS predictive_nudges_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Africa/Johannesburg';

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS passive_monitoring_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS predictive_nudges_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE public.client_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  computed_at timestamptz NOT NULL DEFAULT now(),
  pain_mean numeric, pain_std numeric,
  sleep_mean numeric, sleep_std numeric,
  stress_mean numeric, stress_std numeric,
  energy_mean numeric, energy_std numeric,
  mood_mean numeric, mood_std numeric,
  sample_size integer NOT NULL DEFAULT 0,
  UNIQUE (client_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_baselines TO authenticated;
GRANT ALL ON public.client_baselines TO service_role;
ALTER TABLE public.client_baselines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "baselines access" ON public.client_baselines FOR ALL
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_baselines.client_id
    AND (c.practitioner_id = auth.uid() OR private.is_super_admin(auth.uid()) OR c.id = private.current_client_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_baselines.client_id
    AND (c.practitioner_id = auth.uid() OR private.is_super_admin(auth.uid()))));

CREATE TABLE public.risk_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  score_date date NOT NULL,
  risk_score integer NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  delta_vs_baseline jsonb NOT NULL DEFAULT '{}'::jsonb,
  trend text NOT NULL DEFAULT 'stable' CHECK (trend IN ('improving','stable','worsening')),
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, score_date)
);
CREATE INDEX risk_scores_client_date_idx ON public.risk_scores (client_id, score_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.risk_scores TO authenticated;
GRANT ALL ON public.risk_scores TO service_role;
ALTER TABLE public.risk_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "risk_scores access" ON public.risk_scores FOR ALL
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = risk_scores.client_id
    AND (c.practitioner_id = auth.uid() OR private.is_super_admin(auth.uid()) OR c.id = private.current_client_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = risk_scores.client_id
    AND (c.practitioner_id = auth.uid() OR private.is_super_admin(auth.uid()))));

CREATE TABLE public.practitioner_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  risk_score_id uuid REFERENCES public.risk_scores(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('risk_flare','pattern_insight')),
  draft_title text NOT NULL,
  draft_body text NOT NULL,
  suggested_action jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','sent','dismissed','edited')),
  created_at timestamptz NOT NULL DEFAULT now(),
  acted_at timestamptz
);
CREATE INDEX practitioner_drafts_prac_status_idx ON public.practitioner_drafts (practitioner_id, status, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.practitioner_drafts TO authenticated;
GRANT ALL ON public.practitioner_drafts TO service_role;
ALTER TABLE public.practitioner_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drafts practitioner manage" ON public.practitioner_drafts FOR ALL
  USING (auth.uid() = practitioner_id OR private.is_super_admin(auth.uid()))
  WITH CHECK (auth.uid() = practitioner_id OR private.is_super_admin(auth.uid()));

CREATE TABLE public.client_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  pattern_type text NOT NULL,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  metric text NOT NULL,
  avg_value numeric NOT NULL,
  confidence numeric NOT NULL DEFAULT 0,
  sample_size integer NOT NULL DEFAULT 0,
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (client_id, pattern_type, day_of_week, metric)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_patterns TO authenticated;
GRANT ALL ON public.client_patterns TO service_role;
ALTER TABLE public.client_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "patterns access" ON public.client_patterns FOR ALL
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_patterns.client_id
    AND (c.practitioner_id = auth.uid() OR private.is_super_admin(auth.uid()) OR c.id = private.current_client_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_patterns.client_id
    AND (c.practitioner_id = auth.uid() OR private.is_super_admin(auth.uid()))));

CREATE TABLE public.predictive_nudges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  pattern_id uuid REFERENCES public.client_patterns(id) ON DELETE SET NULL,
  scheduled_for timestamptz NOT NULL,
  nudge_title text NOT NULL,
  nudge_body text NOT NULL,
  program_id uuid REFERENCES public.programs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sent','opened','dismissed','skipped')),
  sent_at timestamptz,
  opened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX predictive_nudges_client_sched_idx ON public.predictive_nudges (client_id, scheduled_for DESC);
CREATE INDEX predictive_nudges_due_idx ON public.predictive_nudges (status, scheduled_for);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.predictive_nudges TO authenticated;
GRANT ALL ON public.predictive_nudges TO service_role;
ALTER TABLE public.predictive_nudges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nudges access" ON public.predictive_nudges FOR ALL
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = predictive_nudges.client_id
    AND (c.practitioner_id = auth.uid() OR private.is_super_admin(auth.uid()) OR c.id = private.current_client_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = predictive_nudges.client_id
    AND (c.practitioner_id = auth.uid() OR private.is_super_admin(auth.uid()) OR c.id = private.current_client_id())));
