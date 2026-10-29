-- =====================================================================
-- 0005 instructor workflow
--   * approving a PRACTICE question puts it live straight away
--     (pre-test / monthly items still need an admin to put them live)
--   * class codes: students join their cohort with a code at sign-up
--     or in Settings; codes are visible to instructors only
--   * monthly check-in schedules that create and open themselves
-- =====================================================================

-- ---------------------------------------------------------------------
-- Approve = live, for practice items
-- ---------------------------------------------------------------------
create or replace function public.review_question(p_version uuid, p_decision text, p_comment text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v public.question_versions; v_pool text;
begin
  perform public._require_instructor();
  if p_decision not in ('approved', 'returned') then raise exception 'decision must be approved or returned' using errcode = '22023'; end if;
  select * into v from public.question_versions where id = p_version for update;
  if not found then raise exception 'version not found' using errcode = 'P0002'; end if;
  if v.status <> 'in_review' then raise exception 'only submitted versions can be reviewed (this one is %)', v.status using errcode = '55000'; end if;
  if v.author_id = auth.uid() then
    raise exception 'you cannot review your own question' using errcode = '42501';
  end if;
  if p_decision = 'returned' and coalesce(btrim(p_comment), '') = '' then
    raise exception 'add a comment explaining what to change' using errcode = '22023';
  end if;

  perform set_config('app.audit_action', case p_decision when 'approved' then 'approve' else 'return' end, true);
  insert into public.question_reviews (version_id, reviewer_id, decision, comment)
  values (p_version, auth.uid(), p_decision, nullif(btrim(p_comment), ''));
  if p_decision = 'returned' then
    update public.question_versions set status = 'draft', submitted_at = null where id = p_version;
    perform public._emit('question_returned', null, v.question_id, p_version, jsonb_build_object('comment', btrim(p_comment)));
    return;
  end if;

  update public.question_versions set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_version;
  perform public._emit('question_approved', null, v.question_id, p_version);

  select pool into v_pool from public.questions where id = v.question_id and retired_at is null;
  if v_pool = 'practice' then
    perform set_config('app.audit_action', 'supersede', true);
    update public.question_versions set status = 'superseded' where question_id = v.question_id and status = 'live';
    perform set_config('app.audit_action', 'publish', true);
    update public.question_versions set status = 'live', live_at = now() where id = p_version;
    update public.questions set updated_at = now() where id = v.question_id;
    perform public._emit('question_live', null, v.question_id, p_version);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Class codes
-- ---------------------------------------------------------------------
-- 6 characters, no look-alikes (0/O, 1/I/L)
create or replace function public._new_code()
returns text language sql volatile set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, 6)
$$;

alter table public.cohorts add column join_code text;
update public.cohorts set join_code = public._new_code() where join_code is null;
alter table public.cohorts alter column join_code set default public._new_code();
alter table public.cohorts alter column join_code set not null;
create unique index cohorts_join_code_uq on public.cohorts (upper(join_code));

-- students may see cohort names but not the codes
revoke select on public.cohorts from authenticated;
grant select (id, name, starts_on, created_at) on public.cohorts to authenticated;

create or replace function public.cohort_list()
returns table (id uuid, name text, starts_on date, join_code text, students int)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._require_instructor();
  return query
  select c.id, c.name, c.starts_on, c.join_code,
         (select count(*) from public.profiles p where p.cohort_id = c.id and p.role = 'student')::int
  from public.cohorts c order by c.name desc;
end $$;

create or replace function public.new_cohort_code(p_cohort uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare v text;
begin
  perform public._require_instructor();
  perform set_config('app.audit_action', 'code_change', true);
  update public.cohorts set join_code = public._new_code() where id = p_cohort returning join_code into v;
  if v is null then raise exception 'cohort not found' using errcode = 'P0002'; end if;
  return v;
end $$;

-- A student joins (or moves to) the cohort whose code they were given.
create or replace function public.join_cohort(p_code text)
returns text language plpgsql security definer set search_path = ''
as $$
declare c public.cohorts;
begin
  perform public._require_user();
  select * into c from public.cohorts where upper(join_code) = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'that class code was not found' using errcode = 'P0002'; end if;
  perform set_config('app.audit_action', 'cohort_join', true);
  update public.profiles set cohort_id = c.id where id = auth.uid();
  return c.name;
end $$;

-- Sign-up: a class code in the sign-up form puts the new student straight into the cohort.
-- (Only the cohort is taken from user-supplied metadata — never the role.)
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, role, cohort_id)
  values (new.id, new.email,
          left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1)), 80),
          'student',
          (select c.id from public.cohorts c
            where upper(c.join_code) = upper(btrim(coalesce(new.raw_user_meta_data ->> 'class_code', '')))));
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Monthly check-in schedules
-- ---------------------------------------------------------------------
create table public.exam_schedules (
  id            uuid primary key default gen_random_uuid(),
  cohort_id     uuid not null references public.cohorts (id) on delete cascade,
  title         text not null default 'Monthly check-in' check (length(btrim(title)) > 0),
  day_of_month  int  not null check (day_of_month between 1 and 28),
  n_items       int  not null default 20 check (n_items between 1 and 200),
  duration_min  int  not null default 30 check (duration_min between 5 and 240),
  open_days     int  not null default 7 check (open_days between 1 and 28),
  active        boolean not null default true,
  created_by    uuid not null references auth.users (id),
  created_at    timestamptz not null default now()
);
alter table public.exams add column schedule_id uuid references public.exam_schedules (id) on delete set null;
alter table public.exams add column period text;                -- 'YYYY-MM' for scheduled exams
create unique index exams_schedule_period_uq on public.exams (schedule_id, period) where schedule_id is not null;

alter table public.exam_schedules enable row level security;
revoke all on public.exam_schedules from anon, authenticated;
grant select on public.exam_schedules to authenticated;
create policy exam_schedules_select on public.exam_schedules for select to authenticated using (public.is_instructor());
create trigger exam_schedules_audit after insert or update or delete on public.exam_schedules
  for each row execute function public.audit_row();

-- p: {id?, cohort_id, title, day_of_month, n_items, duration_min, open_days, active}
create or replace function public.save_schedule(p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  perform public._require_instructor();
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
end $$;

-- Creates and opens this month's check-in for every active schedule whose day has come.
-- Idempotent (one exam per schedule per month). The app calls it whenever someone signs in,
-- so no background job is needed; it can also be run from pg_cron if you prefer.
create or replace function public.run_due_schedules()
returns int language plpgsql security definer set search_path = ''
as $$
declare
  s public.exam_schedules;
  v_today date := public._today();
  v_period text := to_char(public._today(), 'YYYY-MM');
  v_open timestamptz;
  v_exam uuid;
  v_n int;
  v_made int := 0;
begin
  perform public._require_user();
  for s in select * from public.exam_schedules where active loop
    continue when extract(day from v_today) < s.day_of_month;
    continue when exists (select 1 from public.exams e where e.schedule_id = s.id and e.period = v_period);
    v_open := ((date_trunc('month', v_today)::date + (s.day_of_month - 1))::timestamp) at time zone 'Asia/Bangkok';
    continue when now() > v_open + make_interval(days => s.open_days);   -- window already passed
    begin
      perform set_config('app.audit_action', 'scheduled_create', true);
      insert into public.exams (kind, title, cohort_id, opens_at, closes_at, duration_min, status, created_by, schedule_id, period)
      values ('monthly', s.title || ' — ' || to_char(v_today, 'Mon YYYY'), s.cohort_id, v_open,
              v_open + make_interval(days => s.open_days), s.duration_min, 'draft', s.created_by, s.id, v_period)
      returning id into v_exam;
    exception when unique_violation then
      continue;   -- someone else created it a moment ago
    end;
    insert into public.exam_items (exam_id, position, question_id, version_id)
    select v_exam, row_number() over (order by x.rn, x.r), x.qid, x.vid
    from (select v.question_id as qid, v.id as vid,
                 row_number() over (partition by v.niche order by random()) as rn, random() as r
          from public.question_versions v join public.questions q on q.id = v.question_id
          where v.status = 'live' and q.pool = 'monthly' and q.retired_at is null) x
    order by x.rn, x.r
    limit s.n_items;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      perform set_config('app.audit_action', 'publish', true);
      update public.exams set status = 'open' where id = v_exam;   -- empty pool: left as a draft for instructors to see
    end if;
    v_made := v_made + 1;
  end loop;
  return v_made;
end $$;

create or replace function public.schedule_list()
returns table (id uuid, cohort_id uuid, cohort text, title text, day_of_month int, n_items int, duration_min int,
               open_days int, active boolean, last_period text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._require_instructor();
  return query
  select s.id, s.cohort_id, c.name, s.title, s.day_of_month, s.n_items, s.duration_min, s.open_days, s.active,
         (select max(e.period) from public.exams e where e.schedule_id = s.id)
  from public.exam_schedules s join public.cohorts c on c.id = s.cohort_id
  order by c.name desc, s.day_of_month;
end $$;

-- ---------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------
revoke execute on function public._new_code() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['cohort_list()', 'new_cohort_code(uuid)', 'join_cohort(text)', 'save_schedule(jsonb)',
                           'run_due_schedules()', 'schedule_list()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
