-- =====================================================================
-- 0014 Course coordinators and lecturers
--   Lecturers
--     * see and change only their own lectures and questions (any state).
--       Published, unhidden lectures and practice questions stay readable
--       to every signed-in user, as they are for students; the instructor
--       dashboard lists only the lecturer's own.
--     * see student data (Overview, Students, Items, Export, exam results)
--       only for the cohorts a coordinator assigned them to.
--     * see student reports on their own questions.
--   Course coordinators (and admins)
--     * see, edit, publish, hide and retire every lecturer's content;
--     * put pre-test and monthly items live and move items between pools;
--     * build, open, close and delete exams and monthly schedules;
--     * create cohorts, change class codes, assign students, and assign
--       lecturers to cohorts;
--     * switch people between student and lecturer and invite lecturers.
--   Admins keep everything else: any role change, coordinator and admin
--   invites, deleting what students have used, students' own flashcards,
--   tag lists.
-- =====================================================================

-- ------------------------------------------------------------ role helpers
-- is_instructor() keeps its name (every policy uses it) and now means "any staff".
create or replace function public.is_instructor()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_app_role() in ('lecturer', 'coordinator', 'admin'), false) $$;

create or replace function public.is_coordinator()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_app_role() in ('coordinator', 'admin'), false) $$;

create or replace function public._require_coordinator()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_coordinator() then
    raise exception 'course coordinator role required' using errcode = '42501';
  end if;
end $$;

alter table public.staff_invites drop constraint staff_invites_role_check;
alter table public.staff_invites add constraint staff_invites_role_check check (role in ('lecturer', 'coordinator', 'admin'));

-- ------------------------------------------------------------ lecturers ↔ cohorts
create table public.cohort_staff (
  id         uuid primary key default gen_random_uuid(),
  cohort_id  uuid not null references public.cohorts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  added_by   uuid references auth.users (id),
  added_at   timestamptz not null default now(),
  unique (cohort_id, user_id)
);
create index cohort_staff_user_idx on public.cohort_staff (user_id);
alter table public.cohort_staff enable row level security;
revoke all on public.cohort_staff from anon, authenticated;
grant select on public.cohort_staff to authenticated;
create policy cohort_staff_select on public.cohort_staff for select to authenticated
  using (user_id = auth.uid() or public.is_coordinator());
create trigger cohort_staff_audit after insert or update or delete on public.cohort_staff
  for each row execute function public.audit_row();

-- A cohort the person may see student data for (coordinators: all).
create or replace function public._can_see_cohort(p_cohort uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_coordinator()
      or (public.is_instructor()
          and exists (select 1 from public.cohort_staff s where s.cohort_id = p_cohort and s.user_id = auth.uid()))
$$;

-- A person whose activity the caller may see: themselves, anyone (coordinators),
-- or a student in one of the lecturer's cohorts.
create or replace function public._can_see_student(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_user = auth.uid()
      or public.is_coordinator()
      or (public.is_instructor()
          and exists (select 1 from public.profiles p join public.cohort_staff s on s.cohort_id = p.cohort_id
                       where p.id = p_user and p.role = 'student' and s.user_id = auth.uid()))
$$;

-- Cohort filter for staff reports: in the chosen cohort (null = all) AND visible to the caller.
create or replace function public._staff_sees(p_user uuid, p_cohort uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select public._in_cohort(p_user, p_cohort) and public._can_see_student(p_user) $$;

-- Every version of a question is visible to its owner (questions.author_id)
-- and to coordinators, whoever wrote the individual version.
create or replace function public._can_see_question(p_question uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_coordinator()
      or (public.is_instructor()
          and exists (select 1 from public.questions q where q.id = p_question and q.author_id = auth.uid()))
$$;

-- Kept for anything that still calls it; no longer used by policies.
create or replace function public.can_see_version(p_status text, p_author uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.is_instructor() and (public.is_coordinator() or p_author = auth.uid()) $$;

-- ------------------------------------------------------------ policies
drop policy lectures_select on public.lectures;
create policy lectures_select on public.lectures for select to authenticated
  using ((status = 'published' and hidden_at is null)
         or (public.is_instructor() and (author_id = auth.uid() or public.is_coordinator())));

drop policy question_versions_select on public.question_versions;
create policy question_versions_select on public.question_versions for select to authenticated
  using (public._can_see_question(question_id)
         or (status = 'live' and public._question_is_practice_live(question_id)));

drop policy question_keys_select on public.question_keys;
create policy question_keys_select on public.question_keys for select to authenticated
  using (public.is_instructor()
         and exists (select 1 from public.question_versions v
                      where v.id = question_keys.version_id and public._can_see_question(v.question_id)));

drop policy question_reviews_select on public.question_reviews;
create policy question_reviews_select on public.question_reviews for select to authenticated
  using (public.is_instructor()
         and exists (select 1 from public.question_versions v
                      where v.id = question_reviews.version_id and public._can_see_question(v.question_id)));

drop policy question_reports_select on public.question_reports;
create policy question_reports_select on public.question_reports for select to authenticated
  using (user_id = auth.uid() or (public.is_instructor() and public._can_see_question(question_id)));

drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public._can_see_student(id));

drop policy answers_select on public.answers;
create policy answers_select on public.answers for select to authenticated
  using (user_id = auth.uid() or (public.is_instructor() and public._can_see_student(user_id)));

drop policy card_reviews_select on public.card_reviews;
create policy card_reviews_select on public.card_reviews for select to authenticated
  using (user_id = auth.uid() or (public.is_instructor() and public._can_see_student(user_id)));

drop policy consents_select on public.consents;
create policy consents_select on public.consents for select to authenticated
  using (user_id = auth.uid() or (public.is_instructor() and public._can_see_student(user_id)));

drop policy content_events_select on public.content_events;
create policy content_events_select on public.content_events for select to authenticated
  using (user_id = auth.uid() or (public.is_instructor() and public._can_see_student(user_id)));

drop policy exam_attempts_select on public.exam_attempts;
create policy exam_attempts_select on public.exam_attempts for select to authenticated
  using (user_id = auth.uid() or (public.is_instructor() and public._can_see_student(user_id)));

drop policy exams_select on public.exams;
create policy exams_select on public.exams for select to authenticated
  using ((public.is_instructor() and (cohort_id is null or public._can_see_cohort(cohort_id)))
         or (status <> 'draft' and (cohort_id is null or cohort_id = public._my_cohort())));

drop policy exam_items_select on public.exam_items;
create policy exam_items_select on public.exam_items for select to authenticated
  using (public.is_instructor()
         and exists (select 1 from public.exams e
                      where e.id = exam_items.exam_id and (e.cohort_id is null or public._can_see_cohort(e.cohort_id))));

drop policy exam_responses_select on public.exam_responses;
create policy exam_responses_select on public.exam_responses for select to authenticated
  using (public.is_instructor()
         and exists (select 1 from public.exam_attempts a
                      where a.id = exam_responses.attempt_id and public._can_see_student(a.user_id)));

drop policy exam_schedules_select on public.exam_schedules;
create policy exam_schedules_select on public.exam_schedules for select to authenticated
  using (public.is_instructor() and public._can_see_cohort(cohort_id));

-- cohorts_select stays open: cohort names are not sensitive (class codes are column-protected),
-- and the dashboard's cohort pickers use cohort_list(), which is scoped.

drop policy audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using ((public.is_coordinator() and (table_name <> 'student_cards' or public.is_admin()))
         or (public.is_instructor() and actor_id = auth.uid() and table_name <> 'student_cards'));

drop policy ai_generations_select on public.ai_generations;
create policy ai_generations_select on public.ai_generations for select to authenticated
  using (public.is_instructor() and (user_id = auth.uid() or public.is_coordinator()));

drop policy staff_invites_select on public.staff_invites;
create policy staff_invites_select on public.staff_invites for select to authenticated
  using (public.is_admin() or (public.is_coordinator() and role = 'lecturer'));

-- ------------------------------------------------------------ people, roles and invites
create or replace function public.set_user_role(p_user uuid, p_role public.app_role)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_old public.app_role;
begin
  if auth.uid() is null or not public.is_coordinator() then
    raise exception 'only an admin or a course coordinator can change roles' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'nobody can change their own role' using errcode = '42501';
  end if;
  select role into v_old from public.profiles where id = p_user;
  if not found then
    raise exception 'no such user' using errcode = 'P0002';
  end if;
  if not public.is_admin() and (v_old not in ('student', 'lecturer') or p_role not in ('student', 'lecturer')) then
    raise exception 'course coordinators can only switch people between student and lecturer' using errcode = '42501';
  end if;
  perform set_config('app.audit_action', 'role_change', true);
  update public.profiles set role = p_role where id = p_user;
  if p_role <> 'lecturer' then
    perform set_config('app.audit_action', 'unassign', true);
    delete from public.cohort_staff where user_id = p_user;
  end if;
end $$;

create or replace function public.people_list()
returns table (user_id uuid, email text, display_name text, role public.app_role, cohort text, joined timestamptz,
               last_active timestamptz, role_changed_at timestamptz, role_changed_by text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._require_coordinator();
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
  order by case p.role when 'admin' then 0 when 'coordinator' then 1 when 'lecturer' then 2 else 3 end,
           lower(p.display_name), p.email;
end $$;

create or replace function public.create_staff_invite(p_email text, p_role public.app_role)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_code text; v_row public.staff_invites;
begin
  if auth.uid() is null or not public.is_coordinator() then
    raise exception 'only an admin or a course coordinator can invite staff' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'enter a valid email address' using errcode = '22023'; end if;
  if p_role not in ('lecturer', 'coordinator', 'admin') then
    raise exception 'invites are for lecturers, course coordinators or admins' using errcode = '22023';
  end if;
  if p_role <> 'lecturer' and not public.is_admin() then
    raise exception 'course coordinators can invite lecturers only' using errcode = '42501';
  end if;
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

-- Coordinators see (and can revoke) lecturer invites only, so they never see a
-- code that would make someone a coordinator or an admin.
create or replace function public.staff_invite_list()
returns table (id uuid, code text, email text, role public.app_role, created_by_name text, created_at timestamptz,
               expires_at timestamptz, used_at timestamptz, revoked_at timestamptz, state text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._require_coordinator();
  return query
  select i.id, case when i.used_at is null and i.revoked_at is null and i.expires_at > now() then i.code end,
         i.email, i.role, p.display_name, i.created_at, i.expires_at, i.used_at, i.revoked_at,
         case when i.used_at is not null then 'used' when i.revoked_at is not null then 'revoked'
              when i.expires_at <= now() then 'expired' else 'open' end
  from public.staff_invites i left join public.profiles p on p.id = i.created_by
  where public.is_admin() or i.role = 'lecturer'
  order by i.created_at desc
  limit 200;
end $$;

create or replace function public.revoke_staff_invite(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public._require_coordinator();
  perform set_config('app.audit_action', 'revoke', true);
  update public.staff_invites set revoked_at = now()
   where id = p_id and used_at is null and revoked_at is null and (public.is_admin() or role = 'lecturer');
  if not found then raise exception 'invite not found or already used' using errcode = 'P0002'; end if;
end $$;

-- ------------------------------------------------------------ assigning lecturers to cohorts
create or replace function public.set_cohort_lecturers(p_cohort uuid, p_users uuid[])
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_bad int; v_n int;
begin
  perform public._require_coordinator();
  if not exists (select 1 from public.cohorts where id = p_cohort) then
    raise exception 'cohort not found' using errcode = 'P0002';
  end if;
  select count(*) into v_bad from unnest(coalesce(p_users, '{}')) u
   where not exists (select 1 from public.profiles p where p.id = u and p.role = 'lecturer');
  if v_bad > 0 then
    raise exception 'only lecturers can be assigned to a cohort' using errcode = '22023';
  end if;
  perform set_config('app.audit_action', 'unassign', true);
  delete from public.cohort_staff where cohort_id = p_cohort and not (user_id = any (coalesce(p_users, '{}')));
  perform set_config('app.audit_action', 'assign', true);
  insert into public.cohort_staff (cohort_id, user_id, added_by)
  select p_cohort, u, auth.uid() from unnest(coalesce(p_users, '{}')) u
  on conflict (cohort_id, user_id) do nothing;
  select count(*) into v_n from public.cohort_staff where cohort_id = p_cohort;
  return v_n;
end $$;

-- Coordinators: every assignment. Lecturers: their own.
create or replace function public.cohort_staff_list()
returns table (cohort_id uuid, user_id uuid, display_name text, email text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._require_instructor();
  return query
  select s.cohort_id, s.user_id, p.display_name, p.email
  from public.cohort_staff s join public.profiles p on p.id = s.user_id
  where public.is_coordinator() or s.user_id = auth.uid()
  order by lower(p.display_name), p.email;
end $$;

-- ------------------------------------------------------------ rewritten functions
-- save_exam: course coordinators and admins only
CREATE OR REPLACE FUNCTION public.save_exam(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; e public.exams;
begin
  perform public._require_coordinator();
  if coalesce(btrim(p ->> 'title'), '') = '' then raise exception 'title is required' using errcode = '22023'; end if;
  if v_id is null then
    if coalesce(p ->> 'kind', '') not in ('pretest', 'monthly') then raise exception 'kind must be pretest or monthly' using errcode = '22023'; end if;
    perform set_config('app.audit_action', 'create', true);
    insert into public.exams (kind, title, cohort_id, opens_at, closes_at, duration_min, created_by)
    values (p ->> 'kind', btrim(p ->> 'title'), nullif(p ->> 'cohort_id', '')::uuid,
            coalesce(nullif(p ->> 'opens_at', '')::timestamptz, now()), nullif(p ->> 'closes_at', '')::timestamptz,
            coalesce(nullif(p ->> 'duration_min', '')::int, 30), auth.uid())
    returning id into v_id;
    return v_id;
  end if;
  select * into e from public.exams where id = v_id for update;
  if not found then raise exception 'exam not found' using errcode = 'P0002'; end if;
  perform set_config('app.audit_action', 'edit', true);
  update public.exams set
    title = btrim(p ->> 'title'),
    kind = case when e.status = 'draft' and p ? 'kind' then p ->> 'kind' else kind end,
    cohort_id = case when e.status = 'draft' and p ? 'cohort_id' then nullif(p ->> 'cohort_id', '')::uuid else cohort_id end,
    opens_at = coalesce(nullif(p ->> 'opens_at', '')::timestamptz, opens_at),
    closes_at = case when p ? 'closes_at' then nullif(p ->> 'closes_at', '')::timestamptz else closes_at end,
    duration_min = coalesce(nullif(p ->> 'duration_min', '')::int, duration_min),
    updated_at = now()
  where id = v_id;
  return v_id;
end $function$;

-- set_exam_items: course coordinators and admins only
CREATE OR REPLACE FUNCTION public.set_exam_items(p_exam uuid, p_questions uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.exams; v_q uuid; v_pos int := 0; v_ver uuid;
begin
  perform public._require_coordinator();
  select * into e from public.exams where id = p_exam for update;
  if not found then raise exception 'exam not found' using errcode = 'P0002'; end if;
  if e.status <> 'draft' then raise exception 'items can only change while the exam is a draft' using errcode = '55000'; end if;
  perform set_config('app.audit_action', 'edit', true);
  delete from public.exam_items where exam_id = p_exam;
  foreach v_q in array coalesce(p_questions, '{}') loop
    select v.id into v_ver from public.question_versions v join public.questions q on q.id = v.question_id
     where v.question_id = v_q and v.status = 'live' and q.pool = e.kind and q.retired_at is null and q.hidden_at is null;
    if v_ver is null then
      raise exception 'item % is not live in the % pool', left(v_q::text, 8), e.kind using errcode = '22023';
    end if;
    v_pos := v_pos + 1;
    insert into public.exam_items (exam_id, position, question_id, version_id) values (p_exam, v_pos, v_q, v_ver);
  end loop;
  return v_pos;
end $function$;

-- set_exam_status: course coordinators and admins only
CREATE OR REPLACE FUNCTION public.set_exam_status(p_exam uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.exams; v_missing int;
begin
  perform public._require_coordinator();
  if p_status not in ('draft', 'open', 'closed') then raise exception 'bad status' using errcode = '22023'; end if;
  select * into e from public.exams where id = p_exam for update;
  if not found then raise exception 'exam not found' using errcode = 'P0002'; end if;
  if p_status = 'draft' and exists (select 1 from public.exam_attempts where exam_id = p_exam) then
    raise exception 'students have already started this exam; close it instead' using errcode = '55000';
  end if;
  if p_status = 'open' then
    if not exists (select 1 from public.exam_items where exam_id = p_exam) then
      raise exception 'add items before opening the exam' using errcode = '55000';
    end if;
    if e.status = 'draft' then
      -- pin each item to its current live version
      update public.exam_items ei set version_id = v.id
        from public.question_versions v
       where ei.exam_id = p_exam and v.question_id = ei.question_id and v.status = 'live';
      select count(*) into v_missing from public.exam_items ei
       where ei.exam_id = p_exam and not exists (select 1 from public.question_versions v
                                                  where v.id = ei.version_id and v.status = 'live');
      if v_missing > 0 then raise exception '% item(s) are no longer live; update the item list', v_missing using errcode = '55000'; end if;
    end if;
  end if;
  perform set_config('app.audit_action', case p_status when 'open' then 'publish' when 'closed' then 'close' else 'edit' end, true);
  update public.exams set status = p_status, updated_at = now() where id = p_exam;
end $function$;

-- pick_exam_items: course coordinators and admins only
CREATE OR REPLACE FUNCTION public.pick_exam_items(p_exam uuid, p_n integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.exams; v_ids uuid[];
begin
  perform public._require_coordinator();
  select * into e from public.exams where id = p_exam;
  if not found then raise exception 'exam not found' using errcode = 'P0002'; end if;
  select array_agg(qid order by rn, r) into v_ids from (
    select v.question_id as qid, row_number() over (partition by v.niche order by random()) as rn, random() as r
    from public.question_versions v join public.questions q on q.id = v.question_id
    where v.status = 'live' and q.pool = e.kind and q.retired_at is null and q.hidden_at is null
  ) x where x.rn is not null;
  v_ids := v_ids[1:greatest(0, p_n)];
  return public.set_exam_items(p_exam, v_ids);
end $function$;

-- delete_exam: course coordinators and admins only
CREATE OR REPLACE FUNCTION public.delete_exam(p_exam uuid, p_force boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.exams; v_n int;
begin
  perform public._require_coordinator();
  select * into e from public.exams where id = p_exam for update;
  if not found then raise exception 'exam not found' using errcode = 'P0002'; end if;
  select count(*) into v_n from public.exam_attempts where exam_id = p_exam;
  if v_n > 0 and not (p_force and public.is_admin()) then
    raise exception '% student(s) have started this exam. Close it instead, or ask an admin to delete it with their results', v_n
      using errcode = '55000';
  end if;
  if e.schedule_id is not null and e.period is not null then
    insert into public.exam_schedule_skips (schedule_id, period) values (e.schedule_id, e.period) on conflict do nothing;
  end if;
  perform set_config('app.audit_action', 'delete', true);
  delete from public.exams where id = p_exam;   -- items, attempts and responses cascade
end $function$;

-- save_schedule: course coordinators and admins only
CREATE OR REPLACE FUNCTION public.save_schedule(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  perform public._require_coordinator();
  if v_id is null then
    insert into public.exam_schedules (cohort_id, title, day_of_month, n_items, duration_min, open_days, active, created_by)
    values ((p ->> 'cohort_id')::uuid, coalesce(nullif(btrim(p ->> 'title'), ''), 'Monthly check-in'),
            (p ->> 'day_of_month')::int, coalesce((p ->> 'n_items')::int, 20), coalesce((p ->> 'duration_min')::int, 30),
            coalesce((p ->> 'open_days')::int, 7), coalesce((p ->> 'active')::boolean, true), auth.uid())
    returning id into v_id;
  else
    update public.exam_schedules set
      title = coalesce(nullif(btrim(p ->> 'title'), ''), title),
      day_of_month = coalesce((p ->> 'day_of_month')::int, day_of_month),
      n_items = coalesce((p ->> 'n_items')::int, n_items),
      duration_min = coalesce((p ->> 'duration_min')::int, duration_min),
      open_days = coalesce((p ->> 'open_days')::int, open_days),
      active = coalesce((p ->> 'active')::boolean, active)
    where id = v_id;
    if not found then raise exception 'schedule not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
exception when check_violation then
  raise exception 'day must be 1-28, questions 1-200, minutes 5-240 and days open 1-28' using errcode = '22023';
end $function$;

-- save_cohort: course coordinators and admins only
CREATE OR REPLACE FUNCTION public.save_cohort(p_name text, p_starts_on date DEFAULT NULL::date, p_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  perform public._require_coordinator();
  if p_id is null then
    insert into public.cohorts (name, starts_on) values (btrim(p_name), p_starts_on) returning id into v_id;
  else
    update public.cohorts set name = btrim(p_name), starts_on = p_starts_on where id = p_id returning id into v_id;
    if v_id is null then raise exception 'cohort not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'a cohort called % already exists', p_name using errcode = '23505';
end $function$;

-- new_cohort_code: course coordinators and admins only
CREATE OR REPLACE FUNCTION public.new_cohort_code(p_cohort uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v text;
begin
  perform public._require_coordinator();
  perform set_config('app.audit_action', 'code_change', true);
  update public.cohorts set join_code = public._new_code() where id = p_cohort returning join_code into v;
  if v is null then raise exception 'cohort not found' using errcode = 'P0002'; end if;
  return v;
end $function$;

-- set_student_cohort: course coordinators and admins only
CREATE OR REPLACE FUNCTION public.set_student_cohort(p_user uuid, p_cohort uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public._require_coordinator();
  perform set_config('app.audit_action', 'cohort_change', true);
  update public.profiles set cohort_id = p_cohort where id = p_user;
  if not found then raise exception 'no such user' using errcode = 'P0002'; end if;
end $function$;

-- set_question_pool: coordinators may move items between pools
CREATE OR REPLACE FUNCTION public.set_question_pool(p_question uuid, p_pool text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_coordinator() then
    raise exception 'only a course coordinator can change an item''s pool' using errcode = '42501';
  end if;
  if p_pool not in ('practice', 'pretest', 'monthly') then raise exception 'bad pool' using errcode = '22023'; end if;
  perform set_config('app.audit_action', 'pool_change', true);
  update public.questions set pool = p_pool, updated_at = now() where id = p_question;
  if not found then raise exception 'question not found' using errcode = 'P0002'; end if;
end $function$;

-- delete_question: the author or a course coordinator (admins included)
CREATE OR REPLACE FUNCTION public.delete_question(p_question uuid, p_force boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare q public.questions; u jsonb;
begin
  perform public._require_instructor();
  select * into q from public.questions where id = p_question for update;
  if not found then raise exception 'question not found' using errcode = 'P0002'; end if;
  if q.author_id <> auth.uid() and not public.is_coordinator() then
    raise exception 'only the author or a course coordinator can delete this question' using errcode = '42501';
  end if;
  u := public.question_usage(p_question);
  if (u ->> 'exams')::int > 0 then
    raise exception 'this question is part of an exam; delete or edit the exam first' using errcode = '55000';
  end if;
  if ((u ->> 'answers')::int > 0 or (u ->> 'reviews')::int > 0) and not (p_force and public.is_admin()) then
    raise exception 'students have already answered this question (% answers). Retire it instead, or ask an admin to delete it with its answers', u ->> 'answers'
      using errcode = '55000';
  end if;

  perform set_config('app.audit_action', 'delete', true);
  perform set_config('app.deleting', 'yes', true);
  delete from public.answers a using public.question_versions v where v.id = a.version_id and v.question_id = p_question;
  delete from public.card_reviews where question_id = p_question;
  delete from public.srs_state where question_id = p_question;
  delete from public.question_reviews r using public.question_versions v where v.id = r.version_id and v.question_id = p_question;
  delete from public.question_keys k using public.question_versions v where v.id = k.version_id and v.question_id = p_question;
  delete from public.question_versions where question_id = p_question;
  update public.questions set duplicated_from = null where duplicated_from = p_question;
  delete from public.questions where id = p_question;
  perform set_config('app.deleting', '', true);
end $function$;

-- retire_question: the author or a course coordinator (admins included)
CREATE OR REPLACE FUNCTION public.retire_question(p_question uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare q public.questions;
begin
  perform public._require_instructor();
  select * into q from public.questions where id = p_question for update;
  if not found then raise exception 'question not found' using errcode = 'P0002'; end if;
  if q.retired_at is not null then return; end if;
  if q.author_id <> auth.uid() and not public.is_coordinator() then
    raise exception 'only the author or a course coordinator can retire this item' using errcode = '42501';
  end if;
  perform set_config('app.audit_action', 'retire', true);
  update public.questions set retired_at = now(), retired_by = auth.uid(), updated_at = now() where id = p_question;
  update public.question_versions set status = 'retired'
   where question_id = p_question and status in ('draft', 'in_review', 'approved', 'live');
  perform public._emit('question_retired', null, p_question);
end $function$;

-- publish_question_now: the author or a course coordinator (admins included)
CREATE OR REPLACE FUNCTION public.publish_question_now(p_version uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.question_versions; q public.questions;
begin
  perform public._require_instructor();
  select * into v from public.question_versions where id = p_version for update;
  if not found then raise exception 'version not found' using errcode = 'P0002'; end if;
  select * into q from public.questions where id = v.question_id for update;
  if q.retired_at is not null then raise exception 'question is retired' using errcode = '55000'; end if;
  if v.status not in ('draft', 'in_review', 'approved') then
    raise exception 'this version is already %', v.status using errcode = '55000';
  end if;
  if v.author_id <> auth.uid() and q.author_id <> auth.uid() and not public.is_coordinator() then
    raise exception 'only the author or a course coordinator can publish this question' using errcode = '42501';
  end if;
  if q.pool <> 'practice' and not public.is_coordinator() then
    raise exception 'only a course coordinator can put % items live', q.pool using errcode = '42501';
  end if;
  perform set_config('app.audit_action', 'supersede', true);
  update public.question_versions set status = 'superseded' where question_id = v.question_id and status = 'live';
  perform set_config('app.audit_action', 'publish', true);
  update public.question_versions
     set status = 'live', live_at = now(), approved_by = coalesce(approved_by, auth.uid()), approved_at = coalesce(approved_at, now())
   where id = p_version;
  update public.questions set updated_at = now() where id = v.question_id;
  perform public._emit('question_live', null, v.question_id, p_version);
end $function$;

-- save_lecture: the author or a course coordinator (admins included)
CREATE OR REPLACE FUNCTION public.save_lecture(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_row public.lectures;
  v_err text[];
begin
  perform public._require_instructor();
  v_err := public.validate_lecture(p);
  if cardinality(v_err) > 0 then
    raise exception '%', array_to_string(v_err, ' ') using errcode = '22023';
  end if;

  if v_id is null then
    perform set_config('app.audit_action', 'create', true);
    insert into public.lectures (number, title, niche, summary, disease_ids, organism_ids, cascade_step, author_id, updated_by)
    values ((p ->> 'number')::int, btrim(p ->> 'title'), p ->> 'niche', coalesce(p ->> 'summary', ''),
            array(select jsonb_array_elements_text(coalesce(p -> 'disease_ids', '[]'))),
            array(select jsonb_array_elements_text(coalesce(p -> 'organism_ids', '[]'))),
            nullif(p ->> 'cascade_step', ''), auth.uid(), auth.uid())
    returning id into v_id;
    return v_id;
  end if;

  select * into v_row from public.lectures where id = v_id for update;
  if not found then raise exception 'lecture not found' using errcode = 'P0002'; end if;
  if v_row.author_id <> auth.uid() and not public.is_coordinator() then
    raise exception 'only the author or a course coordinator can edit this lecture' using errcode = '42501';
  end if;
  perform set_config('app.audit_action', 'edit', true);
  update public.lectures set
    number = (p ->> 'number')::int, title = btrim(p ->> 'title'), niche = p ->> 'niche',
    summary = coalesce(p ->> 'summary', ''),
    disease_ids  = array(select jsonb_array_elements_text(coalesce(p -> 'disease_ids', '[]'))),
    organism_ids = array(select jsonb_array_elements_text(coalesce(p -> 'organism_ids', '[]'))),
    cascade_step = nullif(p ->> 'cascade_step', ''),
    updated_by = auth.uid(), updated_at = now()
  where id = v_id;
  return v_id;
exception when unique_violation then
  raise exception 'another published lecture already uses number %', p ->> 'number' using errcode = '23505';
end $function$;

-- set_lecture_hidden: the author or a course coordinator (admins included)
CREATE OR REPLACE FUNCTION public.set_lecture_hidden(p_id uuid, p_hidden boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_row public.lectures;
begin
  perform public._require_instructor();
  select * into v_row from public.lectures where id = p_id for update;
  if not found then raise exception 'lecture not found' using errcode = 'P0002'; end if;
  if v_row.author_id <> auth.uid() and not public.is_coordinator() then
    raise exception 'only the author or a course coordinator can hide or show this lecture' using errcode = '42501';
  end if;
  if (v_row.hidden_at is not null) = coalesce(p_hidden, false) then return; end if;
  perform set_config('app.audit_action', case when p_hidden then 'hide' else 'unhide' end, true);
  update public.lectures
     set hidden_at = case when p_hidden then now() end, hidden_by = case when p_hidden then auth.uid() end,
         updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  perform public._emit(case when p_hidden then 'lecture_hidden' else 'lecture_shown' end, p_id);
end $function$;

-- set_lecture_status: the author or a course coordinator (admins included)
CREATE OR REPLACE FUNCTION public.set_lecture_status(p_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_row public.lectures;
begin
  perform public._require_instructor();
  if p_status not in ('draft', 'published') then raise exception 'bad status' using errcode = '22023'; end if;
  select * into v_row from public.lectures where id = p_id for update;
  if not found then raise exception 'lecture not found' using errcode = 'P0002'; end if;
  if v_row.author_id <> auth.uid() and not public.is_coordinator() then
    raise exception 'only the author or a course coordinator can publish or unpublish this lecture' using errcode = '42501';
  end if;
  if v_row.status = p_status then return; end if;
  perform set_config('app.audit_action', case p_status when 'published' then 'publish' else 'unpublish' end, true);
  update public.lectures
     set status = p_status, updated_by = auth.uid(), updated_at = now(),
         published_at = case when p_status = 'published' then now() else published_at end
   where id = p_id;
  perform public._emit(case p_status when 'published' then 'lecture_published' else 'lecture_unpublished' end, p_id);
exception when unique_violation then
  raise exception 'another published lecture already uses number %', v_row.number using errcode = '23505';
end $function$;

-- set_question_hidden: the author or a course coordinator (admins included)
CREATE OR REPLACE FUNCTION public.set_question_hidden(p_question uuid, p_hidden boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare q public.questions; u jsonb;
begin
  perform public._require_instructor();
  select * into q from public.questions where id = p_question for update;
  if not found then raise exception 'question not found' using errcode = 'P0002'; end if;
  if q.author_id <> auth.uid() and not public.is_coordinator() then
    raise exception 'only the author or a course coordinator can hide or show this question' using errcode = '42501';
  end if;
  if (q.hidden_at is not null) = coalesce(p_hidden, false) then return; end if;
  if p_hidden then
    if q.retired_at is not null then
      raise exception 'this question is retired; it is already out of every student pool' using errcode = '55000';
    end if;
    u := public.question_usage(p_question);
    if (u ->> 'answers')::int > 0 or (u ->> 'reviews')::int > 0 then
      raise exception 'students have already used this question (% answers). Retire it instead', u ->> 'answers' using errcode = '55000';
    end if;
    if (u ->> 'exams')::int > 0 then
      raise exception 'this question is part of an exam; remove it from the exam first' using errcode = '55000';
    end if;
  end if;
  perform set_config('app.audit_action', case when p_hidden then 'hide' else 'unhide' end, true);
  update public.questions
     set hidden_at = case when p_hidden then now() end, hidden_by = case when p_hidden then auth.uid() end, updated_at = now()
   where id = p_question;
  perform public._emit(case when p_hidden then 'question_hidden' else 'question_shown' end, null, p_question);
end $function$;

-- save_question: the author or a course coordinator (admins included)
CREATE OR REPLACE FUNCTION public.save_question(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_qid uuid := nullif(p ->> 'question_id', '')::uuid;
  v_q public.questions;
  v_open public.question_versions;
  v_vid uuid;
  v_ver int;
  v_err text[];
  v_pool text := nullif(p ->> 'pool', '');
  v_source text := coalesce(nullif(p ->> 'source', ''), 'manual');
begin
  perform public._require_instructor();
  v_err := public.validate_question(p);
  if cardinality(v_err) > 0 then
    raise exception '%', array_to_string(v_err, ' ') using errcode = '22023';
  end if;
  if v_source not in ('manual', 'import', 'ai', 'duplicate') then
    raise exception 'bad source' using errcode = '22023';
  end if;

  if nullif(p ->> 'lecture_id', '') is not null and not public.is_coordinator()
     and not exists (select 1 from public.lectures l where l.id = (p ->> 'lecture_id')::uuid and l.author_id = auth.uid())
     and not (v_qid is not null and exists (select 1 from public.question_versions v
                                            where v.question_id = v_qid and v.lecture_id = (p ->> 'lecture_id')::uuid)) then
    raise exception 'file the question under one of your own lectures' using errcode = '42501';
  end if;
  -- New item
  if v_qid is null then
    v_pool := coalesce(v_pool, 'practice');
    if v_pool <> 'practice' and not public.is_coordinator() then
      raise exception 'only a course coordinator can place an item in the % pool', v_pool using errcode = '42501';
    end if;
    perform set_config('app.audit_action', 'create', true);
    insert into public.questions (pool, author_id, source, duplicated_from)
    values (v_pool, auth.uid(), v_source, nullif(p ->> 'duplicated_from', '')::uuid)
    returning id into v_qid;
    v_vid := public._new_version(v_qid, 1, p);
    return jsonb_build_object('question_id', v_qid, 'version_id', v_vid, 'version', 1, 'new_version', true);
  end if;

  -- Existing item
  select * into v_q from public.questions where id = v_qid for update;
  if not found then raise exception 'question not found' using errcode = 'P0002'; end if;
  if v_q.retired_at is not null then raise exception 'question is retired' using errcode = '55000'; end if;
  if v_q.author_id <> auth.uid() and not public.is_coordinator() then
    raise exception 'only the author or a course coordinator can edit this question' using errcode = '42501';
  end if;
  if v_pool is not null and v_pool <> v_q.pool and not public.is_coordinator() then
    raise exception 'only a course coordinator can move an item to the % pool', v_pool using errcode = '42501';
  end if;
  if v_q.pool <> 'practice' and not public.is_coordinator() then
    raise exception 'only a course coordinator can edit % items', v_q.pool using errcode = '42501';
  end if;
  if v_pool is not null and v_pool <> v_q.pool then
    perform set_config('app.audit_action', 'edit', true);
    update public.questions set pool = v_pool, updated_at = now() where id = v_qid;
  end if;

  perform set_config('app.audit_action', 'edit', true);
  select * into v_open from public.question_versions
   where question_id = v_qid and status in ('draft', 'in_review', 'approved') for update;

  if found then
    if v_open.author_id <> auth.uid() and not public.is_coordinator() then
      raise exception 'this item has an open version by another author' using errcode = '42501';
    end if;
    if v_open.status <> 'draft' then
      -- editing something under review pulls it back to draft; it must be resubmitted
      update public.question_versions
         set status = 'draft', submitted_at = null, approved_by = null, approved_at = null
       where id = v_open.id;
    end if;
    perform public._write_version_content(v_open.id, p);
    update public.questions set updated_at = now() where id = v_qid;
    return jsonb_build_object('question_id', v_qid, 'version_id', v_open.id, 'version', v_open.version, 'new_version', false);
  end if;

  -- Only live/superseded/retired versions exist: open a new version.
  select coalesce(max(version), 0) + 1 into v_ver from public.question_versions where question_id = v_qid;
  v_vid := public._new_version(v_qid, v_ver, p);
  update public.questions set updated_at = now() where id = v_qid;
  return jsonb_build_object('question_id', v_qid, 'version_id', v_vid, 'version', v_ver, 'new_version', true);
end $function$;

-- import_questions: the author or a course coordinator (admins included)
CREATE OR REPLACE FUNCTION public.import_questions(p_items jsonb, p_source text DEFAULT 'import'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item jsonb;
  v_i int := 0;
  v_out jsonb := '[]';
  v_res jsonb;
  v_lecture uuid;
begin
  perform public._require_instructor();
  if p_source not in ('import', 'ai') then raise exception 'source must be import or ai' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'expected a JSON array' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'import at most 500 items at a time' using errcode = '22023'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_i := v_i + 1;
    begin
      v_item := v_item - 'question_id' - 'status' - 'id';
      if not public.is_coordinator() then v_item := v_item - 'pool'; end if;
      -- allow "lecture_number" as a friendlier alternative to lecture_id
      if coalesce(v_item ->> 'lecture_id', '') = '' and coalesce(v_item ->> 'lecture_number', '') ~ '^\d+$' then
        select id into v_lecture from public.lectures
         where number = (v_item ->> 'lecture_number')::int
           and (author_id = auth.uid() or public.is_coordinator())
         order by (status = 'published') desc, updated_at desc limit 1;
        if v_lecture is not null then v_item := v_item || jsonb_build_object('lecture_id', v_lecture); end if;
      end if;
      v_res := public.save_question(v_item || jsonb_build_object('source', p_source));
      v_out := v_out || jsonb_build_object('index', v_i, 'ok', true, 'question_id', v_res ->> 'question_id');
    exception when others then
      v_out := v_out || jsonb_build_object('index', v_i, 'ok', false, 'errors', sqlerrm);
    end;
  end loop;
  return v_out;
end $function$;

-- lecture_list: lecturers see only their own lectures
CREATE OR REPLACE FUNCTION public.lecture_list()
 RETURNS TABLE(id uuid, number integer, title text, niche text, status text, author_id uuid, author_name text, updated_at timestamp with time zone, published_at timestamp with time zone, viewers integer, questions integer, hidden_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public._require_instructor();
  return query
  select l.id, l.number, l.title, l.niche, l.status, l.author_id, p.display_name, l.updated_at, l.published_at,
         (select count(distinct e.user_id) from public.content_events e
           where e.lecture_id = l.id and e.event_type = 'lecture_viewed')::int,
         (select count(distinct v.question_id) from public.question_versions v
           where v.lecture_id = l.id and v.status = 'live')::int,
         l.hidden_at
  from public.lectures l
  left join public.profiles p on p.id = l.author_id
  where l.author_id = auth.uid() or public.is_coordinator()
  order by l.number, l.updated_at desc;
end $function$;

-- ai_generation_begin: questions are filed under the lecturer's own lectures
CREATE OR REPLACE FUNCTION public.ai_generation_begin(p_lecture uuid, p_n integer, p_source text, p_source_name text DEFAULT NULL::text, p_source_chars integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare l public.lectures; v_id uuid; v_used int;
begin
  perform public._require_instructor();
  if p_source not in ('lecture', 'pdf') then raise exception 'source must be lecture or pdf' using errcode = '22023'; end if;
  if p_n is null or p_n < 1 or p_n > 20 then raise exception 'ask for 1 to 20 questions at a time' using errcode = '22023'; end if;
  select * into l from public.lectures where id = p_lecture;
  if not found or not (l.author_id = auth.uid() or public.is_coordinator()) then
    raise exception 'choose one of your own lectures to file the questions under' using errcode = '22023';
  end if;
  if exists (select 1 from public.ai_generations where user_id = auth.uid() and status = 'running'
              and created_at > now() - interval '3 minutes') then
    raise exception 'a generation is already running; wait for it to finish' using errcode = '55000';
  end if;
  v_used := public._ai_used_today(auth.uid());
  if v_used + p_n > public._ai_daily_limit() then
    raise exception 'daily limit reached: % of % questions used today', v_used, public._ai_daily_limit() using errcode = '54000';
  end if;
  insert into public.ai_generations (user_id, lecture_id, source, source_name, source_chars, n_requested)
  values (auth.uid(), p_lecture, p_source, left(p_source_name, 200), p_source_chars, p_n)
  returning id into v_id;
  return jsonb_build_object(
    'id', v_id,
    'remaining', public._ai_daily_limit() - v_used - p_n,
    'lecture', jsonb_build_object('id', l.id, 'number', l.number, 'title', l.title, 'niche', l.niche,
                                  'summary', l.summary, 'organism_ids', to_jsonb(l.organism_ids),
                                  'disease_ids', to_jsonb(l.disease_ids)),
    'vocab', (select jsonb_object_agg(kind, items) from (
                select kind, jsonb_agg(jsonb_build_object('id', id, 'label', label) order by sort, id) as items
                from public.vocab where active and kind in ('niche', 'topic', 'organism', 'disease', 'tier', 'bloom', 'difficulty', 'failure_mode')
                group by kind) x));
end $function$;

-- ai_generation_list: coordinators see everyone's generations
CREATE OR REPLACE FUNCTION public.ai_generation_list(p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, created_at timestamp with time zone, author_name text, lecture_number integer, lecture_title text, source text, source_name text, n_requested integer, n_saved integer, n_rejected integer, status text, model text, error text, used_today integer, daily_limit integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public._require_instructor();
  return query
  select g.id, g.created_at, p.display_name, l.number, l.title, g.source, g.source_name, g.n_requested, g.n_saved,
         g.n_rejected, g.status, g.model, g.error, public._ai_used_today(auth.uid()), public._ai_daily_limit()
  from public.ai_generations g
  left join public.profiles p on p.id = g.user_id
  left join public.lectures l on l.id = g.lecture_id
  where g.user_id = auth.uid() or public.is_coordinator()
  order by g.created_at desc
  limit greatest(1, least(p_limit, 500));
end $function$;

-- _question_visible: visible = own question (lecturer) or any (coordinator)
CREATE OR REPLACE FUNCTION public._question_visible(p_question uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select exists (select 1 from public.question_versions v
                     where v.question_id = p_question
                       and (public._can_see_question(v.question_id)
                            or (v.status = 'live' and public._question_is_practice_live(p_question)))) $function$;

-- duplicate_question: visible = own question (lecturer) or any (coordinator)
CREATE OR REPLACE FUNCTION public.duplicate_question(p_question uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.question_versions;
  k public.question_keys;
begin
  perform public._require_instructor();
  select * into v from public.question_versions
   where question_id = p_question and public._can_see_question(question_id)
   order by version desc limit 1;
  if not found then raise exception 'question not found' using errcode = 'P0002'; end if;
  select * into k from public.question_keys where version_id = v.id;
  return public.save_question(jsonb_build_object(
    'stem', v.stem, 'options', v.options, 'correct_option_id', k.correct_option_id, 'explanation', k.explanation,
    'niche', v.niche, 'topic', v.topic, 'lecture_id', v.lecture_id,
    'organism_ids', to_jsonb(v.organism_ids), 'disease_ids', to_jsonb(v.disease_ids),
    'tier', v.tier, 'failure_mode', v.failure_mode, 'bloom', v.bloom, 'difficulty', v.difficulty,
    'source', 'duplicate', 'duplicated_from', p_question));
end $function$;

-- export_questions: visible = own question (lecturer) or any (coordinator)
CREATE OR REPLACE FUNCTION public.export_questions()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public._require_instructor();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'question_id', q.id, 'pool', q.pool, 'version', v.version, 'status', v.status,
      'stem', v.stem, 'options', v.options, 'correct_option_id', k.correct_option_id,
      'explanation', k.explanation, 'niche', v.niche, 'topic', v.topic,
      'lecture_number', lec.number, 'lecture_id', v.lecture_id,
      'organism_ids', v.organism_ids, 'disease_ids', v.disease_ids, 'tier', v.tier,
      'failure_mode', v.failure_mode, 'bloom', v.bloom, 'difficulty', v.difficulty,
      'source', q.source, 'retired', q.retired_at is not null) order by lec.number, q.created_at)
    from public.questions q
    join lateral (select * from public.question_versions v2
                   where v2.question_id = q.id and public._can_see_question(v2.question_id)
                   order by v2.version desc limit 1) v on true
    join public.question_keys k on k.version_id = v.id
    left join public.lectures lec on lec.id = v.lecture_id), '[]'::jsonb);
end $function$;

-- question_list: visible = own question (lecturer) or any (coordinator)
CREATE OR REPLACE FUNCTION public.question_list()
 RETURNS TABLE(question_id uuid, pool text, item_author uuid, source text, retired_at timestamp with time zone, version_id uuid, version integer, status text, stem text, niche text, topic text, lecture_id uuid, lecture_number integer, lecture_title text, tier text, difficulty text, bloom text, failure_mode text, organism_ids text[], disease_ids text[], version_author uuid, author_name text, live_version_id uuid, live_version integer, answers integer, pct_correct numeric, updated_at timestamp with time zone, last_return_comment text, hidden_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public._require_instructor();
  return query
  with latest as (
    select distinct on (v.question_id) v.*
    from public.question_versions v
    where public._can_see_question(v.question_id)
    order by v.question_id, v.version desc
  )
  select q.id, q.pool, q.author_id, q.source, q.retired_at,
         l.id, l.version, l.status, l.stem, l.niche, l.topic, l.lecture_id,
         lec.number, lec.title, l.tier, l.difficulty, l.bloom, l.failure_mode,
         l.organism_ids, l.disease_ids, l.author_id, p.display_name,
         lv.id, lv.version,
         coalesce(st.n, 0)::int,
         case when coalesce(st.n, 0) > 0 then round(100.0 * st.c / st.n, 1) end,
         greatest(q.updated_at, l.updated_at),
         (select r.comment from public.question_reviews r where r.version_id = l.id and r.decision = 'returned'
           order by r.created_at desc limit 1),
         q.hidden_at
  from latest l
  join public.questions q on q.id = l.question_id
  left join public.lectures lec on lec.id = l.lecture_id
  left join public.profiles p on p.id = l.author_id
  left join public.question_versions lv on lv.question_id = q.id and lv.status = 'live'
  left join lateral (
    select count(*) as n, count(*) filter (where a.is_correct) as c
    from public.answers a join public.question_versions av on av.id = a.version_id
    where av.question_id = q.id
  ) st on true;
end $function$;

-- similar_stems: visible = own question (lecturer) or any (coordinator)
CREATE OR REPLACE FUNCTION public.similar_stems(p_stem text, p_exclude_question uuid DEFAULT NULL::uuid, p_threshold real DEFAULT 0.55)
 RETURNS TABLE(question_id uuid, version_id uuid, version integer, status text, stem text, score real)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public._require_instructor();
  return query
    select v.question_id, v.id, v.version, v.status, v.stem, extensions.similarity(v.stem, p_stem) as score
    from public.question_versions v
    where (p_exclude_question is null or v.question_id <> p_exclude_question)
      and v.status not in ('superseded')
      and public._can_see_question(v.question_id)
      and extensions.similarity(v.stem, p_stem) >= p_threshold
    order by score desc
    limit 5;
end $function$;

-- item_stats: own questions, students in assigned cohorts
CREATE OR REPLACE FUNCTION public.item_stats(p_cohort uuid DEFAULT NULL::uuid, p_days integer DEFAULT NULL::integer)
 RETURNS TABLE(question_id uuid, version_id uuid, version integer, stem text, topic text, niche text, n integer, pct_correct numeric, discrimination numeric, option_counts jsonb, correct_option_id text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_since timestamptz := case when p_days is null then '-infinity' else now() - make_interval(days => p_days) end;
begin
  perform public._require_instructor();
  if p_cohort is not null and not public._can_see_cohort(p_cohort) then
    raise exception 'that cohort is not assigned to you' using errcode = '42501';
  end if;
  return query
  with first_attempts as (
    select distinct on (a.user_id, a.version_id) a.*
    from public.answers a
    where a.answered_at >= v_since and public._staff_sees(a.user_id, p_cohort)
    order by a.user_id, a.version_id, a.answered_at
  ),
  student_score as (
    select f.user_id, avg(case when f.is_correct then 1.0 else 0.0 end) as score from first_attempts f group by f.user_id
  )
  select v.question_id, v.id, v.version, v.stem, v.topic, v.niche,
         count(fa.id)::int,
         case when count(fa.id) > 0 then round(100.0 * count(fa.id) filter (where fa.is_correct) / count(fa.id), 1) end,
         round(corr(case when fa.is_correct then 1.0 else 0.0 end, ss.score)::numeric, 2),
         coalesce((select jsonb_object_agg(x.chosen_option_id, x.c)
                   from (select f2.chosen_option_id, count(*) c from first_attempts f2
                          where f2.version_id = v.id group by 1) x), '{}'),
         k.correct_option_id
  from public.question_versions v
  join public.question_keys k on k.version_id = v.id
  left join first_attempts fa on fa.version_id = v.id
  left join student_score ss on ss.user_id = fa.user_id
  where v.status in ('live', 'superseded', 'retired') and public._can_see_question(v.question_id)
  group by v.question_id, v.id, v.version, v.stem, v.topic, v.niche, k.correct_option_id;
end $function$;

-- question_report_list: reports on questions the person can see
CREATE OR REPLACE FUNCTION public.question_report_list(p_status text DEFAULT 'open'::text, p_question uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, question_id uuid, version_id uuid, version integer, stem text, lecture_number integer, reason text, comment text, reporter_code text, status text, created_at timestamp with time zone, resolved_at timestamp with time zone, resolved_by_name text, resolution_note text, version_is_live boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public._require_instructor();
  return query
  select r.id, r.question_id, r.version_id, v.version, v.stem, l.number, r.reason, r.comment, public._user_code(r.user_id),
         r.status, r.created_at, r.resolved_at, p.display_name, r.resolution_note, (v.status = 'live')
  from public.question_reports r
  join public.question_versions v on v.id = r.version_id
  left join public.lectures l on l.id = v.lecture_id
  left join public.profiles p on p.id = r.resolved_by
  where (p_status is null or p_status = 'all' or r.status = p_status)
    and public._can_see_question(r.question_id)
    and (p_question is null or r.question_id = p_question)
  order by (r.status = 'open') desc, r.created_at desc
  limit 500;
end $function$;

-- resolve_question_report: only on questions the person can see
CREATE OR REPLACE FUNCTION public.resolve_question_report(p_id uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.question_reports;
begin
  perform public._require_instructor();
  if p_status not in ('fixed', 'dismissed', 'open') then raise exception 'bad status' using errcode = '22023'; end if;
  select * into r from public.question_reports where id = p_id for update;
  if not found or not public._can_see_question(r.question_id) then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  perform set_config('app.audit_action', case p_status when 'open' then 'reopen' else 'resolve' end, true);
  update public.question_reports
     set status = p_status,
         resolved_by = case when p_status = 'open' then null else auth.uid() end,
         resolved_at = case when p_status = 'open' then null else now() end,
         resolution_note = case when p_status = 'open' then null else nullif(btrim(p_note), '') end
   where id = p_id;
  if p_status <> 'open' then
    perform public._emit('report_resolved', null, r.question_id, r.version_id, jsonb_build_object('report_id', p_id, 'status', p_status));
  end if;
end $function$;

-- cohort_overview: students in assigned cohorts
CREATE OR REPLACE FUNCTION public.cohort_overview(p_cohort uuid DEFAULT NULL::uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_since timestamptz := now() - make_interval(days => greatest(7, p_days));
  v_weeks date[];
  v_monthly public.exams;
begin
  perform public._require_instructor();
  if p_cohort is not null and not public._can_see_cohort(p_cohort) then
    raise exception 'that cohort is not assigned to you' using errcode = '42501';
  end if;
  select array_agg(w order by w) into v_weeks from (
    select distinct date_trunc('week', a.answered_at at time zone 'Asia/Bangkok')::date as w
    from public.answers a where a.answered_at >= v_since and public._staff_sees(a.user_id, p_cohort)
    order by 1 desc limit 6) x;
  select * into v_monthly from public.exams e
   where e.kind = 'monthly' and e.status <> 'draft' and e.opens_at <= now()
     and (p_cohort is null or e.cohort_id is null or e.cohort_id = p_cohort)
     and (e.cohort_id is null or public._can_see_cohort(e.cohort_id))
   order by e.opens_at desc limit 1;

  return jsonb_build_object(
    'students', (select count(*) from public.profiles p where p.role = 'student' and public._staff_sees(p.id, p_cohort)),
    'active_week', (select count(distinct e.user_id) from public.content_events e join public.profiles p on p.id = e.user_id
                     where p.role = 'student' and e.created_at >= now() - interval '7 days'
                       and public._staff_sees(p.id, p_cohort)),
    'avg', (select round(100.0 * count(*) filter (where a.is_correct) / nullif(count(*), 0), 0) from public.answers a
             join public.profiles p on p.id = a.user_id
            where p.role = 'student' and a.answered_at >= v_since and public._staff_sees(p.id, p_cohort)),
    'pretest_avg', (select round(avg(a.score), 0) from public.exam_attempts a join public.exams e on e.id = a.exam_id
                     join public.profiles p on p.id = a.user_id
                    where e.kind = 'pretest' and a.submitted_at is not null and public._staff_sees(p.id, p_cohort)),
    'checkin', case when v_monthly.id is null then null else jsonb_build_object(
        'title', v_monthly.title, 'opens_at', v_monthly.opens_at,
        'done', (select count(*) from public.exam_attempts a join public.profiles p on p.id = a.user_id
                  where a.exam_id = v_monthly.id and a.submitted_at is not null and public._staff_sees(p.id, p_cohort))) end,
    'weeks', coalesce((select jsonb_agg(to_char(w, 'YYYY-MM-DD') order by w) from unnest(v_weeks) w), '[]'),
    'topics', coalesce((select jsonb_agg(jsonb_build_object('topic', t.topic, 'pretest', t.pre, 'weeks', t.cells) order by t.topic)
      from (select tp.topic,
              (select round(100.0 * count(*) filter (where r.is_correct) / nullif(count(*), 0), 0)
                 from public.exam_responses r join public.exam_attempts xa on xa.id = r.attempt_id
                 join public.exams ex on ex.id = xa.exam_id and ex.kind = 'pretest'
                 join public.question_versions v on v.id = r.version_id
                where xa.submitted_at is not null and v.topic = tp.topic and public._staff_sees(xa.user_id, p_cohort)) as pre,
              (select jsonb_agg((select round(100.0 * count(*) filter (where a.is_correct) / nullif(count(*), 0), 0)
                                   from public.answers a join public.question_versions v on v.id = a.version_id
                                  where v.topic = tp.topic and public._staff_sees(a.user_id, p_cohort)
                                    and date_trunc('week', a.answered_at at time zone 'Asia/Bangkok')::date = w) order by w)
                 from unnest(coalesce(v_weeks, '{}')) w) as cells
            from (select distinct v.topic from public.answers a join public.question_versions v on v.id = a.version_id
                   where a.answered_at >= v_since and public._staff_sees(a.user_id, p_cohort)
                  union
                  select distinct v.topic from public.exam_responses r join public.question_versions v on v.id = r.version_id
                    join public.exam_attempts xa on xa.id = r.attempt_id
                   where public._staff_sees(xa.user_id, p_cohort)) tp) t), '[]'),
    'monthly_exam_id', v_monthly.id
  );
end $function$;

-- research_export: students in assigned cohorts
CREATE OR REPLACE FUNCTION public.research_export(p_cohort uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public._require_instructor();
  if p_cohort is not null and not public._can_see_cohort(p_cohort) then
    raise exception 'that cohort is not assigned to you' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'consented', (select count(*) from public.consents cs join public.profiles p on p.id = cs.user_id
                   where cs.research and p.role = 'student' and public._staff_sees(p.id, p_cohort)),
    'students', (select count(*) from public.profiles p where p.role = 'student' and public._staff_sees(p.id, p_cohort)),
    'answers', coalesce((select jsonb_agg(jsonb_build_object('student', public._user_code(a.user_id), 'question_id', v.question_id,
              'version', v.version, 'topic', v.topic, 'niche', v.niche, 'correct', a.is_correct, 'confidence', a.confidence,
              'answered_at', a.answered_at) order by a.answered_at)
       from public.answers a join public.question_versions v on v.id = a.version_id
       join public.consents cs on cs.user_id = a.user_id and cs.research
       join public.profiles p on p.id = a.user_id and p.role = 'student'
      where public._staff_sees(p.id, p_cohort)), '[]'),
    'exams', coalesce((select jsonb_agg(jsonb_build_object('student', public._user_code(a.user_id), 'exam_id', a.exam_id,
              'kind', e.kind, 'title', e.title, 'score', a.score, 'n_correct', a.n_correct, 'n_total', a.n_total,
              'submitted_at', a.submitted_at))
       from public.exam_attempts a join public.exams e on e.id = a.exam_id
       join public.consents cs on cs.user_id = a.user_id and cs.research
       join public.profiles p on p.id = a.user_id and p.role = 'student'
      where a.submitted_at is not null and public._staff_sees(p.id, p_cohort)), '[]'));
end $function$;

-- student_summary: lecturers: students in assigned cohorts; coordinators: everyone
CREATE OR REPLACE FUNCTION public.student_summary(p_cohort uuid DEFAULT NULL::uuid, p_days integer DEFAULT NULL::integer)
 RETURNS TABLE(user_id uuid, code text, display_name text, email text, role app_role, cohort_id uuid, cohort text, answers integer, pct_correct numeric, prev_pct numeric, confidently_wrong_pct numeric, active_days integer, lectures_viewed integer, last_active timestamp with time zone, joined timestamp with time zone, research_consent boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_since timestamptz := case when p_days is null then '-infinity' else now() - make_interval(days => p_days) end;
        v_prev timestamptz := case when p_days is null then '-infinity' else now() - make_interval(days => 2 * p_days) end;
begin
  perform public._require_instructor();
  if p_cohort is not null and not public._can_see_cohort(p_cohort) then
    raise exception 'that cohort is not assigned to you' using errcode = '42501';
  end if;
  return query
  select p.id, public._user_code(p.id), p.display_name, p.email, p.role, p.cohort_id, c.name,
         (select count(*) from public.answers a where a.user_id = p.id and a.answered_at >= v_since)::int,
         (select round(100.0 * count(*) filter (where a.is_correct) / nullif(count(*), 0), 1)
            from public.answers a where a.user_id = p.id and a.answered_at >= v_since),
         (select round(100.0 * count(*) filter (where a.is_correct) / nullif(count(*), 0), 1)
            from public.answers a where a.user_id = p.id and a.answered_at >= v_prev and a.answered_at < v_since),
         (select round(100.0 * count(*) filter (where a.confidence = 'sure' and not a.is_correct) / nullif(count(*), 0), 1)
            from public.answers a where a.user_id = p.id and a.answered_at >= v_since),
         (select count(distinct public._day(e.created_at)) from public.content_events e
           where e.user_id = p.id and e.created_at >= v_since)::int,
         (select count(distinct e.lecture_id) from public.content_events e
           where e.user_id = p.id and e.event_type = 'lecture_viewed')::int,
         (select max(e.created_at) from public.content_events e where e.user_id = p.id),
         p.created_at,
         coalesce((select cs.research from public.consents cs where cs.user_id = p.id), false)
  from public.profiles p
  left join public.cohorts c on c.id = p.cohort_id
  where public._staff_sees(p.id, p_cohort)
  order by p.role desc, p.display_name;
end $function$;

-- exam_list: exams for all cohorts or an assigned cohort
CREATE OR REPLACE FUNCTION public.exam_list(p_cohort uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, kind text, title text, cohort_id uuid, cohort text, opens_at timestamp with time zone, closes_at timestamp with time zone, duration_min integer, status text, n_items integer, started integer, submitted integer, avg_score numeric, eligible integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public._require_instructor();
  if p_cohort is not null and not public._can_see_cohort(p_cohort) then
    raise exception 'that cohort is not assigned to you' using errcode = '42501';
  end if;
  return query
  select e.id, e.kind, e.title, e.cohort_id, c.name, e.opens_at, e.closes_at, e.duration_min, e.status,
         (select count(*) from public.exam_items i where i.exam_id = e.id)::int,
         (select count(*) from public.exam_attempts a where a.exam_id = e.id)::int,
         (select count(*) from public.exam_attempts a where a.exam_id = e.id and a.submitted_at is not null)::int,
         (select round(avg(a.score), 1) from public.exam_attempts a where a.exam_id = e.id and a.submitted_at is not null),
         (select count(*) from public.profiles p where p.role = 'student' and (e.cohort_id is null or p.cohort_id = e.cohort_id) and public._can_see_student(p.id))::int
  from public.exams e left join public.cohorts c on c.id = e.cohort_id
  where (p_cohort is null or e.cohort_id is null or e.cohort_id = p_cohort)
    and (e.cohort_id is null or public._can_see_cohort(e.cohort_id))
  order by e.opens_at desc;
end $function$;

-- exam_detail: lecturers: assigned cohorts, their students, stems only of their own items
CREATE OR REPLACE FUNCTION public.exam_detail(p_exam uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_k int; v_kr20 numeric;
begin
  perform public._require_instructor();
  if not exists (select 1 from public.exams where id = p_exam and (cohort_id is null or public._can_see_cohort(cohort_id))) then raise exception 'exam not found' using errcode = 'P0002'; end if;
  select count(*) into v_k from public.exam_items where exam_id = p_exam;
  with sub as (select a.id from public.exam_attempts a where a.exam_id = p_exam and a.submitted_at is not null),
  totals as (select a.n_correct::numeric t from public.exam_attempts a where a.exam_id = p_exam and a.submitted_at is not null),
  pq as (select i.position,
                avg(case when r.is_correct then 1.0 else 0.0 end) p
           from public.exam_items i cross join sub s
           left join public.exam_responses r on r.attempt_id = s.id and r.position = i.position
          where i.exam_id = p_exam group by i.position)
  select case when v_k > 1 and (select count(*) from totals) > 1 and (select var_pop(t) from totals) > 0
              then round((v_k::numeric / (v_k - 1)) * (1 - (select sum(p * (1 - p)) from pq) / (select var_pop(t) from totals)), 2) end
    into v_kr20;
  return jsonb_build_object(
    'exam', (select to_jsonb(e) || jsonb_build_object('cohort', c.name) from public.exams e left join public.cohorts c on c.id = e.cohort_id where e.id = p_exam),
    'kr20', v_kr20,
    'items', coalesce((select jsonb_agg(jsonb_build_object('position', i.position, 'question_id', i.question_id, 'version_id', i.version_id,
              'version', v.version, 'stem', case when public._can_see_question(i.question_id) then v.stem end, 'niche', v.niche, 'topic', v.topic,
              'n', (select count(*) from public.exam_responses r join public.exam_attempts a on a.id = r.attempt_id
                     where a.exam_id = p_exam and a.submitted_at is not null and r.position = i.position),
              'pct', (select round(100.0 * count(*) filter (where r.is_correct) / nullif(count(*), 0), 0)
                       from public.exam_responses r join public.exam_attempts a on a.id = r.attempt_id
                      where a.exam_id = p_exam and a.submitted_at is not null and r.position = i.position)) order by i.position)
       from public.exam_items i join public.question_versions v on v.id = i.version_id where i.exam_id = p_exam), '[]'),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object('attempt_id', a.id, 'code', public._user_code(a.user_id),
              'name', p.display_name, 'started_at', a.started_at, 'submitted_at', a.submitted_at, 'score', a.score) order by a.started_at)
       from public.exam_attempts a join public.profiles p on p.id = a.user_id where a.exam_id = p_exam and public._can_see_student(a.user_id)), '[]'),
    'pool_live', (select count(*) from public.question_versions v join public.questions q on q.id = v.question_id
                   join public.exams e on e.id = p_exam
                  where v.status = 'live' and q.pool = e.kind and q.retired_at is null and q.hidden_at is null)
  );
end $function$;

-- exam_result: staff only for students they can see
CREATE OR REPLACE FUNCTION public.exam_result(p_attempt uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public._require_user();
  if not exists (select 1 from public.exam_attempts where id = p_attempt and submitted_at is not null
                 and (user_id = auth.uid() or (public.is_instructor() and public._can_see_student(user_id)))) then
    raise exception 'result not found' using errcode = 'P0002';
  end if;
  return public._exam_result(p_attempt);
end $function$;

-- cohort_list: lecturers see their assigned cohorts
CREATE OR REPLACE FUNCTION public.cohort_list()
 RETURNS TABLE(id uuid, name text, starts_on date, join_code text, students integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public._require_instructor();
  return query
  select c.id, c.name, c.starts_on, c.join_code,
         (select count(*) from public.profiles p where p.cohort_id = c.id and p.role = 'student')::int
  from public.cohorts c where public._can_see_cohort(c.id) order by c.name desc;
end $function$;

-- schedule_list: lecturers see schedules of their assigned cohorts
CREATE OR REPLACE FUNCTION public.schedule_list()
 RETURNS TABLE(id uuid, cohort_id uuid, cohort text, title text, day_of_month integer, n_items integer, duration_min integer, open_days integer, active boolean, last_period text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public._require_instructor();
  return query
  select s.id, s.cohort_id, c.name, s.title, s.day_of_month, s.n_items, s.duration_min, s.open_days, s.active,
         (select max(e.period) from public.exams e where e.schedule_id = s.id)
  from public.exam_schedules s join public.cohorts c on c.id = s.cohort_id
  where public._can_see_cohort(s.cohort_id)
  order by c.name desc, s.day_of_month;
end $function$;

-- ------------------------------------------------------------ grants
do $$
declare f text;
begin
  foreach f in array array['is_coordinator()', '_require_coordinator()', '_can_see_cohort(uuid)', '_can_see_student(uuid)',
                           '_staff_sees(uuid, uuid)', '_can_see_question(uuid)', 'set_cohort_lecturers(uuid, uuid[])',
                           'cohort_staff_list()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
