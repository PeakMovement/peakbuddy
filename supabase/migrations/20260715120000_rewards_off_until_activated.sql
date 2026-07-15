-- Rewards must be explicitly activated by an admin before they surface to
-- practitioners and clients. Default the flag to false and deactivate any
-- existing rows so the activate flow starts from a clean, hidden state.
alter table public.platform_settings alter column rewards_enabled set default false;
update public.platform_settings set rewards_enabled = false;
