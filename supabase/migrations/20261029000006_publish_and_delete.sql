-- =====================================================================
-- 0006 publish without peer review · delete questions and exams
--   * publish_question_now(): the author (or an admin) puts a draft live
--     directly. Pre-test / monthly items: admins only, as before.
--     (The review functions stay in place but the app no longer uses them.)
--   * delete_question() / delete_exam(): allowed while no student has used
--     the item or exam. Admins can force-delete, which also removes the
--     students' answers or results. Every delete is copied to audit_log.
-- =====================================================================

-- Keys of non-draft versions stay frozen, except during a sanctioned delete.
create or replace function public.freeze_question_key()
returns trigger
language plpgsql set search_path = ''
as $$
declare v_status text;
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.deleting', true), '') = 'yes' then
    return old;
  end if;
  select status into v_status from public.question_versions where id = old.version_id;
  if v_status <> 'draft' then
    raise exception 'answer key for a % version cannot change', v_status using errcode = '55000';
  end if;
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------
-- Publish directly
-- ---------------------------------------------------------------------
create or replace function public.publish_question_now(p_version uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
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
  if v.author_id <> auth.uid() and q.author_id <> auth.uid() and not public.is_admin() then
    raise exception 'only the author or an admin can publish this question' using errcode = '42501';
  end if;
  if q.pool <> 'practice' and not public.is_admin() then
    raise exception 'only an admin can put % items live', q.pool using errcode = '42501';
  end if;
  perform set_config('app.audit_action', 'supersede', true);
  update public.question_versions set status = 'superseded' where question_id = v.question_id and status = 'live';
  perform set_config('app.audit_action', 'publish', true);
  update public.question_versions
     set status = 'live', live_at = now(), approved_by = coalesce(approved_by, auth.uid()), approved_at = coalesce(approved_at, now())
   where id = p_version;
  update public.questions set updated_at = now() where id = v.question_id;
  perform public._emit('question_live', null, v.question_id, p_version);
end $$;

-- ---------------------------------------------------------------------
-- Delete a question
-- ---------------------------------------------------------------------
-- How much student data hangs off an item (shown before deleting).
create or replace function public.question_usage(p_question uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._require_instructor();
  return jsonb_build_object(
    'answers', (select count(*) from public.answers a join public.question_versions v on v.id = a.version_id where v.question_id = p_question),
    'reviews', (select count(*) from public.card_reviews where question_id = p_question)
             + (select count(*) from public.srs_state where question_id = p_question),
    'exams',   (select count(distinct exam_id) from public.exam_items where question_id = p_question));
end $$;

create or replace function public.delete_question(p_question uuid, p_force boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare q public.questions; u jsonb;
begin
  perform public._require_instructor();
  select * into q from public.questions where id = p_question for update;
  if not found then raise exception 'question not found' using errcode = 'P0002'; end if;
  if q.author_id <> auth.uid() and not public.is_admin() then
    raise exception 'only the author or an admin can delete this question' using errcode = '42501';
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
end $$;

-- ---------------------------------------------------------------------
-- Delete an exam
-- ---------------------------------------------------------------------
-- A deleted scheduled check-in must not be recreated for the same month.
create table public.exam_schedule_skips (
  schedule_id  uuid not null references public.exam_schedules (id) on delete cascade,
  period       text not null,
  primary key (schedule_id, period)
);
alter table public.exam_schedule_skips enable row level security;
revoke all on public.exam_schedule_skips from anon, authenticated;

create or replace function public.delete_exam(p_exam uuid, p_force boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare e public.exams; v_n int;
begin
  perform public._require_instructor();
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
end $$;

-- run_due_schedules: respect deleted months
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
    continue when exists (select 1 from public.exam_schedule_skips k where k.schedule_id = s.id and k.period = v_period);
    v_open := ((date_trunc('month', v_today)::date + (s.day_of_month - 1))::timestamp) at time zone 'Asia/Bangkok';
    continue when now() > v_open + make_interval(days => s.open_days);
    begin
      perform set_config('app.audit_action', 'scheduled_create', true);
      insert into public.exams (kind, title, cohort_id, opens_at, closes_at, duration_min, status, created_by, schedule_id, period)
      values ('monthly', s.title || ' — ' || to_char(v_today, 'Mon YYYY'), s.cohort_id, v_open,
              v_open + make_interval(days => s.open_days), s.duration_min, 'draft', s.created_by, s.id, v_period)
      returning id into v_exam;
    exception when unique_violation then
      continue;
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
      update public.exams set status = 'open' where id = v_exam;
    end if;
    v_made := v_made + 1;
  end loop;
  return v_made;
end $$;

do $$
declare f text;
begin
  foreach f in array array['publish_question_now(uuid)', 'question_usage(uuid)', 'delete_question(uuid, boolean)',
                           'delete_exam(uuid, boolean)', 'run_due_schedules()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
