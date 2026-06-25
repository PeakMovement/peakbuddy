-- Rewards engine (Stage 1): the reward pool + issued-reward records.
-- Super admin loads rewards; practitioners approve issuance (Stage 2);
-- clients view earned vouchers (Stage 3).

CREATE TABLE IF NOT EXISTS public.rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  voucher_code text NOT NULL,
  maps_url text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rewards TO authenticated;
GRANT ALL ON public.rewards TO service_role;
ALTER TABLE public.rewards ENABLE ROW LEVEL SECURITY;
-- Any authenticated user can read rewards (needed to render earned voucher detail).
CREATE POLICY "rewards read" ON public.rewards FOR SELECT TO authenticated USING (true);
-- Only super admins can create/update/delete rewards.
CREATE POLICY "rewards super admin write" ON public.rewards FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.client_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  reward_id uuid NOT NULL REFERENCES public.rewards(id) ON DELETE RESTRICT,
  practitioner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'earned' CHECK (status IN ('earned','redeemed')),
  earned_at timestamptz NOT NULL DEFAULT now(),
  redeemed_at timestamptz
);
CREATE INDEX IF NOT EXISTS client_rewards_client_idx ON public.client_rewards (client_id, earned_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_rewards TO authenticated;
GRANT ALL ON public.client_rewards TO service_role;
ALTER TABLE public.client_rewards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client_rewards access" ON public.client_rewards FOR ALL TO authenticated
  USING (
    practitioner_id = auth.uid()
    OR public.is_super_admin(auth.uid())
    OR client_id = public.current_client_id()
  )
  WITH CHECK (
    practitioner_id = auth.uid()
    OR public.is_super_admin(auth.uid())
  );
