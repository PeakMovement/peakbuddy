-- Program Library: richer curated program fields + client-facing library
-- onboarding (first-visit intro + 3-day nudge idempotency).

-- Distinct, structured fields the admin curates per program.
ALTER TABLE public.programs ADD COLUMN IF NOT EXISTS goal text;
ALTER TABLE public.programs ADD COLUMN IF NOT EXISTS applicable_for text;

-- Per-client onboarding state for the library.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS library_intro_seen_at timestamptz;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS onboarding_library_nudge_sent_at timestamptz;

-- Backs the daily 3-day onboarding-nudge cron scan (only un-nudged clients).
CREATE INDEX IF NOT EXISTS clients_onboarding_nudge_idx
  ON public.clients (created_at)
  WHERE onboarding_library_nudge_sent_at IS NULL;
