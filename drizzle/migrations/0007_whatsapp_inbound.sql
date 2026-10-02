-- 0007_whatsapp_inbound
--
-- The inbound queue for the WhatsApp channel. Two new tables, nothing existing
-- touched, no patient data moved.
--
-- Why a queue at all: the webhook's only job is to get the message onto disk
-- and answer the provider inside a couple of seconds. Everything slow (matching
-- a phone number to a patient, model extraction, red flag rules, alerting) runs
-- from this table afterwards, so a slow model call can never make WhatsApp
-- think delivery failed and retry.
--
-- RLS is enabled with no policies on purpose: deny-all to every browser
-- session, service role only, same pattern as session_reports. Nothing a
-- patient sends should be readable from a client-side query.
--
-- NOT APPLIED. Listed for Justin's approval first. Note the retention question
-- in the comment on raw body below: it needs an answer before any real patient
-- uses this, not after.

CREATE TABLE IF NOT EXISTS whatsapp_inbound (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('meta', 'twilio')),
  provider_message_id text NOT NULL,
  from_phone text NOT NULL,
  to_phone text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('text', 'interactive', 'media', 'unsupported')),
  -- The patient's own words. This is a clinical record and the only thing that
  -- makes an extraction bug diagnosable after the fact, which is exactly why it
  -- needs a retention period set rather than keeping it forever by default.
  body text NOT NULL DEFAULT '',
  reply_id text,
  reply_title text,
  media_id text,
  media_mime_type text,
  sent_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  -- pending -> processed, or failed with a reason. Nothing reads this yet.
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'processed', 'failed', 'ignored')),
  processed_at timestamptz,
  failure_reason text,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL
);

-- The idempotency guarantee the webhook depends on. Providers redeliver as a
-- matter of course, so a repeat insert must collide rather than duplicate a
-- patient's message.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_inbound_provider_msg_uniq
  ON whatsapp_inbound (provider, provider_message_id);

CREATE INDEX IF NOT EXISTS whatsapp_inbound_pending_idx
  ON whatsapp_inbound (status, received_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS whatsapp_inbound_from_idx
  ON whatsapp_inbound (from_phone, received_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_inbound_client_idx
  ON whatsapp_inbound (client_id, received_at DESC) WHERE client_id IS NOT NULL;

ALTER TABLE whatsapp_inbound ENABLE ROW LEVEL SECURITY;

-- Delivery receipts for messages we send. Operational, not clinical.
CREATE TABLE IF NOT EXISTS whatsapp_message_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('meta', 'twilio')),
  provider_message_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  error_text text,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_message_status_uniq
  ON whatsapp_message_status (provider, provider_message_id, status);

ALTER TABLE whatsapp_message_status ENABLE ROW LEVEL SECURITY;
