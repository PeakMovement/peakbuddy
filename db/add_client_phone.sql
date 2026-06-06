-- Add phone column to clients table for profile display
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS phone text;

GRANT SELECT ON public.clients TO anon;
GRANT SELECT ON public.clients TO authenticated;
