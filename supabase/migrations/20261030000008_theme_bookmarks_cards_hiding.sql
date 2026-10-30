-- =====================================================================
-- 0008 theme, bookmarks anywhere, students' own flashcards, hiding
--
--   * profiles.theme: 'dark' (default) | 'light' | 'system', set by each user in Settings
--   * bookmarks now hold a kind as well as an id: a topic, a lecture, an
--     organism or a disease. "Bookmarked topics" in Practice lists them all and
--     a 'saved' session draws every live practice item tagged with any of them.
--     toggle_bookmark(topic) still works (it is toggle_saved('topic', ...)).
--   * student_cards: flashcards a student writes for their own study, with
--     their own spaced-review schedule. Only the student and admins can read
--     them. Every create, edit and delete is in audit_log (rows readable by
--     admins only) and in content_events (own_card_* events).
--   * hiding: instructors can hide a lecture, or a question that no student
--     has answered, reviewed or met in an exam. Hidden items keep everything
--     and can be shown again. A hidden lecture takes its practice questions
--     with it; a hidden question leaves practice and exam picking.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Theme
-- ---------------------------------------------------------------------
alter table public.profiles add column theme text not null default 'dark'
  check (theme in ('system', 'light', 'dark'));
grant update (theme) on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- 2. Event dictionary
-- ---------------------------------------------------------------------
insert into public.event_types (id, actor, description) values
  ('own_card_created',  'student',    'A student wrote a flashcard of their own'),
  ('own_card_edited',   'student',    'A student edited one of their own flashcards'),
  ('own_card_deleted',  'student',    'A student deleted one of their own flashcards'),
  ('own_card_reviewed', 'student',    'A student rated one of their own flashcards'),
  ('lecture_hidden',    'instructor', 'A lecture was hidden from students'),
  ('lecture_shown',     'instructor', 'A hidden lecture was shown to students again'),
  ('question_hidden',   'instructor', 'A question was hidden from practice and exam picking'),
  ('question_shown',    'instructor', 'A hidden question was shown again')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 3. Hiding lectures and questions
-- ---------------------------------------------------------------------
alter table public.lectures  add column hidden_at timestamptz, add column hidden_by uuid references auth.users (id);
alter table public.questions add column hidden_at timestamptz, add column hidden_by uuid references auth.users (id);

-- Students no longer see hidden lectures; every instructor still does.
drop policy lectures_select on public.lectures;
create policy lectures_select on public.lectures for select to authenticated
  using ((status = 'published' and (hidden_at is null or public.is_instructor()))
         or (public.is_instructor() and (author_id = auth.uid() or public.is_admin())));

create or replace function public._lecture_hidden(p_lecture uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.lectures l where l.id = p_lecture and l.hidden_at is not null) $$;

-- Can students practise this item? Practice pool, not retired, not hidden, and
-- its live version does not belong to a hidden lecture.
create or replace function public._student_q_ok(p_question uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.questions q
                  where q.id = p_question and q.pool = 'practice' and q.retired_at is null and q.hidden_at is null)
     and not exists (select 1 from public.question_versions v join public.lectures l on l.id = v.lecture_id
                      where v.question_id = p_question and v.status = 'live' and l.hidden_at is not null)
$$;

-- RLS helper (0002): students read only items they may practise.
create or replace function public._question_is_practice_live(p_question uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select public._student_q_ok(p_question) $$;

create or replace function public.set_lecture_hidden(p_id uuid, p_hidden boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_row public.lectures;
begin
  perform public._require_instructor();
  select * into v_row from public.lectures where id = p_id for update;
  if not found then raise exception 'lecture not found' using errcode = 'P0002'; end if;
  if v_row.author_id <> auth.uid() and not public.is_admin() then
    raise exception 'only the author or an admin can hide or show this lecture' using errcode = '42501';
  end if;
  if (v_row.hidden_at is not null) = coalesce(p_hidden, false) then return; end if;
  perform set_config('app.audit_action', case when p_hidden then 'hide' else 'unhide' end, true);
  update public.lectures
     set hidden_at = case when p_hidden then now() end, hidden_by = case when p_hidden then auth.uid() end,
         updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  perform public._emit(case when p_hidden then 'lecture_hidden' else 'lecture_shown' end, p_id);
end $$;

create or replace function public.set_question_hidden(p_question uuid, p_hidden boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare q public.questions; u jsonb;
begin
  perform public._require_instructor();
  select * into q from public.questions where id = p_question for update;
  if not found then raise exception 'question not found' using errcode = 'P0002'; end if;
  if q.author_id <> auth.uid() and not public.is_admin() then
    raise exception 'only the author or an admin can hide or show this question' using errcode = '42501';
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
end $$;

-- Instructor lists gain hidden_at.
drop function public.lecture_list();
create function public.lecture_list()
returns table (id uuid, number int, title text, niche text, status text, author_id uuid, author_name text,
               updated_at timestamptz, published_at timestamptz, viewers int, questions int, hidden_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
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
  where l.status = 'published' or l.author_id = auth.uid() or public.is_admin()
  order by l.number, l.updated_at desc;
end $$;

drop function public.question_list();
create or replace function public.question_list()
returns table (
  question_id uuid, pool text, item_author uuid, source text, retired_at timestamptz,
  version_id uuid, version int, status text, stem text, niche text, topic text, lecture_id uuid,
  lecture_number int, lecture_title text, tier text, difficulty text, bloom text, failure_mode text,
  organism_ids text[], disease_ids text[], version_author uuid, author_name text,
  live_version_id uuid, live_version int, answers int, pct_correct numeric, updated_at timestamptz,
  last_return_comment text, hidden_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._require_instructor();
  return query
  with latest as (
    select distinct on (v.question_id) v.*
    from public.question_versions v
    where public.can_see_version(v.status, v.author_id)
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
end $$;

-- Student-facing paths: practise only what _student_q_ok allows.
create or replace function public._practice_version(p_question uuid)
returns uuid language sql stable security definer set search_path = ''
as $$
  select v.id from public.question_versions v join public.questions q on q.id = v.question_id
  where v.question_id = p_question and v.status = 'live' and q.pool = 'practice' and q.retired_at is null and public._student_q_ok(q.id)
$$;
create or replace function public.submit_answer(p_version uuid, p_option text, p_confidence text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v public.question_versions;
  k public.question_keys;
  v_ok boolean;
  v_rating text;
begin
  perform public._require_user();
  if p_confidence is not null and p_confidence not in ('guess', 'unsure', 'sure') then
    raise exception 'confidence must be guess, unsure or sure' using errcode = '22023';
  end if;
  select v2.* into v from public.question_versions v2
    join public.questions q on q.id = v2.question_id
   where v2.id = p_version and v2.status = 'live' and q.pool = 'practice' and q.retired_at is null and public._student_q_ok(q.id);
  if not found then raise exception 'question not available' using errcode = 'P0002'; end if;
  if not exists (select 1 from jsonb_array_elements(v.options) o where o ->> 'id' = p_option) then
    raise exception 'not an option of this question' using errcode = '22023';
  end if;
  select * into k from public.question_keys where version_id = p_version;
  v_ok := (k.correct_option_id = p_option);
  insert into public.answers (user_id, version_id, chosen_option_id, is_correct, confidence)
  values (auth.uid(), p_version, p_option, v_ok, p_confidence);
  v_rating := case when not v_ok then 'again' when coalesce(p_confidence, 'sure') = 'sure' then 'good' else 'hard' end;
  perform public._srs_apply(auth.uid(), v.question_id, v_rating);
  insert into public.card_reviews (user_id, question_id, version_id, rating, mode)
  values (auth.uid(), v.question_id, p_version, v_rating, 'mcq');
  perform public._emit('question_answered', v.lecture_id, v.question_id, p_version,
                       jsonb_build_object('option', p_option, 'correct', v_ok, 'confidence', p_confidence));
  return jsonb_build_object('correct', v_ok, 'correct_option_id', k.correct_option_id, 'explanation', k.explanation);
end $$;
create or replace function public.reveal_card(p_version uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v public.question_versions; k public.question_keys;
begin
  perform public._require_user();
  select v2.* into v from public.question_versions v2 join public.questions q on q.id = v2.question_id
   where v2.id = p_version and v2.status = 'live' and q.pool = 'practice' and q.retired_at is null and public._student_q_ok(q.id);
  if not found then raise exception 'card not available' using errcode = 'P0002'; end if;
  select * into k from public.question_keys where version_id = p_version;
  return jsonb_build_object('correct_option_id', k.correct_option_id,
    'answer', (select o ->> 'text' from jsonb_array_elements(v.options) o where o ->> 'id' = k.correct_option_id),
    'explanation', k.explanation);
end $$;
create or replace function public.log_lecture_view(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not exists (select 1 from public.lectures where id = p_id and status = 'published' and hidden_at is null) then
    raise exception 'lecture not found' using errcode = 'P0002';
  end if;
  perform public._emit('lecture_viewed', p_id);
end $$;
create or replace function public.mark_lecture_read(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform public._require_user();
  if not exists (select 1 from public.lectures where id = p_id and status = 'published' and hidden_at is null) then
    raise exception 'lecture not found' using errcode = 'P0002';
  end if;
  perform public._emit('lecture_completed', p_id);
end $$;

-- Exam paths: hidden items are never picked.
create or replace function public.set_exam_items(p_exam uuid, p_questions uuid[])
returns int language plpgsql security definer set search_path = ''
as $$
declare e public.exams; v_q uuid; v_pos int := 0; v_ver uuid;
begin
  perform public._require_instructor();
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
end $$;
create or replace function public.pick_exam_items(p_exam uuid, p_n int)
returns int language plpgsql security definer set search_path = ''
as $$
declare e public.exams; v_ids uuid[];
begin
  perform public._require_instructor();
  select * into e from public.exams where id = p_exam;
  if not found then raise exception 'exam not found' using errcode = 'P0002'; end if;
  select array_agg(qid order by rn, r) into v_ids from (
    select v.question_id as qid, row_number() over (partition by v.niche order by random()) as rn, random() as r
    from public.question_versions v join public.questions q on q.id = v.question_id
    where v.status = 'live' and q.pool = e.kind and q.retired_at is null and q.hidden_at is null
  ) x where x.rn is not null;
  v_ids := v_ids[1:greatest(0, p_n)];
  return public.set_exam_items(p_exam, v_ids);
end $$;
create or replace function public.exam_detail(p_exam uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_k int; v_kr20 numeric;
begin
  perform public._require_instructor();
  if not exists (select 1 from public.exams where id = p_exam) then raise exception 'exam not found' using errcode = 'P0002'; end if;
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
              'version', v.version, 'stem', v.stem, 'niche', v.niche, 'topic', v.topic,
              'n', (select count(*) from public.exam_responses r join public.exam_attempts a on a.id = r.attempt_id
                     where a.exam_id = p_exam and a.submitted_at is not null and r.position = i.position),
              'pct', (select round(100.0 * count(*) filter (where r.is_correct) / nullif(count(*), 0), 0)
                       from public.exam_responses r join public.exam_attempts a on a.id = r.attempt_id
                      where a.exam_id = p_exam and a.submitted_at is not null and r.position = i.position)) order by i.position)
       from public.exam_items i join public.question_versions v on v.id = i.version_id where i.exam_id = p_exam), '[]'),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object('attempt_id', a.id, 'code', public._user_code(a.user_id),
              'name', p.display_name, 'started_at', a.started_at, 'submitted_at', a.submitted_at, 'score', a.score) order by a.started_at)
       from public.exam_attempts a join public.profiles p on p.id = a.user_id where a.exam_id = p_exam), '[]'),
    'pool_live', (select count(*) from public.question_versions v join public.questions q on q.id = v.question_id
                   join public.exams e on e.id = p_exam
                  where v.status = 'live' and q.pool = e.kind and q.retired_at is null and q.hidden_at is null)
  );
end $$;
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
          where v.status = 'live' and q.pool = 'monthly' and q.retired_at is null and q.hidden_at is null) x
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

-- ---------------------------------------------------------------------
-- 4. Bookmarks: topics, lectures, organisms and diseases
-- ---------------------------------------------------------------------
alter table public.bookmarks rename column topic to ref;
alter table public.bookmarks add column kind text not null default 'topic'
  check (kind in ('topic', 'lecture', 'organism', 'disease'));
alter table public.bookmarks drop constraint bookmarks_pkey;
alter table public.bookmarks add primary key (user_id, kind, ref);

create or replace function public.toggle_saved(p_kind text, p_ref text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_on boolean; v_lec uuid;
begin
  perform public._require_user();
  if p_kind not in ('topic', 'lecture', 'organism', 'disease') then
    raise exception 'unknown bookmark kind' using errcode = '22023';
  end if;
  if p_kind = 'lecture' then
    if coalesce(p_ref, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (select 1 from public.lectures l where l.id = p_ref::uuid and l.status = 'published' and l.hidden_at is null) then
      raise exception 'unknown lecture' using errcode = '22023';
    end if;
    v_lec := p_ref::uuid;
    p_ref := lower(p_ref);
  elsif cardinality(public.vocab_missing(p_kind, array[p_ref])) > 0 then
    raise exception 'unknown %', p_kind using errcode = '22023';
  end if;
  delete from public.bookmarks where user_id = auth.uid() and kind = p_kind and ref = p_ref;
  if found then v_on := false;
  else insert into public.bookmarks (user_id, kind, ref) values (auth.uid(), p_kind, p_ref); v_on := true; end if;
  perform public._emit('bookmark_changed', v_lec, null, null,
                       jsonb_build_object('kind', p_kind, 'ref', p_ref, 'topic', case when p_kind = 'topic' then p_ref end, 'on', v_on));
  return v_on;
end $$;

create or replace function public.toggle_bookmark(p_topic text)
returns boolean language sql security definer set search_path = ''
as $$ select public.toggle_saved('topic', p_topic) $$;

-- my_status: 'bookmarks' stays the list of topic ids; 'saved' lists every bookmark;
-- 'own_due' counts the student's own flashcards that are due.
create or replace function public.my_status()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare p public.profiles; c public.consents; v_pre record; st record;
begin
  perform public._require_user();
  select * into p from public.profiles where id = auth.uid();
  select * into c from public.consents where user_id = auth.uid();
  select e.id, e.title, e.duration_min, (select count(*) from public.exam_items i where i.exam_id = e.id) as n,
         a.id as attempt_id, a.submitted_at, a.score
    into v_pre
    from public.exams e left join public.exam_attempts a on a.exam_id = e.id and a.user_id = auth.uid()
   where e.kind = 'pretest' and e.status = 'open' and e.opens_at <= now()
     and (e.cohort_id is null or e.cohort_id = p.cohort_id)
   order by (a.submitted_at is not null), e.opens_at desc limit 1;
  select * into st from public._streak(auth.uid());
  return jsonb_build_object(
    'role', p.role, 'cohort_id', p.cohort_id,
    'cohort', (select name from public.cohorts where id = p.cohort_id),
    'consent', case when c.user_id is null then null else jsonb_build_object('platform', c.platform, 'research', c.research) end,
    'pretest', case when v_pre.id is null then jsonb_build_object('state', 'none')
                    else jsonb_build_object('exam_id', v_pre.id, 'title', v_pre.title, 'n_items', v_pre.n,
                           'duration_min', v_pre.duration_min, 'attempt_id', v_pre.attempt_id, 'score', v_pre.score,
                           'state', case when v_pre.submitted_at is not null then 'done'
                                         when v_pre.attempt_id is not null then 'in_progress' else 'todo' end) end,
    'any_pretest_done', exists (select 1 from public.exam_attempts a join public.exams e on e.id = a.exam_id
                                where a.user_id = auth.uid() and e.kind = 'pretest' and a.submitted_at is not null),
    'streak', st.current, 'best_streak', st.best,
    'cards_due', (select count(*) from public.srs_state s where s.user_id = auth.uid() and s.due_at <= now()
                   and public._practice_version(s.question_id) is not null),
    'new_cards', (select count(*) from public.question_versions v join public.questions q on q.id = v.question_id
                   where v.status = 'live' and q.pool = 'practice' and q.retired_at is null and public._student_q_ok(q.id)
                     and not exists (select 1 from public.srs_state s where s.user_id = auth.uid() and s.question_id = v.question_id)),
    'bookmarks', coalesce((select jsonb_agg(b.ref order by b.created_at) from public.bookmarks b
                            where b.user_id = auth.uid() and b.kind = 'topic'), '[]'),
    'saved', coalesce((select jsonb_agg(jsonb_build_object('kind', b.kind, 'ref', b.ref) order by b.created_at)
                         from public.bookmarks b where b.user_id = auth.uid()), '[]'),
    'own_cards', (select count(*) from public.student_cards sc where sc.user_id = auth.uid() and sc.deleted_at is null),
    'own_due', (select count(*) from public.student_cards sc join public.student_card_state ss on ss.card_id = sc.id
                 where sc.user_id = auth.uid() and sc.deleted_at is null and ss.due_at <= now()));
end $$;

-- Session cards. New mode 'saved': items tagged with any bookmark (or with the
-- bookmarks passed in p_saved, a subset the student ticked).
drop function public.session_cards(text, text[], int);
create function public.session_cards(p_mode text default 'due', p_topics text[] default null, p_limit int default 24,
                                     p_saved jsonb default null)
returns table (version_id uuid, question_id uuid, stem text, options jsonb, niche text, topic text, lecture_id uuid,
               cascade_step text, reps int, interval_days real, ease real, due_at timestamptz, is_new boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare v_new_left int;
begin
  perform public._require_user();
  if p_mode not in ('due', 'topics', 'mixed', 'saved') then raise exception 'bad mode' using errcode = '22023'; end if;
  select greatest(0, 20 - count(*))::int into v_new_left from public.srs_state s
   where s.user_id = auth.uid() and public._day(s.created_at) = public._today();
  return query
  with sel as (
    select x ->> 'kind' as skind, x ->> 'ref' as sref from jsonb_array_elements(coalesce(p_saved, '[]')) x
     where p_saved is not null
    union all
    select b.kind, b.ref from public.bookmarks b where p_saved is null and b.user_id = auth.uid()
  ), items as (
    select v.id as vid, v.question_id as qid, v.stem as vstem, v.options as vopts, v.niche as vniche, v.topic as vtopic,
           v.lecture_id as vlec, v.organism_ids as vorgs, v.disease_ids as vdis,
           l.cascade_step as vcas, s.reps as sreps, s.interval_days as sint, s.ease as sease,
           s.due_at as sdue, (s.user_id is null) as fresh
    from public.question_versions v
    join public.questions q on q.id = v.question_id and q.pool = 'practice' and q.retired_at is null and q.hidden_at is null
    left join public.lectures l on l.id = v.lecture_id
    left join public.srs_state s on s.question_id = v.question_id and s.user_id = auth.uid()
    where v.status = 'live' and (l.id is null or l.hidden_at is null)
  ), picked as (
    select i.*, 0 as grp, i.sdue as ord from items i where p_mode = 'due' and not i.fresh and i.sdue <= now()
    union all
    select x.* from (select i.*, 1 as grp, null::timestamptz as ord from items i
                      where p_mode = 'due' and i.fresh order by md5(i.qid::text || auth.uid()::text) limit v_new_left) x
    union all
    select i.*, 0, coalesce(i.sdue, '-infinity'::timestamptz) from items i where p_mode = 'topics' and i.vtopic = any (coalesce(p_topics, '{}'))
    union all
    select i.*, 0, coalesce(i.sdue, '-infinity'::timestamptz) from items i
     where p_mode = 'saved' and exists (select 1 from sel
             where (sel.skind = 'topic' and sel.sref = i.vtopic)
                or (sel.skind = 'lecture' and sel.sref = i.vlec::text)
                or (sel.skind = 'organism' and sel.sref = any (i.vorgs))
                or (sel.skind = 'disease' and sel.sref = any (i.vdis)))
    union all
    select i.*, 0, null::timestamptz from items i where p_mode = 'mixed'
  )
  select p.vid, p.qid, p.vstem, p.vopts, p.vniche, p.vtopic, p.vlec, p.vcas, coalesce(p.sreps, 0), coalesce(p.sint, 0),
         coalesce(p.sease, 2.5), p.sdue, p.fresh
  from picked p
  order by p.grp, case when p_mode = 'mixed' then random() end, p.ord nulls last
  limit greatest(1, least(p_limit, 200));
end $$;

-- ---------------------------------------------------------------------
-- 5. Students' own flashcards
-- ---------------------------------------------------------------------
create table public.student_cards (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  front        text not null check (length(btrim(front)) between 1 and 1000),
  back         text not null check (length(btrim(back)) between 1 and 4000),
  topic        text,
  lecture_id   uuid references public.lectures (id) on delete set null,
  organism_id  text,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index student_cards_user_idx on public.student_cards (user_id) where deleted_at is null;

-- The schedule lives in its own table so rating a card does not write audit_log.
create table public.student_card_state (
  card_id        uuid primary key references public.student_cards (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  ease           real not null default 2.5,
  interval_days  real not null default 0,
  reps           int  not null default 0,
  lapses         int  not null default 0,
  due_at         timestamptz not null default now(),
  last_rating    text,
  updated_at     timestamptz not null default now()
);
create index student_card_state_due_idx on public.student_card_state (user_id, due_at);

alter table public.student_cards      enable row level security;
alter table public.student_card_state enable row level security;
revoke all on public.student_cards, public.student_card_state from anon, authenticated;
grant select on public.student_cards, public.student_card_state to authenticated;
-- The student who wrote it, and admins. Not other students, not instructors.
create policy student_cards_select on public.student_cards for select to authenticated
  using ((user_id = auth.uid() and deleted_at is null) or public.is_admin());
create policy student_card_state_select on public.student_card_state for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create trigger student_cards_audit after insert or update or delete on public.student_cards
  for each row execute function public.audit_row();

-- Audit rows for students' own cards are for admins only.
drop policy audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using (public.is_instructor() and (table_name <> 'student_cards' or public.is_admin()));

create or replace function public.save_my_card(p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_front text := btrim(coalesce(p ->> 'front', ''));
  v_back text := btrim(coalesce(p ->> 'back', ''));
  v_topic text := nullif(p ->> 'topic', '');
  v_org text := nullif(p ->> 'organism_id', '');
  v_lec uuid := nullif(p ->> 'lecture_id', '')::uuid;
  e text[] := '{}';
begin
  perform public._require_user();
  if v_front = '' then e := e || text 'Write the front of the card.'; end if;
  if v_back = '' then e := e || text 'Write the back of the card.'; end if;
  if length(v_front) > 1000 then e := e || text 'The front is too long (1,000 characters max).'; end if;
  if length(v_back) > 4000 then e := e || text 'The back is too long (4,000 characters max).'; end if;
  if v_topic is not null and cardinality(public.vocab_missing('topic', array[v_topic])) > 0 then e := e || ('Unknown topic: ' || v_topic); end if;
  if v_org is not null and cardinality(public.vocab_missing('organism', array[v_org])) > 0 then e := e || ('Unknown organism: ' || v_org); end if;
  if v_lec is not null and not exists (select 1 from public.lectures l where l.id = v_lec and l.status = 'published' and l.hidden_at is null) then
    e := e || text 'Unknown lecture.';
  end if;
  if cardinality(e) > 0 then raise exception '%', array_to_string(e, ' ') using errcode = '22023'; end if;

  if v_id is null then
    if (select count(*) from public.student_cards where user_id = auth.uid() and deleted_at is null) >= 2000 then
      raise exception 'you already have 2,000 flashcards; delete some first' using errcode = '54000';
    end if;
    perform set_config('app.audit_action', 'create', true);
    insert into public.student_cards (user_id, front, back, topic, lecture_id, organism_id)
    values (auth.uid(), v_front, v_back, v_topic, v_lec, v_org) returning id into v_id;
    insert into public.student_card_state (card_id, user_id) values (v_id, auth.uid());
    perform public._emit('own_card_created', v_lec, null, null, jsonb_build_object('card_id', v_id));
    return v_id;
  end if;

  perform set_config('app.audit_action', 'edit', true);
  update public.student_cards
     set front = v_front, back = v_back, topic = v_topic, lecture_id = v_lec, organism_id = v_org, updated_at = now()
   where id = v_id and user_id = auth.uid() and deleted_at is null;
  if not found then raise exception 'card not found' using errcode = 'P0002'; end if;
  perform public._emit('own_card_edited', v_lec, null, null, jsonb_build_object('card_id', v_id));
  return v_id;
end $$;

-- Deleting hides the card from the student; the text stays for admins and the log.
create or replace function public.delete_my_card(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform public._require_user();
  perform set_config('app.audit_action', 'delete', true);
  update public.student_cards set deleted_at = now(), updated_at = now()
   where id = p_id and user_id = auth.uid() and deleted_at is null;
  if not found then raise exception 'card not found' using errcode = 'P0002'; end if;
  perform public._emit('own_card_deleted', null, null, null, jsonb_build_object('card_id', p_id));
end $$;

-- Same schedule as the course cards: new card again 10 min / hard 1 d / good 3 d / easy 7 d.
create or replace function public.review_my_card(p_id uuid, p_rating text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare s public.student_card_state; v_i real;
begin
  perform public._require_user();
  if p_rating not in ('again', 'hard', 'good', 'easy') then raise exception 'bad rating' using errcode = '22023'; end if;
  if not exists (select 1 from public.student_cards c where c.id = p_id and c.user_id = auth.uid() and c.deleted_at is null) then
    raise exception 'card not found' using errcode = 'P0002';
  end if;
  insert into public.student_card_state (card_id, user_id) values (p_id, auth.uid()) on conflict (card_id) do nothing;
  select * into s from public.student_card_state where card_id = p_id for update;
  if p_rating = 'again' then
    s.lapses := s.lapses + case when s.reps > 0 then 1 else 0 end;
    s.reps := 0; s.interval_days := 0; s.ease := greatest(1.3, s.ease - 0.2);
    s.due_at := now() + interval '10 minutes';
  else
    if s.reps = 0 then
      v_i := case p_rating when 'hard' then 1 when 'good' then 3 else 7 end;
    else
      v_i := case p_rating
        when 'hard' then greatest(1, round(s.interval_days * 1.2))
        when 'good' then greatest(s.interval_days + 1, round(s.interval_days * s.ease))
        else greatest(s.interval_days + 2, round(s.interval_days * s.ease * 1.3)) end;
    end if;
    s.ease := least(3.0, greatest(1.3, s.ease + case p_rating when 'hard' then -0.15 when 'easy' then 0.15 else 0 end));
    s.reps := s.reps + 1; s.interval_days := v_i;
    s.due_at := now() + make_interval(days => v_i::int);
  end if;
  update public.student_card_state set ease = s.ease, interval_days = s.interval_days, reps = s.reps, lapses = s.lapses,
         due_at = s.due_at, last_rating = p_rating, updated_at = now()
   where card_id = p_id;
  perform public._emit('own_card_reviewed', null, null, null, jsonb_build_object('card_id', p_id, 'rating', p_rating));
  return jsonb_build_object('due_at', s.due_at, 'interval_days', s.interval_days);
end $$;

create or replace function public.my_cards()
returns table (id uuid, front text, back text, topic text, lecture_id uuid, organism_id text, created_at timestamptz,
               updated_at timestamptz, reps int, interval_days real, ease real, due_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._require_user();
  return query
  select c.id, c.front, c.back, c.topic, c.lecture_id, c.organism_id, c.created_at, c.updated_at,
         coalesce(s.reps, 0), coalesce(s.interval_days, 0), coalesce(s.ease, 2.5), coalesce(s.due_at, c.created_at)
  from public.student_cards c left join public.student_card_state s on s.card_id = c.id
  where c.user_id = auth.uid() and c.deleted_at is null
  order by c.created_at desc;
end $$;

-- Own cards for a session: 'due' (due now), 'mine' (all, soonest due first),
-- 'saved' (tagged with a bookmark), 'mixed' (random).
create or replace function public.my_card_session(p_mode text default 'due', p_limit int default 24, p_saved jsonb default null)
returns table (id uuid, front text, back text, topic text, lecture_id uuid, organism_id text,
               reps int, interval_days real, ease real, due_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._require_user();
  if p_mode not in ('due', 'mine', 'saved', 'mixed', 'topics') then raise exception 'bad mode' using errcode = '22023'; end if;
  return query
  with sel as (
    select x ->> 'kind' as skind, x ->> 'ref' as sref from jsonb_array_elements(coalesce(p_saved, '[]')) x where p_saved is not null
    union all
    select b.kind, b.ref from public.bookmarks b where p_saved is null and b.user_id = auth.uid()
  ), c as (
    select c.id as cid, c.front as cf, c.back as cb, c.topic as ct, c.lecture_id as cl, c.organism_id as co,
           coalesce(s.reps, 0) as sr, coalesce(s.interval_days, 0) as si, coalesce(s.ease, 2.5) as se,
           coalesce(s.due_at, c.created_at) as sd
    from public.student_cards c left join public.student_card_state s on s.card_id = c.id
    where c.user_id = auth.uid() and c.deleted_at is null
  )
  select c.cid, c.cf, c.cb, c.ct, c.cl, c.co, c.sr, c.si, c.se, c.sd from c
  where p_mode in ('mine', 'mixed')
     or (p_mode = 'due' and c.sd <= now())
     or (p_mode in ('saved', 'topics') and exists (select 1 from sel
          where (sel.skind = 'topic' and sel.sref = c.ct) or (sel.skind = 'lecture' and sel.sref = c.cl::text)
             or (sel.skind = 'organism' and sel.sref = c.co)))
  order by case when p_mode = 'mixed' then random() end, c.sd
  limit greatest(1, least(p_limit, 500));
end $$;

-- Admins: every student's own flashcards, deleted ones included.
create or replace function public.student_card_list(p_cohort uuid default null)
returns table (id uuid, user_id uuid, code text, name text, cohort text, front text, back text, topic text,
               lecture_id uuid, organism_id text, created_at timestamptz, updated_at timestamptz, deleted_at timestamptz,
               reviews int, last_reviewed timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  return query
  select c.id, c.user_id, public._user_code(c.user_id), p.display_name, co.name, c.front, c.back, c.topic,
         c.lecture_id, c.organism_id, c.created_at, c.updated_at, c.deleted_at,
         (select count(*) from public.content_events e
           where e.user_id = c.user_id and e.event_type = 'own_card_reviewed' and e.payload ->> 'card_id' = c.id::text)::int,
         (select max(e.created_at) from public.content_events e
           where e.user_id = c.user_id and e.event_type = 'own_card_reviewed' and e.payload ->> 'card_id' = c.id::text)
  from public.student_cards c
  join public.profiles p on p.id = c.user_id
  left join public.cohorts co on co.id = p.cohort_id
  where p_cohort is null or p.cohort_id = p_cohort
  order by c.created_at desc;
end $$;

-- Streaks count reviewing and writing your own cards as study.
create or replace function public._streak(p_user uuid, out current int, out best int)
language plpgsql stable security definer set search_path = ''
as $$
declare d date; prev date := null; run int := 0;
begin
  current := 0; best := 0;
  for d in select distinct public._day(created_at) from public.content_events
            where user_id = p_user and event_type in ('lecture_viewed', 'lecture_completed', 'question_answered',
                                                      'card_reviewed', 'exam_submitted', 'own_card_reviewed', 'own_card_created')
            order by 1 loop
    if prev is null or d - prev > 2 then run := 1; else run := run + 1; end if;
    best := greatest(best, run);
    prev := d;
  end loop;
  if prev is not null and public._today() - prev <= 2 then current := run; end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. Privileges
-- ---------------------------------------------------------------------
revoke execute on function public._lecture_hidden(uuid) from public, anon, authenticated;
revoke execute on function public._student_q_ok(uuid) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'set_lecture_hidden(uuid, boolean)', 'set_question_hidden(uuid, boolean)', 'lecture_list()', 'question_list()',
    'toggle_saved(text, text)', 'toggle_bookmark(text)', 'session_cards(text, text[], int, jsonb)',
    'save_my_card(jsonb)', 'delete_my_card(uuid)', 'review_my_card(uuid, text)', 'my_cards()',
    'my_card_session(text, int, jsonb)', 'student_card_list(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
