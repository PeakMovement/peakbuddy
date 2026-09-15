CREATE TABLE IF NOT EXISTS public.practice_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, user_id)
);

GRANT SELECT ON public.practice_members TO authenticated;
GRANT ALL ON public.practice_members TO service_role;

ALTER TABLE public.practice_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their practice roster" ON public.practice_members;
CREATE POLICY "Members can view their practice roster"
ON public.practice_members FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.practices p WHERE p.id = practice_id AND p.practitioner_id = auth.uid())
  OR public.is_super_admin(auth.uid())
);

ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS practice_type text NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS max_members integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS join_token text,
  ADD COLUMN IF NOT EXISTS join_enabled boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS practices_join_token_key ON public.practices (join_token) WHERE join_token IS NOT NULL;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS practice_id uuid REFERENCES public.practices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS clients_practice_id_idx ON public.clients (practice_id);
