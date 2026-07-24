-- Pre-launch cleanup: remove all demo/test reward vouchers and the reward
-- catalog so no client carries a leftover demo gift. Idempotent.
delete from public.client_rewards;
delete from public.rewards;
