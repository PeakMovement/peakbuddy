-- Pre-launch RLS hardening.

-- (1) Voucher codes must not be readable by every authenticated user. Clients
-- only ever see their OWN issued vouchers via service-role server functions,
-- so restrict direct SELECT on the reward catalog to super admins.
DROP POLICY IF EXISTS "rewards read all" ON public.rewards;
CREATE POLICY "rewards super admin read" ON public.rewards
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- (2) Practitioners must not be able to self-approve. Only a super admin or the
-- service role may change practices.is_approved.
CREATE OR REPLACE FUNCTION public.prevent_practice_self_approval()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_approved IS DISTINCT FROM OLD.is_approved
     AND coalesce(auth.role(), '') <> 'service_role'
     AND NOT coalesce(public.is_super_admin(auth.uid()), false) THEN
    RAISE EXCEPTION 'Not authorized to change approval status';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS practices_prevent_self_approval ON public.practices;
CREATE TRIGGER practices_prevent_self_approval
  BEFORE UPDATE ON public.practices
  FOR EACH ROW EXECUTE FUNCTION public.prevent_practice_self_approval();
