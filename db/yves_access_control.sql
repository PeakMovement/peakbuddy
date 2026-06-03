-- Apply manually via Lovable Cloud → Database → SQL editor.
-- Adds three-tier Yves access control:
--   1. Client must have a practitioner (already enforced structurally).
--   2. Practitioners can toggle per-client Yves access.
--   3. Super admins can toggle Yves at the practice level (overrides per-client).

alter table public.practices
  add column if not exists yves_enabled boolean not null default true;

alter table public.clients
  add column if not exists yves_enabled boolean not null default true;

-- Existing UPDATE policies on `practices` (practitioner owns own row) and
-- `clients` (practitioner owns rows they created) already allow updates to
-- these columns. Super admin policies similarly cover both tables.
-- No new policies required.
