-- Centralized notification channel: one Buddy-owned webhook/automation drives
-- WhatsApp + email for ALL practitioners, so a new practitioner never sets up
-- their own webhook. They only provide their WhatsApp number to RECEIVE.
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS central_webhook_url text DEFAULT '',
  ADD COLUMN IF NOT EXISTS central_webhook_enabled boolean DEFAULT false;

ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS whatsapp_number text;

COMMENT ON COLUMN public.platform_settings.central_webhook_url IS
  'Single Buddy-owned automation endpoint (Make/Zapier/Twilio). Every alert/contact event POSTs here with the target practitioner''s contact details. Set once by super-admin.';
COMMENT ON COLUMN public.practices.whatsapp_number IS
  'Practitioner WhatsApp number (E.164) the central automation delivers alerts to. No per-practitioner webhook needed.';
