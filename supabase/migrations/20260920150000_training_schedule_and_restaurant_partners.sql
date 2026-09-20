-- Symptom × training schedule cross-check + restaurant-partner check-in rewards.
-- Training schedule is practitioner-entered (manual). Wearable load remains a
-- separate overlay when a device is connected. Restaurant partners extend the
-- existing rewards / client_rewards engine — no parallel voucher system.
--
-- No production restaurant names are seeded. Justin's list is loaded via the
-- admin/practitioner UI or docs/examples/restaurant-partners.example.sql.

-- ---------------------------------------------------------------------------
-- Feature flags (safe rollout)
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS training_schedule_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.platform_settings.training_schedule_enabled IS
  'When true, practitioners can log training sessions and see the symptom × schedule overlay. Default on; flip off to hide without a deploy.';

-- ---------------------------------------------------------------------------
-- training_sessions — planned / logged schedule per client
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.training_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  practitioner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  practice_id uuid REFERENCES public.practices(id) ON DELETE SET NULL,
  session_date date NOT NULL,
  session_type text NOT NULL CHECK (
    session_type IN ('hard', 'moderate', 'recovery', 'rest', 'competition', 'other')
  ),
  title text NOT NULL DEFAULT '',
  intensity smallint CHECK (intensity IS NULL OR (intensity >= 1 AND intensity <= 10)),
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  notes text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'wearable')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_sessions_client_date_idx
  ON public.training_sessions (client_id, session_date DESC);

COMMENT ON TABLE public.training_sessions IS
  'Practitioner-entered training schedule (hard / recovery / rest, etc.). Used to overlay check-in symptom scores. Not a wearable table.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_sessions TO authenticated;
GRANT ALL ON public.training_sessions TO service_role;
ALTER TABLE public.training_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "training_sessions access" ON public.training_sessions;
CREATE POLICY "training_sessions access" ON public.training_sessions
  FOR ALL TO authenticated
  USING (
    auth.uid() = practitioner_id
    OR private.is_super_admin(auth.uid())
    OR client_id = private.current_client_id()
    OR public.is_owner_of_client_practice(client_id)
  )
  WITH CHECK (
    auth.uid() = practitioner_id
    OR private.is_super_admin(auth.uid())
    OR public.is_owner_of_client_practice(client_id)
  );

-- ---------------------------------------------------------------------------
-- restaurant_partners — Peak Movement (platform) or practice-scoped venues
-- ---------------------------------------------------------------------------
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

COMMENT ON TABLE public.restaurant_partners IS
  'Restaurant (or similar) partners that issue check-in discount vouchers. practice_id NULL = platform-wide (Justin / super admin). Never stores patient PII.';
COMMENT ON COLUMN public.restaurant_partners.is_placeholder IS
  'True for example rows only. Do not activate placeholders in production.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_partners TO authenticated;
GRANT ALL ON public.restaurant_partners TO service_role;
ALTER TABLE public.restaurant_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "restaurant_partners read" ON public.restaurant_partners;
CREATE POLICY "restaurant_partners read" ON public.restaurant_partners
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR practice_id IS NULL
    OR public.is_owner_of_practice(practice_id)
    OR public.is_active_practice_member(practice_id, auth.uid())
  );

DROP POLICY IF EXISTS "restaurant_partners write" ON public.restaurant_partners;
CREATE POLICY "restaurant_partners write" ON public.restaurant_partners
  FOR ALL TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (
      practice_id IS NOT NULL
      AND (
        public.is_owner_of_practice(practice_id)
        OR public.is_active_practice_member(practice_id, auth.uid())
      )
    )
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR (
      practice_id IS NOT NULL
      AND (
        public.is_owner_of_practice(practice_id)
        OR public.is_active_practice_member(practice_id, auth.uid())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Extend existing rewards catalog (do not create a parallel voucher system)
-- ---------------------------------------------------------------------------
ALTER TABLE public.rewards
  ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES public.restaurant_partners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS practice_id uuid REFERENCES public.practices(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS discount_percent integer
    CHECK (discount_percent IS NULL OR (discount_percent >= 1 AND discount_percent <= 100)),
  ADD COLUMN IF NOT EXISTS min_streak integer
    CHECK (min_streak IS NULL OR min_streak >= 1),
  ADD COLUMN IF NOT EXISTS min_check_ins integer
    CHECK (min_check_ins IS NULL OR min_check_ins >= 1),
  ADD COLUMN IF NOT EXISTS earn_on text NOT NULL DEFAULT 'milestone'
    CHECK (earn_on IN ('milestone', 'check_in_count', 'manual'));

CREATE INDEX IF NOT EXISTS rewards_partner_idx ON public.rewards (partner_id);
CREATE INDEX IF NOT EXISTS rewards_practice_idx ON public.rewards (practice_id);

COMMENT ON COLUMN public.rewards.partner_id IS
  'Optional restaurant partner this voucher belongs to. NULL = generic reward.';
COMMENT ON COLUMN public.rewards.practice_id IS
  'NULL = platform-wide pool. Set = only issued to clients of that practice.';
COMMENT ON COLUMN public.rewards.earn_on IS
  'milestone = streak 3/7/14/30; check_in_count = lifetime check-ins; manual = practitioner approve only.';
COMMENT ON COLUMN public.rewards.min_streak IS
  'If set, auto-issue this reward only when the client hits this streak milestone.';
COMMENT ON COLUMN public.rewards.min_check_ins IS
  'If earn_on = check_in_count, issue once the client has this many check-ins.';

-- Practitioner-scoped catalog writes (platform-wide rows stay super-admin).
DROP POLICY IF EXISTS "rewards practice write" ON public.rewards;
CREATE POLICY "rewards practice write" ON public.rewards
  FOR ALL TO authenticated
  USING (
    practice_id IS NOT NULL
    AND (
      public.is_owner_of_practice(practice_id)
      OR public.is_active_practice_member(practice_id, auth.uid())
    )
  )
  WITH CHECK (
    practice_id IS NOT NULL
    AND (
      public.is_owner_of_practice(practice_id)
      OR public.is_active_practice_member(practice_id, auth.uid())
    )
  );

-- Idempotent auto-issue of a given check-in-count / one-shot restaurant reward.
CREATE UNIQUE INDEX IF NOT EXISTS client_rewards_auto_reward_id_uniq
  ON public.client_rewards (client_id, reward_id)
  WHERE source = 'auto' AND milestone IS NULL;
