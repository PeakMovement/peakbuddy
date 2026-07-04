-- Per-client unguessable token for their private iCal rehab-reminder feed
-- (subscribed by their calendar app; no session, so it authenticates by token).
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS calendar_feed_token text UNIQUE;
