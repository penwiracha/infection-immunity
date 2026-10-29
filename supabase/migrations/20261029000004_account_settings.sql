-- =====================================================================
-- 0004 account settings
--   * keep profiles.email in step when someone changes their sign-in email
--   * a sensible length limit on display names (users edit their own)
-- =====================================================================

create or replace function public.sync_profile_email()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.sync_profile_email();

revoke execute on function public.sync_profile_email() from public, anon, authenticated;

alter table public.profiles
  add constraint profiles_display_name_len check (length(display_name) <= 80);
