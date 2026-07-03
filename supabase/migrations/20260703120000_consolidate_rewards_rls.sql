-- Consolidate rewards RLS: two migrations (the original rewards_engine + a later
-- Lovable one) left overlapping/duplicate policies on rewards and client_rewards.
-- Collapse to one clear, consistent set. Writes still happen via service role in
-- app code; these policies are defense-in-depth.

DROP POLICY IF EXISTS "rewards read" ON public.rewards;
DROP POLICY IF EXISTS "Authenticated can read active rewards" ON public.rewards;
DROP POLICY IF EXISTS "rewards super admin write" ON public.rewards;
DROP POLICY IF EXISTS "rewards read all" ON public.rewards;
DROP POLICY IF EXISTS "rewards admin write" ON public.rewards;
CREATE POLICY "rewards read all" ON public.rewards
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "rewards admin write" ON public.rewards
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "client_rewards access" ON public.client_rewards;
DROP POLICY IF EXISTS "Clients see their own issued rewards" ON public.client_rewards;
CREATE POLICY "client_rewards access" ON public.client_rewards
  FOR ALL TO authenticated
  USING (
    practitioner_id = auth.uid()
    OR public.is_super_admin(auth.uid())
    OR client_id IN (SELECT id FROM public.clients WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    practitioner_id = auth.uid()
    OR public.is_super_admin(auth.uid())
  );
