-- 0048_client_language
--
-- The language a patient wants Buddy to reply in. Set when they ask
-- ("praat Afrikaans asseblief", "English please") or when they clearly write
-- in Afrikaans or isiXhosa. Null means English. Buddy translates its own
-- replies; safety messages also keep the English. Safe to run twice.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS preferred_language text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_preferred_language_check'
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_preferred_language_check
      CHECK (preferred_language IS NULL OR preferred_language IN ('en', 'af', 'xh', 'zu'));
  END IF;
END $$;
