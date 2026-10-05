-- 0014_whatsapp_outbound_and_wearable_offer
--
-- Three small additions for the WhatsApp agent. Nothing existing changes
-- meaning, nothing is moved, no patient data is touched.
--
-- 1. whatsapp_outbound: what Buddy SAID to each patient. Inbound messages are
--    already kept in whatsapp_inbound; without this table a practitioner can
--    only ever see half the conversation. Service role only, like the inbound
--    table. Practitioners read it through a server function that checks they
--    treat the patient.
--
-- 2. whatsapp_conversations.wearable_offer_at: when Buddy last offered to
--    connect a wearable, so the offer is made once and not after every
--    check-in.
--
-- 3. A new conversation state, 'awaiting_wearable', for the yes / not now
--    answer to that offer. The CHECK constraint is replaced to allow it.
--
-- GRANTS: new tables land with ALL granted to anon and authenticated by
-- default on this database. Revoked explicitly below.
--
-- Every statement is safe to run twice.
--
-- NOT APPLIED. Listed for Justin's approval first.

CREATE TABLE IF NOT EXISTS whatsapp_outbound (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  provider text NOT NULL CHECK (provider IN ('meta', 'twilio')),
  provider_message_id text,
  kind text NOT NULL CHECK (kind IN ('text', 'buttons', 'list', 'template')),
  -- Buddy's own words, as sent. Button and list labels are appended so the
  -- practitioner sees what the patient was choosing between.
  body text NOT NULL DEFAULT '',
  sent_ok boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_outbound_client_idx
  ON whatsapp_outbound (client_id, created_at DESC) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_outbound_phone_idx
  ON whatsapp_outbound (phone, created_at DESC);

ALTER TABLE whatsapp_outbound ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_outbound FROM anon, authenticated;
GRANT ALL ON public.whatsapp_outbound TO service_role;

ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS wearable_offer_at timestamptz;

ALTER TABLE whatsapp_conversations
  DROP CONSTRAINT IF EXISTS whatsapp_conversations_state_check;
ALTER TABLE whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_state_check
  CHECK (state IN ('new', 'awaiting_consent', 'idle', 'awaiting_pain', 'awaiting_sleep',
                   'awaiting_energy', 'awaiting_notes', 'awaiting_wearable',
                   'opted_out', 'unmatched'));
