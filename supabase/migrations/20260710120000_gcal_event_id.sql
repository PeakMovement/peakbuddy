-- Google Calendar "add to calendar": remember the event we created for the
-- client's check-in reminder so repeat clicks replace it instead of duplicating.
ALTER TABLE public.google_calendar_tokens
  ADD COLUMN IF NOT EXISTS checkin_event_id text;
