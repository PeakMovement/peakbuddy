-- #4 Auto-reward at streak milestone.
-- Per-practice toggle (default ON per product decision to enable for all; any
-- practice can turn it off). Milestone tracking on client_rewards so each
-- milestone is auto-issued at most once per client.
ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS auto_reward_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.client_rewards
  ADD COLUMN IF NOT EXISTS milestone integer;
ALTER TABLE public.client_rewards
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

-- Prevent duplicate auto-issues for the same milestone (also guards races).
CREATE UNIQUE INDEX IF NOT EXISTS client_rewards_client_milestone_uniq
  ON public.client_rewards (client_id, milestone)
  WHERE milestone IS NOT NULL;

COMMENT ON COLUMN public.practices.auto_reward_enabled IS
  'When true, hitting a check-in streak milestone auto-issues an active reward to the client. Default on; per-practice.';
COMMENT ON COLUMN public.client_rewards.milestone IS
  'Streak milestone that triggered an auto-issued reward (NULL for manually approved rewards).';
COMMENT ON COLUMN public.client_rewards.source IS
  'How the reward was issued: manual (practitioner) or auto (streak milestone).';
