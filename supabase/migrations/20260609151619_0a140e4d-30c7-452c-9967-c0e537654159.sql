ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS cover_image_url text,
  ADD COLUMN IF NOT EXISTS duration_label text,
  ADD COLUMN IF NOT EXISTS focus_area text,
  ADD COLUMN IF NOT EXISTS outcomes text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS program_personal_note text,
  ADD COLUMN IF NOT EXISTS program_reminder_snoozed_until timestamptz;