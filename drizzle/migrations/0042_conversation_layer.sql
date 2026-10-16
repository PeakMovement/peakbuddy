-- 0042_conversation_layer
--
-- Tone, opt-in outreach, pause, quoted replies, and conversation counts.
-- Events store a code, never the patient's words.
-- RLS on, no policies. Service role only. Safe to run twice.

ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS buddy_tone text NOT NULL DEFAULT 'warm';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'practices_buddy_tone_check'
  ) THEN
    ALTER TABLE public.practices
      ADD CONSTRAINT practices_buddy_tone_check
      CHECK (buddy_tone IN ('warm', 'concise', 'sa'));
  END IF;
END $$;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS outreach_opt_in boolean NOT NULL DEFAULT false;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS preferred_name text;

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS buddy_paused_at timestamptz;

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS buddy_paused_by uuid;

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS buddy_pause_note text;

ALTER TABLE public.whatsapp_inbound
  ADD COLUMN IF NOT EXISTS quoted_message_id text;

CREATE TABLE IF NOT EXISTS public.conversation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_events_kind_check
    CHECK (kind IN ('understood', 'fallback', 'saved', 'deferred', 'dropoff'))
);

CREATE INDEX IF NOT EXISTS conversation_events_client_created
  ON public.conversation_events (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.outreach_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL,
  sent_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outreach_sends_kind_check
    CHECK (kind IN ('day_after', 'flare', 'milestone', 'discharge_check')),
  CONSTRAINT outreach_sends_client_kind_day UNIQUE (client_id, kind, sent_on)
);

CREATE TABLE IF NOT EXISTS public.practitioner_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id uuid NOT NULL,
  fact text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

ALTER TABLE public.conversation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practitioner_memory ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.conversation_events FROM anon, authenticated;
REVOKE ALL ON public.outreach_sends FROM anon, authenticated;
REVOKE ALL ON public.practitioner_memory FROM anon, authenticated;

GRANT ALL ON public.conversation_events TO service_role;
GRANT ALL ON public.outreach_sends TO service_role;
GRANT ALL ON public.practitioner_memory TO service_role;
