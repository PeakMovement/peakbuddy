-- Alerts: pattern + feedback + category
ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS red_flag_category text,
  ADD COLUMN IF NOT EXISTS pattern text,
  ADD COLUMN IF NOT EXISTS practitioner_assessment text
    CHECK (practitioner_assessment IN ('correct','over','under') OR practitioner_assessment IS NULL);

-- Practices: sensitivity setting
ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS alert_sensitivity text NOT NULL DEFAULT 'normal'
    CHECK (alert_sensitivity IN ('low','normal','high'));

-- Symptom queries: differential + category
ALTER TABLE public.symptom_queries
  ADD COLUMN IF NOT EXISTS differential jsonb,
  ADD COLUMN IF NOT EXISTS red_flag_category text;