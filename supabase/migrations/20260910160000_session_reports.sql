-- ============================================================================
-- Session reports: a practitioner uploads patient reports (PDF/images), stored
-- privately in Supabase Storage; Yves can analyse them against the client's
-- symptom + wearable data. All access is mediated by service-role server
-- functions (access-checked via canAccessClient), so the tables + bucket are
-- service-role-only (deny-all RLS, private bucket + signed URLs).
-- ============================================================================

-- Private storage bucket for report files.
INSERT INTO storage.buckets (id, name, public)
VALUES ('session-reports', 'session-reports', false)
ON CONFLICT (id) DO NOTHING;

-- Report metadata.
CREATE TABLE IF NOT EXISTS public.session_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  practice_id  uuid REFERENCES public.practices(id),
  uploaded_by  uuid REFERENCES auth.users(id),
  file_name    text NOT NULL,
  mime_type    text NOT NULL,
  size_bytes   bigint NOT NULL DEFAULT 0,
  storage_path text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS session_reports_client_idx
  ON public.session_reports (client_id, created_at DESC);
ALTER TABLE public.session_reports ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only (all access via server functions).

-- Stored Yves analyses of a client's reports (latest-per-client is what the UI shows).
CREATE TABLE IF NOT EXISTS public.session_report_analyses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  generated_by  uuid REFERENCES auth.users(id),
  focus         text,
  report_count  int NOT NULL DEFAULT 0,
  analysis_text text NOT NULL,
  model         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS session_report_analyses_client_idx
  ON public.session_report_analyses (client_id, created_at DESC);
ALTER TABLE public.session_report_analyses ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only.
