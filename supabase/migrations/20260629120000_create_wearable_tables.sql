-- Wearable integration tables (Oura, Polar, Garmin).
-- Keyed on clients.id to slot into PeakBuddy's client/practitioner health model
-- (mirrors check_ins / client_baselines). Token tables are service-role only;
-- session data follows the existing client/practitioner/super_admin RLS pattern.

-- ---------------------------------------------------------------------------
-- 1. wearable_tokens — one row per (client, provider). Holds OAuth tokens.
--    Access tokens must NEVER be readable by clients/practitioners, so this
--    table has RLS enabled with NO policies => only service_role (which bypasses
--    RLS, used by our server functions) can touch it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wearable_tokens (
  client_id        uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  provider         text NOT NULL CHECK (provider IN ('oura', 'garmin', 'polar')),
  access_token     text NOT NULL,
  refresh_token    text,                         -- null for Polar (long-lived token)
  expires_at       timestamptz,                  -- null for Polar
  provider_user_id text,                          -- Garmin userId / Polar x_user_id
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'token_expired')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, provider)
);

ALTER TABLE public.wearable_tokens ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: service-role only.

-- ---------------------------------------------------------------------------
-- 2. wearable_sessions — normalized daily metrics, one row per (client, source, date).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wearable_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source      text NOT NULL CHECK (source IN ('oura', 'garmin', 'polar', 'manual')),
  date        date NOT NULL,
  -- scores
  sleep_score          numeric,
  readiness_score      numeric,
  activity_score       numeric,
  -- vitals
  resting_hr           numeric,
  hrv_avg              numeric,
  spo2_avg             numeric,
  -- sleep breakdown (minutes / seconds as provided, normalized in app)
  total_sleep_duration   int,
  deep_sleep_duration    int,
  light_sleep_duration   int,
  rem_sleep_duration     int,
  sleep_efficiency       numeric,
  -- activity
  total_steps          int,
  total_calories       int,
  active_calories      int,
  duration_minutes     int,
  avg_heart_rate       numeric,
  max_heart_rate       numeric,
  training_load        numeric,
  total_distance_km    numeric,
  session_type         text,
  -- garmin extras
  stress_avg           numeric,
  body_battery_min     int,
  body_battery_max     int,
  respiration_rate_avg numeric,
  vo2_max              numeric,
  fetched_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, source, date)
);

CREATE INDEX IF NOT EXISTS wearable_sessions_client_date_idx
  ON public.wearable_sessions (client_id, date DESC);

ALTER TABLE public.wearable_sessions ENABLE ROW LEVEL SECURITY;

-- Client reads their own rows; practitioner reads their clients' rows;
-- super_admin reads all. Writes happen via service role (server functions),
-- but allow client/practitioner-owned writes for completeness/manual entry.
DROP POLICY IF EXISTS "wearable_sessions access" ON public.wearable_sessions;
CREATE POLICY "wearable_sessions access" ON public.wearable_sessions
FOR ALL
USING (
  client_id = private.current_client_id()
  OR private.is_super_admin(auth.uid())
  OR client_id IN (SELECT id FROM public.clients WHERE practitioner_id = auth.uid())
)
WITH CHECK (
  client_id = private.current_client_id()
  OR private.is_super_admin(auth.uid())
  OR client_id IN (SELECT id FROM public.clients WHERE practitioner_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- 3. garmin_oauth_state — short-lived PKCE state (verifier stashed server-side).
--    Service-role only (RLS enabled, no policies).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.garmin_oauth_state (
  state         text PRIMARY KEY,
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  code_verifier text NOT NULL,
  expires_at    timestamptz NOT NULL,           -- ~10 min TTL
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.garmin_oauth_state ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: service-role only.

-- updated_at touch trigger for wearable_tokens (reuse existing helper if present)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'update_updated_at_column' AND n.nspname = 'public'
  ) THEN
    DROP TRIGGER IF EXISTS wearable_tokens_set_updated_at ON public.wearable_tokens;
    CREATE TRIGGER wearable_tokens_set_updated_at
      BEFORE UPDATE ON public.wearable_tokens
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;
