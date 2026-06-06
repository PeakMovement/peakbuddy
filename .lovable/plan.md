
## Goal

Roll back the Lovable Cloud enablement (which created an empty new database and rewired the app away from your original Supabase project `vzzpmsmtjlhpsrkbzqlh` where all real data lives), then apply the two pending SQL migrations to the original project so practitioner signup works again.

## Steps

### 1. You revert via History (I can't do this from chat)

Open the History tab at the top of the chat and restore the version **just before** "Enable Cloud for this project." That single revert undoes all of these in one shot:

- `.env` rewrite (back to original project URL + anon key)
- New `src/integrations/supabase/client.ts`, `client.server.ts`, `auth-middleware.ts`, `auth-attacher.ts`, `types.ts`
- `supabase/config.toml` with the new Cloud project id
- `src/start.ts` middleware change
- `package.json` / `bun.lock` additions

Your app code (profile pages, signup flow, etc.) is preserved — only the Cloud wiring rolls back.

<presentation-actions>
  <presentation-open-history>View History</presentation-open-history>
</presentation-actions>

### 2. You apply the two pending migrations to the original Supabase project

In the Supabase dashboard for project `vzzpmsmtjlhpsrkbzqlh` → SQL Editor → paste and run the combined SQL below (contents of `db/practitioner_signup.sql` + `db/add_client_phone.sql`):

```sql
-- practices.is_approved
alter table public.practices
  add column if not exists is_approved boolean not null default false;

update public.practices
  set is_approved = true
  where onboarding_complete = true;

-- platform_settings
create table if not exists public.platform_settings (
  id uuid primary key default gen_random_uuid(),
  new_practitioner_webhook_url text,
  new_practitioner_webhook_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.platform_settings to authenticated;
grant all on public.platform_settings to service_role;

alter table public.platform_settings enable row level security;

drop policy if exists "admins read platform_settings" on public.platform_settings;
create policy "admins read platform_settings"
  on public.platform_settings for select
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "admins write platform_settings" on public.platform_settings;
create policy "admins write platform_settings"
  on public.platform_settings for all
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- clients.phone
alter table public.clients
  add column if not exists phone text;

-- reload PostgREST schema cache
notify pgrst, 'reload schema';
```

### 3. I verify after you confirm

Once you've reverted and run the SQL, ping me and I'll:
- Confirm `.env` points back at `vzzpmsmtjlhpsrkbzqlh`
- Test practitioner signup end-to-end in preview
- Confirm profile pages still load for client + practitioner

## Notes

- This does **not** disable Lovable Cloud on the account, but since the app code will no longer reference the new Cloud DB, it just sits unused. (Per the Cloud docs, Cloud can't be removed from a project once enabled — but reverting the code makes it effectively inert.)
- After we're back on the original project, your post-signup confirmation email is editable in the original Supabase dashboard → Authentication → Email Templates → "Confirm signup".
