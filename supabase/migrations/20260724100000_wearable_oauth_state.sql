-- Oura/Polar OAuth CSRF hardening.
-- Previously Oura and Polar rounded-tripped the raw client_id as the OAuth
-- `state`, which is neither secret nor single-use — an attacker who learns a
-- client's UUID could bind their own wearable account to that client (or link a
-- victim to attacker-controlled data). Garmin already uses a server-side random
-- state; this gives Oura/Polar the same one-time, TTL-bound state.
-- Service-role only (RLS enabled, no policies — mirrors garmin_oauth_state).
CREATE TABLE IF NOT EXISTS public.wearable_oauth_state (
  state      text PRIMARY KEY,
  client_id  uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  provider   text NOT NULL CHECK (provider IN ('oura', 'polar')),
  expires_at timestamptz NOT NULL,           -- ~10 min TTL
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wearable_oauth_state ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: service-role only.
