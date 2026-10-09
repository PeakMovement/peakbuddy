ALTER TABLE whatsapp_conversations
  DROP CONSTRAINT IF EXISTS whatsapp_conversations_state_check;
ALTER TABLE whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_state_check
  CHECK (state IN ('new', 'awaiting_consent', 'idle', 'awaiting_pain', 'awaiting_sleep',
                   'awaiting_energy', 'awaiting_notes', 'awaiting_wearable',
                   'awaiting_name', 'awaiting_practitioner', 'awaiting_email',
                   'awaiting_schedule', 'opted_out', 'unmatched'));