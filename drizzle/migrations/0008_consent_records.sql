-- 0008_consent_records
--
-- Versioned, append-only evidence of what each patient actually agreed to.
--
-- Why this exists: clients.popia_accepted is a boolean. It records THAT someone
-- agreed, not WHAT they agreed to. POPIA puts the burden of proving consent on
-- the responsible party, so when the wording changes (and it is changing now,
-- to name the recipients and the cross-border transfer) there is no way to show
-- which version any existing patient saw. A boolean is not evidence.
--
-- The old boolean is kept and still written, so every existing read of
-- popia_accepted keeps working. This table is additive.

CREATE TABLE IF NOT EXISTS consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (consent_type IN ('popia_core', 'whatsapp_checkins')),
  version text NOT NULL,
  -- The exact text rendered on screen, stored verbatim. Not a pointer to a
  -- version that can be edited later; the point is that this cannot change.
  wording_snapshot text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('pwa', 'whatsapp', 'in_person')),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  -- Minimal supporting evidence: for WhatsApp the provider message id, for the
  -- app the user agent. Deliberately not an IP address: it would be more
  -- personal information collected for no clinical purpose.
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Set when a later consent replaces this one, so two records with different
  -- wording can never both look current.
  superseded_by uuid REFERENCES consent_records(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS consent_records_client_idx
  ON consent_records (client_id, consent_type, accepted_at DESC);

-- The current consent per patient per type: not withdrawn, not superseded.
CREATE INDEX IF NOT EXISTS consent_records_current_idx
  ON consent_records (client_id, consent_type)
  WHERE withdrawn_at IS NULL AND superseded_by IS NULL;

ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;

-- A patient may read their own consents, which is their access right under
-- POPIA made cheap. They may not write them: the record is the evidence, and
-- evidence the subject can edit is not evidence. All writes go through server
-- functions on the service role.
CREATE POLICY "consent_records client select own" ON consent_records
  FOR SELECT TO authenticated
  USING (client_id = private.current_client_id());
