-- 0012_whatsapp_conversations
--
-- Where each WhatsApp number is in its conversation with Buddy, and a marker on
-- check_ins saying which channel a check-in came from.
--
-- One new table, one new column. Nothing existing is changed or moved.
--
-- whatsapp_conversations: one row per WhatsApp number. Holds the link to the
-- Buddy profile once matched, the step of the check-in in progress, the answers
-- collected so far, and the opt-out. It holds patient answers mid check-in, so
-- it is service role only, like whatsapp_inbound.
--
-- check_ins.source: 'app' for everything that exists today (the default), and
-- 'whatsapp' for check-ins written by the WhatsApp worker. The app's
-- insert_check_in RPC is untouched and keeps writing 'app' by default.
--
-- GRANTS: this database grants ALL to anon and authenticated on every new
-- table by default. That is revoked explicitly below, in the same migration.
-- RLS is enabled with no policies, so even a stray grant would see nothing.
--
-- NOT APPLIED. Listed for Justin's approval first.

CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- E.164 digits, no plus, exactly as WhatsApp sends it. The join key.
  phone text NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'new'
    CHECK (state IN ('new', 'awaiting_consent', 'idle', 'awaiting_pain', 'awaiting_sleep',
                     'awaiting_energy', 'awaiting_notes', 'opted_out', 'unmatched')),
  -- Answers collected so far in the current check-in. Cleared when it is saved.
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  checkin_started_at timestamptz,
  opted_out_at timestamptz,
  -- Meta only allows free-form replies within 24 hours of the patient's last
  -- message. Outside that window only approved templates may be sent.
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  -- So an unknown number is told once a day that we can't find it, not on
  -- every message.
  unmatched_notice_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_conversations_phone_uniq
  ON whatsapp_conversations (phone);
CREATE INDEX IF NOT EXISTS whatsapp_conversations_client_idx
  ON whatsapp_conversations (client_id) WHERE client_id IS NOT NULL;

ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.whatsapp_conversations FROM anon, authenticated;
GRANT ALL ON public.whatsapp_conversations TO service_role;

ALTER TABLE check_ins
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app'
    CHECK (source IN ('app', 'whatsapp'));
