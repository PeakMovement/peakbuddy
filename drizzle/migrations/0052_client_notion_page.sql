-- 0052_client_notion_page
--
-- The external Buddy agent adds clients from a Notion list
-- (POST /api/public/hooks/client-upsert). notion_page_id is that page.
-- source is the list name. onboarding_source is set to the same value by
-- the hook so the existing source field agrees. Existing rows stay null.
--
-- The page id is unique when set, including archived rows, so one Notion
-- page cannot be two clients. Phone is not unique for every client: two
-- profiles may already share a line. The partial index below only stops
-- this hook from creating two active rows for one number.
--
-- Additive. Safe to run twice. Do not copy this file into supabase/migrations.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS notion_page_id text;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_notion_page_id_format'
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_notion_page_id_format
      CHECK (
        notion_page_id IS NULL
        OR notion_page_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_source_known'
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_source_known
      CHECK (source IS NULL OR source = 'notion-buddy-clients');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS clients_notion_page_id_uniq
  ON public.clients (notion_page_id)
  WHERE notion_page_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS clients_notion_buddy_phone_active_uniq
  ON public.clients (phone_e164)
  WHERE source = 'notion-buddy-clients'
    AND archived_at IS NULL
    AND phone_e164 IS NOT NULL;
