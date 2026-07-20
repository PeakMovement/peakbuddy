-- Detection engine: configurable thresholds, calibration suggestions, escalation
-- settings, and persisted per-client insight snapshots. All admin/service side —
-- no client-facing behaviour changes (escalation defaults OFF).

alter table public.platform_settings
  add column if not exists detection_thresholds jsonb,
  add column if not exists threshold_suggestions jsonb,
  add column if not exists threshold_calibrated_at timestamptz,
  add column if not exists auto_calibrate_enabled boolean not null default false,
  add column if not exists escalation_enabled boolean not null default false,
  add column if not exists escalation_after_minutes integer not null default 120,
  add column if not exists escalation_min_urgency text not null default 'urgent';

alter table public.alerts
  add column if not exists escalation_fired boolean not null default false;

create table if not exists public.client_insight_snapshots (
  id uuid not null default gen_random_uuid() primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  snapshot_date date not null,
  load jsonb,
  correlation jsonb,
  rhythms jsonb,
  created_at timestamptz not null default now(),
  unique (client_id, snapshot_date)
);
create index if not exists client_insight_snapshots_client_date_idx
  on public.client_insight_snapshots (client_id, snapshot_date desc);

grant select on public.client_insight_snapshots to authenticated;
grant all on public.client_insight_snapshots to service_role;
alter table public.client_insight_snapshots enable row level security;

drop policy if exists "insight snapshots super admin read" on public.client_insight_snapshots;
create policy "insight snapshots super admin read"
  on public.client_insight_snapshots for select to authenticated
  using (public.is_super_admin(auth.uid()));
