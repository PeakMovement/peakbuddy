
-- Merge duplicate Bruce Wayne client rows: keep the newer one with the assigned program, move data, delete older.
UPDATE public.check_ins SET client_id = 'ee97fc5b-32b8-4eb0-8397-ab29c9a853ac'
  WHERE client_id = '65480e3a-2b67-456e-a788-72d8c69ad2d5';
UPDATE public.alerts SET client_id = 'ee97fc5b-32b8-4eb0-8397-ab29c9a853ac'
  WHERE client_id = '65480e3a-2b67-456e-a788-72d8c69ad2d5';
DELETE FROM public.clients WHERE id = '65480e3a-2b67-456e-a788-72d8c69ad2d5';

-- Prevent future duplicate client emails (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS clients_email_lower_unique ON public.clients (lower(email));
