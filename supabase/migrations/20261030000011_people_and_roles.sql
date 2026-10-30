-- =====================================================================
-- 0011 People & roles (admins)
--   * people_list(): everyone with role, class, last activity and when/who
--     last changed their role (from audit_log) — for the admin tab
--   * staff invites for people who have not signed up yet: an admin enters
--     an email and a role and gets a one-time code. The person creates
--     their account WITH THAT EMAIL and types the code in the "Class code"
--     box; handle_new_user gives them the role. Codes are random, single-use,
--     expire after 14 days and can be revoked. Email alone is never enough
--     (email confirmation is off, so anyone could sign up with any address).
--   Changing an existing account's role stays set_user_role() (admin-only,
--   never your own, audited).
-- =====================================================================

create table public.staff_invites (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  email       text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  role        public.app_role not null check (role in ('instructor', 'admin')),
  created_by  uuid not null references auth.users (id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  used_at     timestamptz,
  used_by     uuid references auth.users (id) on delete set null,
  revoked_at  timestamptz
);
create unique index staff_invites_one_open_per_email on public.staff_invites (email)
  where used_at is null and revoked_at is null;

alter table public.staff_invites enable row level security;
revoke all on public.staff_invites from anon, authenticated;
grant select on public.staff_invites to authenticated;
create policy staff_invites_select on public.staff_invites for select to authenticated using (public.is_admin());

create trigger staff_invites_audit after insert or update or delete on public.staff_invites
  for each row execute function public.audit_row();

create or replace function public._invite_code()
returns text language sql volatile set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, 10)
$$;

create or replace function public.create_staff_invite(p_email text, p_role public.app_role)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_code text; v_row public.staff_invites;
begin
  if not public.is_admin() then raise exception 'only an admin can invite staff' using errcode = '42501'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'enter a valid email address' using errcode = '22023'; end if;
  if p_role not in ('instructor', 'admin') then raise exception 'invites are for instructors or admins' using errcode = '22023'; end if;
  if exists (select 1 from public.profiles where lower(email) = v_email) then
    raise exception 'that email already has an account: change their role in the list instead' using errcode = '23505';
  end if;
  update public.staff_invites set revoked_at = now()
   where email = v_email and used_at is null and revoked_at is null;      -- a new invite replaces an open one
  loop
    v_code := public._invite_code();
    exit when not exists (select 1 from public.staff_invites where code = v_code)
          and not exists (select 1 from public.cohorts where upper(join_code) = v_code);
  end loop;
  perform set_config('app.audit_action', 'invite', true);
  insert into public.staff_invites (code, email, role, created_by) values (v_code, v_email, p_role, auth.uid())
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'email', v_row.email, 'role', v_row.role, 'expires_at', v_row.expires_at);
end $$;

create or replace function public.revoke_staff_invite(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'only an admin can revoke invites' using errcode = '42501'; end if;
  perform set_config('app.audit_action', 'revoke', true);
  update public.staff_invites set revoked_at = now() where id = p_id and used_at is null and revoked_at is null;
  if not found then raise exception 'invite not found or already used' using errcode = 'P0002'; end if;
end $$;

create or replace function public.staff_invite_list()
returns table (id uuid, code text, email text, role public.app_role, created_by_name text, created_at timestamptz,
               expires_at timestamptz, used_at timestamptz, revoked_at timestamptz, state text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin role required' using errcode = '42501'; end if;
  return query
  select i.id, case when i.used_at is null and i.revoked_at is null and i.expires_at > now() then i.code end,
         i.email, i.role, p.display_name, i.created_at, i.expires_at, i.used_at, i.revoked_at,
         case when i.used_at is not null then 'used' when i.revoked_at is not null then 'revoked'
              when i.expires_at <= now() then 'expired' else 'open' end
  from public.staff_invites i left join public.profiles p on p.id = i.created_by
  order by i.created_at desc
  limit 200;
end $$;

-- Everyone, for the People & roles tab (admins only).
create or replace function public.people_list()
returns table (user_id uuid, email text, display_name text, role public.app_role, cohort text, joined timestamptz,
               last_active timestamptz, role_changed_at timestamptz, role_changed_by text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin role required' using errcode = '42501'; end if;
  return query
  select p.id, p.email, p.display_name, p.role, c.name, p.created_at,
         (select max(e.created_at) from public.content_events e where e.user_id = p.id),
         rc.created_at, rp.display_name
  from public.profiles p
  left join public.cohorts c on c.id = p.cohort_id
  left join lateral (select a.created_at, a.actor_id from public.audit_log a
                      where a.table_name = 'profiles' and a.row_id = p.id::text and a.action = 'role_change'
                      order by a.created_at desc limit 1) rc on true
  left join public.profiles rp on rp.id = rc.actor_id
  order by case p.role when 'admin' then 0 when 'instructor' then 1 else 2 end, lower(p.display_name), p.email;
end $$;

-- Sign-up: a staff invite code typed in the "Class code" box (with the invited
-- email) gives that role; otherwise the code is treated as a class code.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_code text := upper(btrim(coalesce(new.raw_user_meta_data ->> 'class_code', ''))); v_inv public.staff_invites;
begin
  if v_code <> '' then
    select * into v_inv from public.staff_invites
     where code = v_code and email = lower(new.email) and used_at is null and revoked_at is null and expires_at > now()
     for update;
  end if;
  insert into public.profiles (id, email, display_name, role, cohort_id)
  values (new.id, new.email,
          left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1)), 80),
          coalesce(v_inv.role, 'student'),
          case when v_inv.id is null then
            (select c.id from public.cohorts c where upper(c.join_code) = v_code) end);
  if v_inv.id is not null then
    perform set_config('app.audit_action', 'invite_used', true);
    update public.staff_invites set used_at = now(), used_by = new.id where id = v_inv.id;
  end if;
  return new;
end $$;

revoke execute on function public._invite_code() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['create_staff_invite(text, public.app_role)', 'revoke_staff_invite(uuid)', 'staff_invite_list()', 'people_list()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
