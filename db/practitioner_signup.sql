-- Apply manually via Lovable Cloud → Database → SQL editor
-- Adds approval gate + platform_settings for the practitioner self-signup flow.

alter table public.practices
  add column if not exists is_approved boolean default false;

-- Existing onboarded practitioners stay live.
update public.practices set is_approved = true where onboarding_complete = true and is_approved is distinct from true;

create table if not exists public.platform_settings (
  id uuid primary key default gen_random_uuid(),
  new_practitioner_webhook_url text default '',
  new_practitioner_webhook_enabled boolean default false,
  created_at timestamptz default now()
);

alter table public.platform_settings enable row level security;

drop policy if exists "Super admin read platform_settings" on public.platform_settings;
create policy "Super admin read platform_settings"
  on public.platform_settings for select
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'));

drop policy if exists "Super admin write platform_settings" on public.platform_settings;
create policy "Super admin write platform_settings"
  on public.platform_settings for all
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'));

insert into public.platform_settings (new_practitioner_webhook_url, new_practitioner_webhook_enabled)
select '', false
where not exists (select 1 from public.platform_settings);
