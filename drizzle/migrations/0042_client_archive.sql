-- 0042_client_archive
--
-- Practice owners can archive clients who have stopped responding, from
-- WhatsApp ("archive everyone who hasn't checked in for 60 days").
-- Archive, not delete: the client's records stay. archived_at set means the
-- client is left off practitioner lists, updates and digests, and Buddy sends
-- them no reminders or nudges. archived_by is the owner who archived them.
-- Clearing archived_at brings them back (also done automatically when the
-- client writes to Buddy).
--
-- Numbered 0042 to stay clear of the pending 0039 to 0041. Safe to run twice.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS archived_by uuid;

CREATE INDEX IF NOT EXISTS clients_archived_at_idx
  ON public.clients (archived_at)
  WHERE archived_at IS NOT NULL;
