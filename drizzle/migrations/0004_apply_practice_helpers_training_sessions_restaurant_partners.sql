CREATE OR REPLACE FUNCTION public.is_owner_of_practice(p_practice uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.practices WHERE id = p_practice AND practitioner_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_owner_of_client_practice(p_client uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    JOIN public.practices p ON p.id = c.practice_id
    WHERE c.id = p_client AND p.practitioner_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_practice_member(p_practice uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.practice_members
    WHERE practice_id = p_practice AND user_id = p_user AND status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.is_owner_of_practice(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_owner_of_client_practice(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_active_practice_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_owner_of_practice(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_owner_of_client_practice(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_practice_member(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "clients practitioner manage" ON public.clients;
CREATE POLICY "clients practitioner manage" ON public.clients
  FOR ALL TO authenticated
  USING (
    auth.uid() = practitioner_id OR private.is_super_admin(auth.uid())
    OR id = private.current_client_id() OR public.is_owner_of_practice(practice_id)
  )
  WITH CHECK (
    auth.uid() = practitioner_id OR private.is_super_admin(auth.uid())
    OR public.is_owner_of_practice(practice_id)
  );

DROP POLICY IF EXISTS "check_ins access" ON public.check_ins;
CREATE POLICY "check_ins access" ON public.check_ins
  FOR ALL TO authenticated
  USING (
    auth.uid() = practitioner_id OR private.is_super_admin(auth.uid())
    OR client_id = private.current_client_id() OR public.is_owner_of_client_practice(client_id)
  )
  WITH CHECK (
    auth.uid() = practitioner_id OR private.is_super_admin(auth.uid())
    OR client_id = private.current_client_id() OR public.is_owner_of_client_practice(client_id)
  );

DROP POLICY IF EXISTS "alerts practitioner manage" ON public.alerts;
CREATE POLICY "alerts practitioner manage" ON public.alerts
  FOR ALL TO authenticated
  USING (
    auth.uid() = practitioner_id OR private.is_super_admin(auth.uid())
    OR public.is_owner_of_client_practice(client_id)
  )
  WITH CHECK (
    auth.uid() = practitioner_id OR private.is_super_admin(auth.uid())
    OR public.is_owner_of_client_practice(client_id)
  );

DROP POLICY IF EXISTS "practice_members read own practice" ON public.practice_members;
CREATE POLICY "practice_members read own practice" ON public.practice_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_active_practice_member(practice_id, auth.uid())
    OR public.is_super_admin(auth.uid())
  );

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS training_schedule_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.training_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  practitioner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  practice_id uuid REFERENCES public.practices(id) ON DELETE SET NULL,
  session_date date NOT NULL,
  session_type text NOT NULL CHECK (session_type IN ('hard','moderate','recovery','rest','competition','other')),
  title text NOT NULL DEFAULT '',
  intensity smallint CHECK (intensity IS NULL OR (intensity >= 1 AND intensity <= 10)),
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  notes text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','wearable')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS training_sessions_client_date_idx
  ON public.training_sessions (client_id, session_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_sessions TO authenticated;
GRANT ALL ON public.training_sessions TO service_role;
ALTER TABLE public.training_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "training_sessions access" ON public.training_sessions;
CREATE POLICY "training_sessions access" ON public.training_sessions
  FOR ALL TO authenticated
  USING (
    auth.uid() = practitioner_id OR private.is_super_admin(auth.uid())
    OR client_id = private.current_client_id() OR public.is_owner_of_client_practice(client_id)
  )
  WITH CHECK (
    auth.uid() = practitioner_id OR private.is_super_admin(auth.uid())
    OR public.is_owner_of_client_practice(client_id)
  );

CREATE TABLE IF NOT EXISTS public.restaurant_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid REFERENCES public.practices(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  maps_url text,
  active boolean NOT NULL DEFAULT true,
  is_placeholder boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restaurant_partners_practice_idx
  ON public.restaurant_partners (practice_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_partners TO authenticated;
GRANT ALL ON public.restaurant_partners TO service_role;
ALTER TABLE public.restaurant_partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "restaurant_partners read" ON public.restaurant_partners;
CREATE POLICY "restaurant_partners read" ON public.restaurant_partners
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid()) OR practice_id IS NULL
    OR public.is_owner_of_practice(practice_id)
    OR public.is_active_practice_member(practice_id, auth.uid())
  );
DROP POLICY IF EXISTS "restaurant_partners write" ON public.restaurant_partners;
CREATE POLICY "restaurant_partners write" ON public.restaurant_partners
  FOR ALL TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (practice_id IS NOT NULL AND (public.is_owner_of_practice(practice_id) OR public.is_active_practice_member(practice_id, auth.uid())))
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR (practice_id IS NOT NULL AND (public.is_owner_of_practice(practice_id) OR public.is_active_practice_member(practice_id, auth.uid())))
  );

ALTER TABLE public.rewards
  ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES public.restaurant_partners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS practice_id uuid REFERENCES public.practices(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS discount_percent integer CHECK (discount_percent IS NULL OR (discount_percent >= 1 AND discount_percent <= 100)),
  ADD COLUMN IF NOT EXISTS min_streak integer CHECK (min_streak IS NULL OR min_streak >= 1),
  ADD COLUMN IF NOT EXISTS min_check_ins integer CHECK (min_check_ins IS NULL OR min_check_ins >= 1),
  ADD COLUMN IF NOT EXISTS earn_on text NOT NULL DEFAULT 'milestone' CHECK (earn_on IN ('milestone','check_in_count','manual'));

CREATE INDEX IF NOT EXISTS rewards_partner_idx ON public.rewards (partner_id);
CREATE INDEX IF NOT EXISTS rewards_practice_idx ON public.rewards (practice_id);

DROP POLICY IF EXISTS "rewards practice write" ON public.rewards;
CREATE POLICY "rewards practice write" ON public.rewards
  FOR ALL TO authenticated
  USING (
    practice_id IS NOT NULL AND (public.is_owner_of_practice(practice_id) OR public.is_active_practice_member(practice_id, auth.uid()))
  )
  WITH CHECK (
    practice_id IS NOT NULL AND (public.is_owner_of_practice(practice_id) OR public.is_active_practice_member(practice_id, auth.uid()))
  );