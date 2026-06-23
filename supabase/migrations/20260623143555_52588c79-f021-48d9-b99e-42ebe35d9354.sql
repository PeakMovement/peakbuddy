CREATE TABLE public.grading_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mode text NOT NULL DEFAULT 'super_admin_only' CHECK (mode IN ('super_admin_only','practitioner','sampled')),
  sample_rate numeric NOT NULL DEFAULT 0.2,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.grading_settings TO authenticated;
GRANT ALL ON public.grading_settings TO service_role;

ALTER TABLE public.grading_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Any authed can read grading settings"
  ON public.grading_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only super admins can update grading settings"
  ON public.grading_settings FOR UPDATE
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

INSERT INTO public.grading_settings (id, mode, sample_rate) VALUES (1, 'super_admin_only', 0.2)
ON CONFLICT (id) DO NOTHING;