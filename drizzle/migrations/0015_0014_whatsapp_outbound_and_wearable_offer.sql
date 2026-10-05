CREATE TABLE IF NOT EXISTS whatsapp_outbound (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  provider text NOT NULL CHECK (provider IN ('meta', 'twilio')),
  provider_message_id text,
  kind text NOT NULL CHECK (kind IN ('text', 'buttons', 'list', 'template')),
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