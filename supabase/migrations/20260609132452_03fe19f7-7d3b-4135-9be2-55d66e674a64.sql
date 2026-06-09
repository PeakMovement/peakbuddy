
CREATE TABLE public.programs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  external_url TEXT NOT NULL,
  symptom_tags TEXT[] NOT NULL DEFAULT '{}',
  pain_min INT,
  pain_max INT,
  active BOOLEAN NOT NULL DEFAULT true,
  priority INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.programs TO anon, authenticated;
GRANT ALL ON public.programs TO service_role;

ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active programs"
  ON public.programs FOR SELECT
  USING (active = true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_programs_updated_at
  BEFORE UPDATE ON public.programs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.programs (name, description, external_url, symptom_tags, pain_min, pain_max, priority) VALUES
  ('Lower Back Recovery', 'A 6-week guided program for lower back pain — daily mobility, strengthening, and pain education.', 'https://peakmovement.example.com/programs/lower-back', ARRAY['back','lower-back','high-pain'], 4, 10, 10),
  ('Sleep Reset', 'Evidence-based program to rebuild healthy sleep patterns over 4 weeks.', 'https://peakmovement.example.com/programs/sleep', ARRAY['sleep','stress'], NULL, NULL, 5),
  ('Stress & Recovery', 'Breathwork, nervous-system regulation, and recovery practices for high-stress periods.', 'https://peakmovement.example.com/programs/stress', ARRAY['stress','mood','energy'], NULL, NULL, 5),
  ('General Movement Foundations', 'A gentle, full-body movement program suitable for most starting points.', 'https://peakmovement.example.com/programs/foundations', ARRAY['general'], 0, 6, 1);
