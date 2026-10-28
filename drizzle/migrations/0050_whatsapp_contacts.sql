-- 0050_whatsapp_contacts
--
-- A practitioner can message a phone number that is not a Buddy patient
-- ("message Sarah on 082 123 4567: …"). The row is a contact, not a client:
-- no check-ins, no reports, and it is not in any roster or count that reads
-- public.clients.
--
-- opted_out is set when they reply STOP. Every later send is refused.
-- promoted_client_id is set when the practitioner promotes them. From then
-- on they are a patient and go through the normal consent onboarding.
--
-- Service role only, same as the other WhatsApp tables. Safe to run twice.
-- Do not copy this file into supabase/migrations. Lovable applies drizzle/migrations.

CREATE TABLE IF NOT EXISTS public.whatsapp_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  created_by uuid NOT NULL,
  opted_out boolean NOT NULL DEFAULT false,
  opted_out_at timestamptz,
  promoted_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_contacts_phone_uniq
  ON public.whatsapp_contacts (phone);

CREATE INDEX IF NOT EXISTS whatsapp_contacts_created_by_idx
  ON public.whatsapp_contacts (created_by, created_at DESC);

ALTER TABLE public.whatsapp_contacts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.whatsapp_contacts FROM anon, authenticated;
GRANT ALL ON public.whatsapp_contacts TO service_role;
