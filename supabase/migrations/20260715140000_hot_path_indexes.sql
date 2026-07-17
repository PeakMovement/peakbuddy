-- Indexes for the queries Buddy runs on every check-in / Yves submission.
-- These paths are currently sequential scans and degrade as volume grows.

-- Trends, pattern detection, baselines and risk analysis all read a client's
-- recent check-ins newest-first.
CREATE INDEX IF NOT EXISTS check_ins_client_created_idx
  ON public.check_ins (client_id, created_at DESC);

-- findRecentOpenAlert(): client + alert_type + unread within 24h. Runs on every
-- flagged check-in and every Yves red flag.
CREATE INDEX IF NOT EXISTS alerts_client_type_unread_idx
  ON public.alerts (client_id, alert_type, is_read, created_at DESC);

-- Practitioner alert inbox.
CREATE INDEX IF NOT EXISTS alerts_practitioner_unread_idx
  ON public.alerts (practitioner_id, is_read, created_at DESC);

-- checkRecentRedFlagQuery(): client + red_flag_detected within 24h, on every
-- Yves submission.
CREATE INDEX IF NOT EXISTS symptom_queries_client_redflag_idx
  ON public.symptom_queries (client_id, red_flag_detected, created_at DESC);

-- Yves history list for a client.
CREATE INDEX IF NOT EXISTS symptom_queries_client_created_idx
  ON public.symptom_queries (client_id, created_at DESC);
