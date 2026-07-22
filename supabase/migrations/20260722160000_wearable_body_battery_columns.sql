-- Garmin daily summaries report Body Battery as "charged" and "drained" totals for
-- the day, which is not the same thing as the existing body_battery_min/max range
-- columns. Store them accurately in their own columns rather than mislabelling them.
ALTER TABLE public.wearable_sessions
  ADD COLUMN IF NOT EXISTS body_battery_charged int,
  ADD COLUMN IF NOT EXISTS body_battery_drained int;
