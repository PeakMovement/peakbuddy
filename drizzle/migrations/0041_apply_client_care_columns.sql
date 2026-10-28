ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS next_appointment timestamptz;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS phone_e164 text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS discharged_at timestamptz;
CREATE INDEX IF NOT EXISTS clients_phone_e164_idx ON public.clients (phone_e164);
UPDATE public.clients
SET phone_e164 = CASE
  WHEN regexp_replace(phone, '\D', '', 'g') ~ '^0[0-9]{9}$'
    THEN '27' || substring(regexp_replace(phone, '\D', '', 'g') from 2)
  WHEN regexp_replace(phone, '\D', '', 'g') ~ '^270[0-9]{9}$'
    THEN '27' || substring(regexp_replace(phone, '\D', '', 'g') from 4)
  WHEN regexp_replace(phone, '\D', '', 'g') ~ '^00[0-9]{9,}$'
    THEN substring(regexp_replace(phone, '\D', '', 'g') from 3)
  WHEN length(regexp_replace(phone, '\D', '', 'g')) >= 9
    THEN regexp_replace(phone, '\D', '', 'g')
  ELSE NULL
END
WHERE phone IS NOT NULL
  AND (phone_e164 IS NULL OR phone_e164 = '');