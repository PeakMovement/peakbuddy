-- ============================================================================
-- Group practices: a practice can be "individual" (one practitioner, today's
-- model) or "group" (an owner/admin practitioner + up to max_members members).
-- Visibility: a practitioner sees only their own clients; the practice owner
-- (admin) sees every client in the practice; super_admin sees all. Enforced in
-- server functions (service role), so existing table RLS is left untouched.
-- Notifications are CENTRALISED per practice (one contact email + phone), never
-- per individual practitioner.
-- ============================================================================

-- 1. Practice: type, member cap, centralised contact -------------------------
ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS practice_type text NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS max_members   int  NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practices_type_chk') THEN
    ALTER TABLE public.practices
      ADD CONSTRAINT practices_type_chk CHECK (practice_type IN ('individual', 'group'));
  END IF;
END $$;

-- Backfill the centralised contact email from the owner's auth email.
UPDATE public.practices p
   SET contact_email = u.email
  FROM auth.users u
 WHERE u.id = p.practitioner_id
   AND p.contact_email IS NULL;

-- 2. Practice membership -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.practice_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  status      text NOT NULL DEFAULT 'active'  CHECK (status IN ('active', 'invited', 'removed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, user_id)
);

CREATE INDEX IF NOT EXISTS practice_members_user_idx ON public.practice_members (user_id);
CREATE INDEX IF NOT EXISTS practice_members_practice_idx ON public.practice_members (practice_id);

ALTER TABLE public.practice_members ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER membership check (bypasses RLS to avoid self-referential
-- recursion in the read policy below).
CREATE OR REPLACE FUNCTION public.is_active_practice_member(p_practice uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.practice_members
    WHERE practice_id = p_practice AND user_id = p_user AND status = 'active'
  );
$$;

-- Members can read their own practice's roster; all writes go through
-- service-role server functions.
DROP POLICY IF EXISTS "practice_members read own practice" ON public.practice_members;
CREATE POLICY "practice_members read own practice" ON public.practice_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_active_practice_member(practice_id, auth.uid())
    OR public.is_super_admin(auth.uid())
  );

-- 3. Clients belong to a practice -------------------------------------------
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS practice_id uuid REFERENCES public.practices(id);
CREATE INDEX IF NOT EXISTS clients_practice_idx ON public.clients (practice_id);

-- 4. Backfill existing data --------------------------------------------------
-- Every existing client belongs to the practice owned by their practitioner.
UPDATE public.clients c
   SET practice_id = p.id
  FROM public.practices p
 WHERE p.practitioner_id = c.practitioner_id
   AND c.practice_id IS NULL;

-- Every existing practice owner is an active 'owner' member of their practice.
INSERT INTO public.practice_members (practice_id, user_id, role, status)
  SELECT p.id, p.practitioner_id, 'owner', 'active'
    FROM public.practices p
ON CONFLICT (practice_id, user_id) DO NOTHING;
