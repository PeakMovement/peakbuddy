ALTER TABLE public.symptom_queries
  ADD COLUMN IF NOT EXISTS patient_understood boolean,
  ADD COLUMN IF NOT EXISTS patient_helpful boolean,
  ADD COLUMN IF NOT EXISTS patient_feedback_at timestamptz;