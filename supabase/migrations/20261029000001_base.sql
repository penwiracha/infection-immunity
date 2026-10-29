-- =====================================================================
-- 0001 base — roles, profiles, controlled vocabularies, event dictionary,
-- content events and the immutable audit log.
--
-- Security model
--   * Roles live in public.profiles.role. They are NEVER read from
--     user_metadata (which the user can edit). Authenticated users have no
--     UPDATE privilege on the role column; only public.set_user_role(),
--     which checks is_admin(), can change it.
--   * RLS helpers (is_instructor / is_admin) are SECURITY DEFINER with an
--     empty search_path, so policies can call them without recursion.
--   * Every write that matters goes through SECURITY DEFINER functions;
--     authenticated users get SELECT (filtered by RLS) and nothing else.
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------
-- Roles and profiles
-- ---------------------------------------------------------------------
create type public.app_role as enum ('student', 'instructor', 'admin');

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  display_name  text not null default '',
  role          public.app_role not null default 'student',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Helpers used by every RLS policy.
create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$ select p.role from public.profiles p where p.id = auth.uid() $$;

create or replace function public.is_instructor()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_app_role() in ('instructor', 'admin'), false) $$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_app_role() = 'admin', false) $$;

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;  -- NOT role

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_instructor());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- New sign-ups always start as students, whatever their metadata says.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (new.id, new.email,
          coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1)),
          'student');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Belt and braces: even a future grant mistake cannot let a non-admin change a role.
create or replace function public.guard_role_change()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  -- API callers run as anon/authenticated; set_user_role() runs as the owner.
  -- (The SQL editor also runs as the owner, which is how the first admin is made.)
  if new.role is distinct from old.role
     and current_user in ('anon', 'authenticated') then
    raise exception 'roles can only be changed by an admin through set_user_role()'
      using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_role_change();

-- ---------------------------------------------------------------------
-- Audit log — who, what, when, old and new values. Append-only.
-- ---------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  action      text not null,                  -- create | edit | submit | approve | return | publish | unpublish | retire | role_change | ...
  table_name  text not null,
  row_id      text,
  old_values  jsonb,
  new_values  jsonb,
  created_at  timestamptz not null default now()
);
create index audit_log_row_idx on public.audit_log (table_name, row_id, created_at desc);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
create policy audit_log_select on public.audit_log for select to authenticated
  using (public.is_instructor());

create or replace function public.audit_log_immutable()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end $$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_immutable();

-- Generic row trigger. The RPC that caused the change names the action with
--   perform set_config('app.audit_action', 'approve', true);
-- otherwise INSERT -> create, UPDATE -> edit, DELETE -> delete.
create or replace function public.audit_row()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_action text := nullif(current_setting('app.audit_action', true), '');
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_id  text  := coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'version_id', v_old ->> 'version_id');
begin
  if tg_op = 'UPDATE' and v_old = v_new then
    return new;                                   -- no-op update, nothing to record
  end if;
  insert into public.audit_log (actor_id, action, table_name, row_id, old_values, new_values)
  values (auth.uid(),
          coalesce(v_action, case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'edit' else 'delete' end),
          tg_table_name, v_id, v_old, v_new);
  return coalesce(new, old);
end $$;

create trigger profiles_audit after update on public.profiles
  for each row execute function public.audit_row();

-- Admin-only role assignment.
create or replace function public.set_user_role(p_user uuid, p_role public.app_role)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can grant roles' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'admins cannot change their own role' using errcode = '42501';
  end if;
  perform set_config('app.audit_action', 'role_change', true);
  update public.profiles set role = p_role where id = p_user;
  if not found then
    raise exception 'no such user' using errcode = 'P0002';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Controlled vocabularies (tags for lectures and questions)
-- ---------------------------------------------------------------------
create table public.vocab (
  kind    text not null check (kind in ('niche', 'topic', 'organism', 'disease', 'failure_mode',
                                        'tier', 'bloom', 'difficulty', 'cascade_step')),
  id      text not null,
  label   text not null,
  sort    int  not null default 0,
  active  boolean not null default true,
  primary key (kind, id)
);

alter table public.vocab enable row level security;
revoke all on public.vocab from anon, authenticated;
grant select on public.vocab to authenticated;
create policy vocab_select on public.vocab for select to authenticated using (true);

create trigger vocab_audit after insert or update or delete on public.vocab
  for each row execute function public.audit_row();

-- Returns the ids in p_ids that are not active terms of p_kind.
create or replace function public.vocab_missing(p_kind text, p_ids text[])
returns text[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(x), '{}')
  from unnest(coalesce(p_ids, '{}')) as x
  where not exists (select 1 from public.vocab v where v.kind = p_kind and v.id = x and v.active)
$$;

create or replace function public.upsert_vocab(p_kind text, p_id text, p_label text, p_active boolean default true)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can edit vocabularies' using errcode = '42501';
  end if;
  if coalesce(btrim(p_id), '') = '' or coalesce(btrim(p_label), '') = '' then
    raise exception 'id and label are required' using errcode = '22023';
  end if;
  insert into public.vocab (kind, id, label, active) values (p_kind, btrim(p_id), btrim(p_label), p_active)
  on conflict (kind, id) do update set label = excluded.label, active = excluded.active;
end $$;

-- ---------------------------------------------------------------------
-- Content-event dictionary + events (lecture views, answers, publishing)
-- ---------------------------------------------------------------------
create table public.event_types (
  id           text primary key,
  actor        text not null check (actor in ('student', 'instructor', 'system')),
  description  text not null
);

insert into public.event_types (id, actor, description) values
  ('lecture_viewed',      'student',    'A student opened a published lecture'),
  ('question_answered',   'student',    'A student answered a live practice question'),
  ('lecture_published',   'instructor', 'A lecture was published to the Learn tab'),
  ('lecture_unpublished', 'instructor', 'A lecture was withdrawn from the Learn tab'),
  ('question_submitted',  'instructor', 'A question version was submitted for review'),
  ('question_approved',   'instructor', 'A reviewer approved a question version'),
  ('question_returned',   'instructor', 'A reviewer returned a question version with a comment'),
  ('question_live',       'instructor', 'A question version went live'),
  ('question_retired',    'instructor', 'A question was retired from student pools');

alter table public.event_types enable row level security;
revoke all on public.event_types from anon, authenticated;
grant select on public.event_types to authenticated;
create policy event_types_select on public.event_types for select to authenticated using (true);

create table public.content_events (
  id                   bigint generated always as identity primary key,
  user_id              uuid references auth.users (id) on delete set null,
  event_type           text not null references public.event_types (id),
  lecture_id           uuid,          -- FK added in 0002
  question_id          uuid,
  question_version_id  uuid,
  payload              jsonb not null default '{}',
  created_at           timestamptz not null default now()
);
create index content_events_lecture_idx on public.content_events (lecture_id, event_type);
create index content_events_user_idx on public.content_events (user_id, created_at desc);

alter table public.content_events enable row level security;
revoke all on public.content_events from anon, authenticated;
grant select on public.content_events to authenticated;
create policy content_events_select on public.content_events for select to authenticated
  using (user_id = auth.uid() or public.is_instructor());

-- Internal: record an event (called from other SECURITY DEFINER functions).
create or replace function public._emit(p_type text, p_lecture uuid default null,
                                        p_question uuid default null, p_version uuid default null,
                                        p_payload jsonb default '{}')
returns void
language sql security definer set search_path = ''
as $$
  insert into public.content_events (user_id, event_type, lecture_id, question_id, question_version_id, payload)
  values (auth.uid(), p_type, p_lecture, p_question, p_version, coalesce(p_payload, '{}'))
$$;

-- Internal helpers are not callable over the API.
revoke execute on function public._emit(text, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.audit_row() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_user_role(uuid, public.app_role) from public, anon;
revoke execute on function public.upsert_vocab(text, text, text, boolean) from public, anon;
