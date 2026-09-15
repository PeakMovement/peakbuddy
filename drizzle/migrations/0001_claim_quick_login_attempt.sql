create or replace function public.claim_quick_login_attempt(p_user_id uuid)
returns table (allowed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.quick_login_codes%rowtype;
begin
  select * into v_row from public.quick_login_codes where user_id = p_user_id for update;
  if not found then
    return query select false;
    return;
  end if;

  -- Auto-clear a lockout after 15 minutes.
  if v_row.locked_at is not null and v_row.locked_at < now() - interval '15 minutes' then
    update public.quick_login_codes
      set locked_at = null, failed_attempts = 0, last_failed_at = null
      where user_id = p_user_id;
    v_row.locked_at := null;
    v_row.failed_attempts := 0;
  end if;

  if v_row.locked_at is not null then
    return query select false;
    return;
  end if;

  update public.quick_login_codes
    set failed_attempts = v_row.failed_attempts + 1,
        last_failed_at = now(),
        locked_at = case when v_row.failed_attempts + 1 >= 5 then now() else null end
    where user_id = p_user_id;

  return query select true;
end;
$$;

revoke all on function public.claim_quick_login_attempt(uuid) from public, anon, authenticated;
grant execute on function public.claim_quick_login_attempt(uuid) to service_role;