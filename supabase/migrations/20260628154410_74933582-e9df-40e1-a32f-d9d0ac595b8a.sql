
CREATE TABLE IF NOT EXISTS public.rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  voucher_code text NOT NULL,
  maps_url text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.rewards TO authenticated;
GRANT ALL ON public.rewards TO service_role;
ALTER TABLE public.rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read active rewards"
ON public.rewards FOR SELECT TO authenticated
USING (active = true);

CREATE TABLE IF NOT EXISTS public.client_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  reward_id uuid NOT NULL REFERENCES public.rewards(id) ON DELETE RESTRICT,
  practitioner_id uuid,
  status text NOT NULL DEFAULT 'earned',
  earned_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_rewards_client_idx ON public.client_rewards(client_id);
CREATE INDEX IF NOT EXISTS client_rewards_reward_idx ON public.client_rewards(reward_id);

GRANT SELECT ON public.client_rewards TO authenticated;
GRANT ALL ON public.client_rewards TO service_role;
ALTER TABLE public.client_rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients see their own issued rewards"
ON public.client_rewards FOR SELECT TO authenticated
USING (
  client_id IN (SELECT id FROM public.clients WHERE auth_user_id = auth.uid())
  OR practitioner_id = auth.uid()
);

CREATE OR REPLACE FUNCTION public.rewards_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS rewards_updated_at ON public.rewards;
CREATE TRIGGER rewards_updated_at BEFORE UPDATE ON public.rewards
FOR EACH ROW EXECUTE FUNCTION public.rewards_set_updated_at();
