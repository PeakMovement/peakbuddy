-- 0016_whatsapp_onboarding
--
-- Onboarding patients through WhatsApp, without them signing up to the app
-- first, and signing consent on a page Buddy sends them.
--
-- 1. whatsapp_invites: the codes inside "Chat to Buddy" links.
--    kind 'client'   = one patient, created by their practitioner. Tapping the
--                      link links that WhatsApp number to the profile.
--    kind 'practice' = a practice's general link (posters, QR at reception,
--                      website). Buddy asks the person's name and which
--                      practitioner they see, and creates their profile.
--
-- 2. consent_links: single-use links to the consent page. Only a SHA-256
--    hash of the token is stored, so a database read never yields a working
--    link. Expire after 7 days.
--
-- 3. clients.onboarding_source: how a profile came to exist ('app',
--    'whatsapp_invite', 'whatsapp_self'). Null for everything existing.
--
-- 4. whatsapp_conversations: app_offer_at, and the new onboarding states.
--
-- GRANTS: new tables are revoked from anon and authenticated explicitly. RLS
-- on with no policies: service role only, reached through server functions.
--
-- Every statement is safe to run twice.
--
-- NOT APPLIED. Listed for Justin's approval first.

CREATE TABLE IF NOT EXISTS whatsapp_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('client', 'practice')),
  practice_id uuid REFERENCES practices(id) ON DELETE CASCADE,
  practitioner_id uuid,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz,
  CHECK ((kind = 'client' AND client_id IS NOT NULL) OR (kind = 'practice' AND practice_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_invites_code_uniq ON whatsapp_invites (upper(code));
CREATE INDEX IF NOT EXISTS whatsapp_invites_client_idx ON whatsapp_invites (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_invites_practice_idx ON whatsapp_invites (practice_id, kind);

ALTER TABLE whatsapp_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_invites FROM anon, authenticated;
GRANT ALL ON public.whatsapp_invites TO service_role;

CREATE TABLE IF NOT EXISTS consent_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- E.164 digits of the WhatsApp number the link was sent to, so Buddy can
  -- carry on the conversation once it is signed.
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS consent_links_token_uniq ON consent_links (token_hash);
CREATE INDEX IF NOT EXISTS consent_links_client_idx ON consent_links (client_id, created_at DESC);

ALTER TABLE consent_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.consent_links FROM anon, authenticated;
GRANT ALL ON public.consent_links TO service_role;

ALTER TABLE clients ADD COLUMN IF NOT EXISTS onboarding_source text;

ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS app_offer_at timestamptz;

ALTER TABLE whatsapp_conversations
  DROP CONSTRAINT IF EXISTS whatsapp_conversations_state_check;
ALTER TABLE whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_state_check
  CHECK (state IN ('new', 'awaiting_consent', 'idle', 'awaiting_pain', 'awaiting_sleep',
                   'awaiting_energy', 'awaiting_notes', 'awaiting_wearable',
                   'awaiting_name', 'awaiting_practitioner', 'awaiting_email',
                   'opted_out', 'unmatched'));
