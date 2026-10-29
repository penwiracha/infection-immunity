-- =====================================================================
-- 0003 student app + exams
--   cohorts · consent · confidence ratings · spaced review (flashcards)
--   bookmarks · lecture read status · streaks · pre-test and monthly
--   check-in exams · cohort reporting (by period, topic accuracy by week)
--
-- Days are counted in Asia/Bangkok time (streaks, "this week", weekly buckets).
-- Exam items are never readable by students: they receive stems and options
-- from start_exam(), and keys only ever leave the database inside scores.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public._day(p timestamptz)
returns date language sql immutable set search_path = ''
as $$ select (p at time zone 'Asia/Bangkok')::date $$;

create or replace function public._today()
returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'Asia/Bangkok')::date $$;

create or replace function public._require_user()
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
end $$;

-- short pseudonymous code for a user (stable, not reversible without the table)
create or replace function public._user_code(p uuid)
returns text language sql immutable set search_path = ''
as $$ select 'S-' || upper(left(md5(p::text), 4)) $$;

insert into public.event_types (id, actor, description) values
  ('card_reviewed',     'student',    'A student rated a spaced-review card'),
  ('lecture_completed', 'student',    'A student marked a lecture as read'),
  ('bookmark_changed',  'student',    'A student bookmarked or un-bookmarked a topic'),
  ('consent_given',     'student',    'A student recorded their consent choices'),
  ('exam_started',      'student',    'A student started a pre-test or check-in'),
  ('exam_submitted',    'student',    'A student submitted a pre-test or check-in'),
  ('names_shown',       'instructor', 'An instructor revealed student names on a pseudonymous list')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Cohorts
-- ---------------------------------------------------------------------
create table public.cohorts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(btrim(name)) > 0),
  starts_on  date,
  created_at timestamptz not null default now()
);
alter table public.profiles add column cohort_id uuid references public.cohorts (id) on delete set null;

alter table public.cohorts enable row level security;
revoke all on public.cohorts from anon, authenticated;
grant select on public.cohorts to authenticated;
create policy cohorts_select on public.cohorts for select to authenticated using (true);
create trigger cohorts_audit after insert or update or delete on public.cohorts
  for each row execute function public.audit_row();

create or replace function public.save_cohort(p_name text, p_starts_on date default null, p_id uuid default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  perform public._require_instructor();
  if p_id is null then
    insert into public.cohorts (name, starts_on) values (btrim(p_name), p_starts_on) returning id into v_id;
  else
    update public.cohorts set name = btrim(p_name), starts_on = p_starts_on where id = p_id returning id into v_id;
    if v_id is null then raise exception 'cohort not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'a cohort called % already exists', p_name using errcode = '23505';
end $$;

create or replace function public.set_student_cohort(p_user uuid, p_cohort uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform public._require_instructor();
  perform set_config('app.audit_action', 'cohort_change', true);
  update public.profiles set cohort_id = p_cohort where id = p_user;
  if not found then raise exception 'no such user' using errcode = 'P0002'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Consent (platform use required; research optional)
-- ---------------------------------------------------------------------
create table public.consents (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  platform    boolean not null,
  research    boolean not null default false,
  updated_at  timestamptz not null default now()
);
alter table public.consents enable row level security;
revoke all on public.consents from anon, authenticated;
grant select on public.consents to authenticated;
create policy consents_select on public.consents for select to authenticated
  using (user_id = auth.uid() or public.is_instructor());
create trigger consents_audit after insert or update on public.consents
  for each row execute function public.audit_row();

create or replace function public.set_consent(p_platform boolean, p_research boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform public._require_user();
  if not coalesce(p_platform, false) then
    raise exception 'agreeing to use the platform is required to continue' using errcode = '22023';
  end if;
  insert into public.consents (user_id, platform, research) values (auth.uid(), true, coalesce(p_research, false))
  on conflict (user_id) do update set platform = true, research = excluded.research, updated_at = now();
  perform public._emit('consent_given', null, null, null, jsonb_build_object('research', coalesce(p_research, false)));
end $$;

-- ---------------------------------------------------------------------
-- Confidence on answers + spaced review
-- ---------------------------------------------------------------------
alter table public.answers add column confidence text check (confidence in ('guess', 'unsure', 'sure'));

create table public.srs_state (
  user_id        uuid not null references auth.users (id) on delete cascade,
  question_id    uuid not null references public.questions (id),
  ease           real not null default 2.5,
  interval_days  real not null default 0,
  reps           int  not null default 0,
  lapses         int  not null default 0,
  due_at         timestamptz not null default now(),
  last_rating    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (user_id, question_id)
);
create index srs_state_due_idx on public.srs_state (user_id, due_at);

create table public.card_reviews (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  question_id  uuid not null references public.questions (id),
  version_id   uuid references public.question_versions (id),
  rating       text not null check (rating in ('again', 'hard', 'good', 'easy')),
  mode         text not null check (mode in ('flashcard', 'mcq')),
  reviewed_at  timestamptz not null default now()
);
create index card_reviews_user_idx on public.card_reviews (user_id, reviewed_at desc);

create table public.bookmarks (
  user_id     uuid not null references auth.users (id) on delete cascade,
  topic       text not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, topic)
);

alter table public.srs_state    enable row level security;
alter table public.card_reviews enable row level security;
alter table public.bookmarks    enable row level security;
revoke all on public.srs_state, public.card_reviews, public.bookmarks from anon, authenticated;
grant select on public.srs_state, public.card_reviews, public.bookmarks to authenticated;
create policy srs_state_select on public.srs_state for select to authenticated using (user_id = auth.uid());
create policy card_reviews_select on public.card_reviews for select to authenticated using (user_id = auth.uid() or public.is_instructor());
create policy bookmarks_select on public.bookmarks for select to authenticated using (user_id = auth.uid());

-- The scheduler. New card: again 10 min, hard 1 d, good 3 d, easy 7 d.
create or replace function public._srs_apply(p_user uuid, p_question uuid, p_rating text)
returns public.srs_state language plpgsql security definer set search_path = ''
as $$
declare
  s public.srs_state;
  v_i real;
begin
  if p_rating not in ('again', 'hard', 'good', 'easy') then raise exception 'bad rating' using errcode = '22023'; end if;
  insert into public.srs_state (user_id, question_id) values (p_user, p_question)
  on conflict (user_id, question_id) do nothing;
  select * into s from public.srs_state where user_id = p_user and question_id = p_question for update;
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
  update public.srs_state set ease = s.ease, interval_days = s.interval_days, reps = s.reps, lapses = s.lapses,
         due_at = s.due_at, last_rating = p_rating, updated_at = now()
   where user_id = p_user and question_id = p_question;
  return s;
end $$;

-- Live practice items only.
create or replace function public._practice_version(p_question uuid)
returns uuid language sql stable security definer set search_path = ''
as $$
  select v.id from public.question_versions v join public.questions q on q.id = v.question_id
  where v.question_id = p_question and v.status = 'live' and q.pool = 'practice' and q.retired_at is null
$$;

-- Replace submit_answer: adds confidence, and feeds the spaced-review schedule.
drop function public.submit_answer(uuid, text);
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
   where v2.id = p_version and v2.status = 'live' and q.pool = 'practice' and q.retired_at is null;
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

-- Flashcard back: the keyed answer and explanation of a live practice item.
create or replace function public.reveal_card(p_version uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v public.question_versions; k public.question_keys;
begin
  perform public._require_user();
  select v2.* into v from public.question_versions v2 join public.questions q on q.id = v2.question_id
   where v2.id = p_version and v2.status = 'live' and q.pool = 'practice' and q.retired_at is null;
  if not found then raise exception 'card not available' using errcode = 'P0002'; end if;
  select * into k from public.question_keys where version_id = p_version;
  return jsonb_build_object('correct_option_id', k.correct_option_id,
    'answer', (select o ->> 'text' from jsonb_array_elements(v.options) o where o ->> 'id' = k.correct_option_id),
    'explanation', k.explanation);
end $$;

create or replace function public.review_card(p_question uuid, p_rating text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_version uuid; s public.srs_state;
begin
  perform public._require_user();
  v_version := public._practice_version(p_question);
  if v_version is null then raise exception 'card not available' using errcode = 'P0002'; end if;
  s := public._srs_apply(auth.uid(), p_question, p_rating);
  insert into public.card_reviews (user_id, question_id, version_id, rating, mode)
  values (auth.uid(), p_question, v_version, p_rating, 'flashcard');
  perform public._emit('card_reviewed', null, p_question, v_version, jsonb_build_object('rating', p_rating));
  return jsonb_build_object('due_at', s.due_at, 'interval_days', s.interval_days);
end $$;

-- Cards for a session.
--   p_mode 'due'    : cards due now, then up to 20 new cards a day
--   p_mode 'topics' : everything in p_topics, soonest due first
--   p_mode 'mixed'  : a random spread across every topic
create or replace function public.session_cards(p_mode text default 'due', p_topics text[] default null, p_limit int default 24)
returns table (version_id uuid, question_id uuid, stem text, options jsonb, niche text, topic text, lecture_id uuid,
               cascade_step text, reps int, interval_days real, ease real, due_at timestamptz, is_new boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare v_new_left int;
begin
  perform public._require_user();
  if p_mode not in ('due', 'topics', 'mixed') then raise exception 'bad mode' using errcode = '22023'; end if;
  select greatest(0, 20 - count(*))::int into v_new_left from public.srs_state s
   where s.user_id = auth.uid() and public._day(s.created_at) = public._today();
  return query
  with items as (
    select v.id as vid, v.question_id as qid, v.stem as vstem, v.options as vopts, v.niche as vniche, v.topic as vtopic,
           v.lecture_id as vlec, l.cascade_step as vcas, s.reps as sreps, s.interval_days as sint, s.ease as sease,
           s.due_at as sdue, (s.user_id is null) as fresh
    from public.question_versions v
    join public.questions q on q.id = v.question_id and q.pool = 'practice' and q.retired_at is null
    left join public.lectures l on l.id = v.lecture_id
    left join public.srs_state s on s.question_id = v.question_id and s.user_id = auth.uid()
    where v.status = 'live'
  ), picked as (
    select i.*, 0 as grp, i.sdue as ord from items i where p_mode = 'due' and not i.fresh and i.sdue <= now()
    union all
    select x.* from (select i.*, 1 as grp, null::timestamptz as ord from items i
                      where p_mode = 'due' and i.fresh order by md5(i.qid::text || auth.uid()::text) limit v_new_left) x
    union all
    select i.*, 0, coalesce(i.sdue, '-infinity'::timestamptz) from items i where p_mode = 'topics' and i.vtopic = any (coalesce(p_topics, '{}'))
    union all
    select i.*, 0, null::timestamptz from items i where p_mode = 'mixed'
  )
  select p.vid, p.qid, p.vstem, p.vopts, p.vniche, p.vtopic, p.vlec, p.vcas, coalesce(p.sreps, 0), coalesce(p.sint, 0),
         coalesce(p.sease, 2.5), p.sdue, p.fresh
  from picked p
  order by p.grp, case when p_mode = 'mixed' then random() end, p.ord nulls last
  limit greatest(1, least(p_limit, 200));
end $$;

create or replace function public.toggle_bookmark(p_topic text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_on boolean;
begin
  perform public._require_user();
  if cardinality(public.vocab_missing('topic', array[p_topic])) > 0 then
    raise exception 'unknown topic' using errcode = '22023';
  end if;
  delete from public.bookmarks where user_id = auth.uid() and topic = p_topic;
  if found then v_on := false;
  else insert into public.bookmarks (user_id, topic) values (auth.uid(), p_topic); v_on := true; end if;
  perform public._emit('bookmark_changed', null, null, null, jsonb_build_object('topic', p_topic, 'on', v_on));
  return v_on;
end $$;

-- ---------------------------------------------------------------------
-- Lecture read status
-- ---------------------------------------------------------------------
create or replace function public.mark_lecture_read(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform public._require_user();
  if not exists (select 1 from public.lectures where id = p_id and status = 'published') then
    raise exception 'lecture not found' using errcode = 'P0002';
  end if;
  perform public._emit('lecture_completed', p_id);
end $$;

create or replace function public.my_lecture_status()
returns table (lecture_id uuid, viewed boolean, completed boolean, last_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select e.lecture_id, bool_or(e.event_type = 'lecture_viewed'), bool_or(e.event_type = 'lecture_completed'), max(e.created_at)
  from public.content_events e
  where e.user_id = auth.uid() and e.lecture_id is not null and e.event_type in ('lecture_viewed', 'lecture_completed')
  group by e.lecture_id
$$;

-- ---------------------------------------------------------------------
-- Streaks. Active day = any recorded study activity (Bangkok time).
-- A single missed day pauses the streak; two in a row reset it.
-- ---------------------------------------------------------------------
create or replace function public._streak(p_user uuid, out current int, out best int)
language plpgsql stable security definer set search_path = ''
as $$
declare d date; prev date := null; run int := 0;
begin
  current := 0; best := 0;
  for d in select distinct public._day(created_at) from public.content_events
            where user_id = p_user and event_type in ('lecture_viewed', 'lecture_completed', 'question_answered',
                                                      'card_reviewed', 'exam_submitted')
            order by 1 loop
    if prev is null or d - prev > 2 then run := 1; else run := run + 1; end if;
    best := greatest(best, run);
    prev := d;
  end loop;
  if prev is not null and public._today() - prev <= 2 then current := run; end if;
end $$;

-- ---------------------------------------------------------------------
-- Exams: pre-test and monthly check-in
-- ---------------------------------------------------------------------
create table public.exams (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('pretest', 'monthly')),
  title         text not null check (length(btrim(title)) > 0),
  cohort_id     uuid references public.cohorts (id) on delete set null,   -- null = every student
  opens_at      timestamptz not null default now(),
  closes_at     timestamptz,
  duration_min  int not null default 30 check (duration_min between 5 and 240),
  status        text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  created_by    uuid not null references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create table public.exam_items (
  exam_id      uuid not null references public.exams (id) on delete cascade,
  position     int  not null check (position > 0),
  question_id  uuid not null references public.questions (id),
  version_id   uuid not null references public.question_versions (id),
  primary key (exam_id, position),
  unique (exam_id, question_id)
);
create table public.exam_attempts (
  id            uuid primary key default gen_random_uuid(),
  exam_id       uuid not null references public.exams (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  started_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  n_correct     int,
  n_total       int,
  score         numeric,
  unique (exam_id, user_id)
);
create table public.exam_responses (
  attempt_id        uuid not null references public.exam_attempts (id) on delete cascade,
  position          int  not null,
  version_id        uuid not null references public.question_versions (id),
  chosen_option_id  text,
  confidence        text check (confidence in ('guess', 'unsure', 'sure')),
  flagged           boolean not null default false,
  is_correct        boolean,
  answered_at       timestamptz not null default now(),
  primary key (attempt_id, position)
);

alter table public.exams          enable row level security;
alter table public.exam_items     enable row level security;
alter table public.exam_attempts  enable row level security;
alter table public.exam_responses enable row level security;
revoke all on public.exams, public.exam_items, public.exam_attempts, public.exam_responses from anon, authenticated;
grant select on public.exams, public.exam_items, public.exam_attempts, public.exam_responses to authenticated;

create or replace function public._my_cohort()
returns uuid language sql stable security definer set search_path = ''
as $$ select cohort_id from public.profiles where id = auth.uid() $$;

create policy exams_select on public.exams for select to authenticated
  using (public.is_instructor() or (status <> 'draft' and (cohort_id is null or cohort_id = public._my_cohort())));
create policy exam_items_select on public.exam_items for select to authenticated using (public.is_instructor());
create policy exam_attempts_select on public.exam_attempts for select to authenticated
  using (user_id = auth.uid() or public.is_instructor());
create policy exam_responses_select on public.exam_responses for select to authenticated using (public.is_instructor());

create trigger exams_audit after insert or update or delete on public.exams
  for each row execute function public.audit_row();
create trigger exam_items_audit after insert or delete on public.exam_items
  for each row execute function public.audit_row();

-- p: {id?, kind, title, cohort_id, opens_at, closes_at, duration_min}
create or replace function public.save_exam(p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; e public.exams;
begin
  perform public._require_instructor();
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
end $$;

-- Items must be live in the pool matching the exam kind (pre-test pool / monthly pool).
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
     where v.question_id = v_q and v.status = 'live' and q.pool = e.kind and q.retired_at is null;
    if v_ver is null then
      raise exception 'item % is not live in the % pool', left(v_q::text, 8), e.kind using errcode = '22023';
    end if;
    v_pos := v_pos + 1;
    insert into public.exam_items (exam_id, position, question_id, version_id) values (p_exam, v_pos, v_q, v_ver);
  end loop;
  return v_pos;
end $$;

-- Pick p_n live items from the matching pool, spread across niches.
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
    where v.status = 'live' and q.pool = e.kind and q.retired_at is null
  ) x where x.rn is not null;
  v_ids := v_ids[1:greatest(0, p_n)];
  return public.set_exam_items(p_exam, v_ids);
end $$;

create or replace function public.set_exam_status(p_exam uuid, p_status text)
returns void language plpgsql security definer set search_path = ''
as $$
declare e public.exams; v_missing int;
begin
  perform public._require_instructor();
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
end $$;

-- ---- student side ----------------------------------------------------
create or replace function public._exam_visible(e public.exams)
returns boolean language sql stable security definer set search_path = ''
as $$ select e.status <> 'draft' and (e.cohort_id is null or e.cohort_id = public._my_cohort()) $$;

create or replace function public.my_exams()
returns table (exam_id uuid, kind text, title text, opens_at timestamptz, closes_at timestamptz, duration_min int,
               status text, n_items int, attempt_id uuid, started_at timestamptz, submitted_at timestamptz, score numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._require_user();
  return query
  select e.id, e.kind, e.title, e.opens_at, e.closes_at, e.duration_min, e.status,
         (select count(*) from public.exam_items i where i.exam_id = e.id)::int,
         a.id, a.started_at, a.submitted_at, a.score
  from public.exams e
  left join public.exam_attempts a on a.exam_id = e.id and a.user_id = auth.uid()
  where public._exam_visible(e)
  order by e.opens_at;
end $$;

create or replace function public._exam_result(p_attempt uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'attempt_id', a.id, 'exam_id', a.exam_id, 'kind', e.kind, 'title', e.title,
    'score', a.score, 'n_correct', a.n_correct, 'n_total', a.n_total, 'submitted_at', a.submitted_at,
    'by_niche', coalesce((
      select jsonb_agg(jsonb_build_object('niche', x.niche, 'pct', x.pct, 'n', x.n) order by x.pct desc)
      from (select v.niche, count(*) as n,
                   round(100.0 * count(*) filter (where r.is_correct) / count(*), 0) as pct
            from public.exam_items i
            join public.question_versions v on v.id = i.version_id
            left join public.exam_responses r on r.attempt_id = a.id and r.position = i.position
            where i.exam_id = a.exam_id group by v.niche) x), '[]'))
  from public.exam_attempts a join public.exams e on e.id = a.exam_id
  where a.id = p_attempt
$$;

create or replace function public.start_exam(p_exam uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare e public.exams; a public.exam_attempts;
begin
  perform public._require_user();
  select * into e from public.exams where id = p_exam;
  if not found or not public._exam_visible(e) then raise exception 'exam not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.consents c where c.user_id = auth.uid() and c.platform) then
    raise exception 'record your consent before starting' using errcode = '42501';
  end if;
  select * into a from public.exam_attempts where exam_id = p_exam and user_id = auth.uid();
  if found and a.submitted_at is not null then raise exception 'you have already submitted this exam' using errcode = '55000'; end if;
  if not found then
    if e.status <> 'open' or now() < e.opens_at or (e.closes_at is not null and now() > e.closes_at) then
      raise exception 'this exam is not open' using errcode = '55000';
    end if;
    insert into public.exam_attempts (exam_id, user_id) values (p_exam, auth.uid()) returning * into a;
    perform public._emit('exam_started', null, null, null, jsonb_build_object('exam_id', p_exam, 'kind', e.kind));
  end if;
  return jsonb_build_object(
    'attempt_id', a.id, 'exam_id', e.id, 'kind', e.kind, 'title', e.title,
    'started_at', a.started_at, 'duration_min', e.duration_min,
    'deadline', a.started_at + make_interval(mins => e.duration_min),
    'items', (select jsonb_agg(jsonb_build_object('position', i.position, 'stem', v.stem, 'options', v.options, 'niche', v.niche)
                               order by i.position)
              from public.exam_items i join public.question_versions v on v.id = i.version_id where i.exam_id = e.id),
    'responses', coalesce((select jsonb_agg(jsonb_build_object('position', r.position, 'option', r.chosen_option_id,
                                     'confidence', r.confidence, 'flagged', r.flagged))
                           from public.exam_responses r where r.attempt_id = a.id), '[]'));
end $$;

create or replace function public.save_exam_response(p_attempt uuid, p_position int, p_option text,
                                                    p_confidence text default null, p_flagged boolean default false)
returns void language plpgsql security definer set search_path = ''
as $$
declare a public.exam_attempts; e public.exams; i public.exam_items;
begin
  perform public._require_user();
  select * into a from public.exam_attempts where id = p_attempt and user_id = auth.uid() for update;
  if not found then raise exception 'attempt not found' using errcode = 'P0002'; end if;
  if a.submitted_at is not null then raise exception 'already submitted' using errcode = '55000'; end if;
  select * into e from public.exams where id = a.exam_id;
  if now() > a.started_at + make_interval(mins => e.duration_min + 2) then
    raise exception 'time is up; submit your answers' using errcode = '55000';
  end if;
  select * into i from public.exam_items where exam_id = a.exam_id and position = p_position;
  if not found then raise exception 'no such question' using errcode = 'P0002'; end if;
  if p_option is not null and not exists (select 1 from public.question_versions v, jsonb_array_elements(v.options) o
                                           where v.id = i.version_id and o ->> 'id' = p_option) then
    raise exception 'not an option of this question' using errcode = '22023';
  end if;
  if p_confidence is not null and p_confidence not in ('guess', 'unsure', 'sure') then
    raise exception 'bad confidence' using errcode = '22023';
  end if;
  insert into public.exam_responses (attempt_id, position, version_id, chosen_option_id, confidence, flagged)
  values (p_attempt, p_position, i.version_id, p_option, p_confidence, coalesce(p_flagged, false))
  on conflict (attempt_id, position) do update
    set chosen_option_id = excluded.chosen_option_id, confidence = excluded.confidence,
        flagged = excluded.flagged, answered_at = now();
end $$;

create or replace function public.submit_exam(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare a public.exam_attempts; v_total int; v_right int;
begin
  perform public._require_user();
  select * into a from public.exam_attempts where id = p_attempt and user_id = auth.uid() for update;
  if not found then raise exception 'attempt not found' using errcode = 'P0002'; end if;
  if a.submitted_at is null then
    update public.exam_responses r set is_correct = (r.chosen_option_id = k.correct_option_id)
      from public.question_keys k where r.attempt_id = p_attempt and k.version_id = r.version_id;
    select count(*) into v_total from public.exam_items where exam_id = a.exam_id;
    select count(*) into v_right from public.exam_responses where attempt_id = p_attempt and is_correct;
    update public.exam_attempts set submitted_at = now(), n_total = v_total, n_correct = v_right,
           score = case when v_total > 0 then round(100.0 * v_right / v_total, 1) end
     where id = p_attempt;
    perform public._emit('exam_submitted', null, null, null, jsonb_build_object('exam_id', a.exam_id));
  end if;
  return public._exam_result(p_attempt);
end $$;

create or replace function public.exam_result(p_attempt uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._require_user();
  if not exists (select 1 from public.exam_attempts where id = p_attempt and submitted_at is not null
                 and (user_id = auth.uid() or public.is_instructor())) then
    raise exception 'result not found' using errcode = 'P0002';
  end if;
  return public._exam_result(p_attempt);
end $$;

-- What the student app needs at start-up: consent, cohort, pre-test gate, streak, cards due.
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
                   where v.status = 'live' and q.pool = 'practice' and q.retired_at is null
                     and not exists (select 1 from public.srs_state s where s.user_id = auth.uid() and s.question_id = v.question_id)),
    'bookmarks', coalesce((select jsonb_agg(b.topic order by b.created_at) from public.bookmarks b where b.user_id = auth.uid()), '[]'));
end $$;

-- ---------------------------------------------------------------------
-- Student progress (Home + Progress pages)
-- ---------------------------------------------------------------------
create or replace function public.my_progress(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, p_days));
  v_prev  timestamptz := now() - make_interval(days => 2 * greatest(1, p_days));
  st record;
  v_week_start date := public._today() - (extract(isodow from public._today())::int - 1);
begin
  perform public._require_user();
  select * into st from public._streak(auth.uid());
  return jsonb_build_object(
    'days', p_days,
    'avg', (select round(100.0 * count(*) filter (where is_correct) / nullif(count(*), 0), 0)
              from public.answers where user_id = auth.uid() and answered_at >= v_since),
    'prev_avg', (select round(100.0 * count(*) filter (where is_correct) / nullif(count(*), 0), 0)
              from public.answers where user_id = auth.uid() and answered_at >= v_prev and answered_at < v_since),
    'answered', (select count(*) from public.answers where user_id = auth.uid() and answered_at >= v_since),
    'streak', st.current, 'best_streak', st.best,
    'week', (select jsonb_agg(jsonb_build_object('date', d::date, 'active', exists (
                select 1 from public.content_events e where e.user_id = auth.uid()
                  and public._day(e.created_at) = d::date
                  and e.event_type in ('lecture_viewed', 'lecture_completed', 'question_answered', 'card_reviewed', 'exam_submitted')),
                'future', d::date > public._today()) order by d)
             from generate_series(v_week_start, v_week_start + 6, interval '1 day') d),
    'by_niche', coalesce((select jsonb_agg(jsonb_build_object('niche', x.niche, 'pct', x.pct, 'n', x.n) order by x.pct desc)
       from (select v.niche, count(*) n, round(100.0 * count(*) filter (where a.is_correct) / count(*), 0) pct
             from public.answers a join public.question_versions v on v.id = a.version_id
             where a.user_id = auth.uid() and a.answered_at >= v_since group by v.niche) x), '[]'),
    'by_topic', coalesce((select jsonb_agg(jsonb_build_object('topic', x.topic, 'niche', x.niche, 'pct', x.pct, 'n', x.n,
                                  'wrong', x.wrong, 'cascade_step', x.cas) order by x.pct, x.n desc)
       from (select v.topic, mode() within group (order by v.niche) niche, count(*) n,
                    count(*) filter (where not a.is_correct) wrong,
                    round(100.0 * count(*) filter (where a.is_correct) / count(*), 0) pct,
                    mode() within group (order by l.cascade_step) cas
             from public.answers a join public.question_versions v on v.id = a.version_id
             left join public.lectures l on l.id = v.lecture_id
             where a.user_id = auth.uid() and a.answered_at >= v_since group by v.topic) x), '[]'),
    'confidence', (select jsonb_build_object(
          'sure_pct', round(100.0 * count(*) filter (where confidence = 'sure' and is_correct) / nullif(count(*) filter (where confidence = 'sure'), 0), 0),
          'sure_n', count(*) filter (where confidence = 'sure'),
          'unsure_pct', round(100.0 * count(*) filter (where confidence = 'unsure' and is_correct) / nullif(count(*) filter (where confidence = 'unsure'), 0), 0),
          'guess_pct', round(100.0 * count(*) filter (where confidence = 'guess' and is_correct) / nullif(count(*) filter (where confidence = 'guess'), 0), 0),
          'guess_n', count(*) filter (where confidence = 'guess'),
          'confidently_wrong_pct', round(100.0 * count(*) filter (where confidence = 'sure' and not is_correct) / nullif(count(*) filter (where confidence is not null), 0), 0))
        from public.answers where user_id = auth.uid() and answered_at >= v_since),
    'covered', jsonb_build_object(
        'seen', (select count(distinct o) from public.answers a join public.question_versions v on v.id = a.version_id,
                        unnest(v.organism_ids) o where a.user_id = auth.uid()),
        'total', (select count(*) from public.vocab where kind = 'organism' and active)),
    'timeline', coalesce((select jsonb_agg(t order by t ->> 'at') from (
        select jsonb_build_object('label', case e.kind when 'pretest' then 'Pre-test' else 'Check-in' end, 'kind', 'exam',
                                  'pct', a.score, 'at', to_char(a.submitted_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD"T"HH24:MI')) as t
          from public.exam_attempts a join public.exams e on e.id = a.exam_id
         where a.user_id = auth.uid() and a.submitted_at is not null
        union all
        select jsonb_build_object('label', 'Wk of ' || to_char(w, 'DD Mon'), 'kind', 'week', 'pct',
                                  round(100.0 * count(*) filter (where a.is_correct) / count(*), 0), 'at', to_char(w + interval '3 days', 'YYYY-MM-DD"T"HH24:MI'))
          from public.answers a, lateral (select date_trunc('week', a.answered_at at time zone 'Asia/Bangkok') as w) wk
         where a.user_id = auth.uid() and a.answered_at >= v_since
         group by w) s), '[]'),
    'last_lecture', (select jsonb_build_object('id', l.id, 'number', l.number, 'title', l.title)
                       from public.content_events e join public.lectures l on l.id = e.lecture_id and l.status = 'published'
                      where e.user_id = auth.uid() and e.event_type = 'lecture_viewed'
                      order by e.created_at desc limit 1),
    'recent', (select jsonb_build_object('n', count(*), 'wrong', count(*) filter (where not x.is_correct), 'topic', max(x.topic))
                 from (select a.is_correct, v.topic from public.answers a join public.question_versions v on v.id = a.version_id
                        where a.user_id = auth.uid()
                          and v.topic = (select v2.topic from public.answers a2 join public.question_versions v2 on v2.id = a2.version_id
                                          where a2.user_id = auth.uid() and a2.answered_at >= v_since
                                          group by v2.topic having count(*) >= 3
                                          order by avg(case when a2.is_correct then 1.0 else 0 end), count(*) desc limit 1)
                        order by a.answered_at desc limit 8) x),
    'confidently_wrong', coalesce((select jsonb_agg(distinct v.question_id) from public.answers a
                         join public.question_versions v on v.id = a.version_id
                        where a.user_id = auth.uid() and a.confidence = 'sure' and not a.is_correct and a.answered_at >= v_since), '[]')
  );
end $$;

-- ---------------------------------------------------------------------
-- Instructor reporting, filtered by cohort and period
-- ---------------------------------------------------------------------
create or replace function public._in_cohort(p_user uuid, p_cohort uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select p_cohort is null or exists (select 1 from public.profiles where id = p_user and cohort_id = p_cohort) $$;

drop function public.student_summary();
create or replace function public.student_summary(p_cohort uuid default null, p_days int default null)
returns table (user_id uuid, code text, display_name text, email text, role public.app_role, cohort_id uuid, cohort text,
               answers int, pct_correct numeric, prev_pct numeric, confidently_wrong_pct numeric, active_days int,
               lectures_viewed int, last_active timestamptz, joined timestamptz, research_consent boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare v_since timestamptz := case when p_days is null then '-infinity' else now() - make_interval(days => p_days) end;
        v_prev timestamptz := case when p_days is null then '-infinity' else now() - make_interval(days => 2 * p_days) end;
begin
  perform public._require_instructor();
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
  where p_cohort is null or p.cohort_id = p_cohort
  order by p.role desc, p.display_name;
end $$;

drop function public.item_stats();
create or replace function public.item_stats(p_cohort uuid default null, p_days int default null)
returns table (question_id uuid, version_id uuid, version int, stem text, topic text, niche text, n int, pct_correct numeric,
               discrimination numeric, option_counts jsonb, correct_option_id text)
language plpgsql stable security definer set search_path = ''
as $$
declare v_since timestamptz := case when p_days is null then '-infinity' else now() - make_interval(days => p_days) end;
begin
  perform public._require_instructor();
  return query
  with first_attempts as (
    select distinct on (a.user_id, a.version_id) a.*
    from public.answers a
    where a.answered_at >= v_since and public._in_cohort(a.user_id, p_cohort)
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
  where v.status in ('live', 'superseded', 'retired')
  group by v.question_id, v.id, v.version, v.stem, v.topic, v.niche, k.correct_option_id;
end $$;

-- Overview page: headline numbers, students to check in with, topic accuracy by week.
create or replace function public.cohort_overview(p_cohort uuid default null, p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(7, p_days));
  v_weeks date[];
  v_monthly public.exams;
begin
  perform public._require_instructor();
  select array_agg(w order by w) into v_weeks from (
    select distinct date_trunc('week', a.answered_at at time zone 'Asia/Bangkok')::date as w
    from public.answers a where a.answered_at >= v_since and public._in_cohort(a.user_id, p_cohort)
    order by 1 desc limit 6) x;
  select * into v_monthly from public.exams e
   where e.kind = 'monthly' and e.status <> 'draft' and e.opens_at <= now()
     and (p_cohort is null or e.cohort_id is null or e.cohort_id = p_cohort)
   order by e.opens_at desc limit 1;

  return jsonb_build_object(
    'students', (select count(*) from public.profiles p where p.role = 'student' and (p_cohort is null or p.cohort_id = p_cohort)),
    'active_week', (select count(distinct e.user_id) from public.content_events e join public.profiles p on p.id = e.user_id
                     where p.role = 'student' and e.created_at >= now() - interval '7 days'
                       and (p_cohort is null or p.cohort_id = p_cohort)),
    'avg', (select round(100.0 * count(*) filter (where a.is_correct) / nullif(count(*), 0), 0) from public.answers a
             join public.profiles p on p.id = a.user_id
            where p.role = 'student' and a.answered_at >= v_since and (p_cohort is null or p.cohort_id = p_cohort)),
    'pretest_avg', (select round(avg(a.score), 0) from public.exam_attempts a join public.exams e on e.id = a.exam_id
                     join public.profiles p on p.id = a.user_id
                    where e.kind = 'pretest' and a.submitted_at is not null and (p_cohort is null or p.cohort_id = p_cohort)),
    'checkin', case when v_monthly.id is null then null else jsonb_build_object(
        'title', v_monthly.title, 'opens_at', v_monthly.opens_at,
        'done', (select count(*) from public.exam_attempts a join public.profiles p on p.id = a.user_id
                  where a.exam_id = v_monthly.id and a.submitted_at is not null and (p_cohort is null or p.cohort_id = p_cohort))) end,
    'weeks', coalesce((select jsonb_agg(to_char(w, 'YYYY-MM-DD') order by w) from unnest(v_weeks) w), '[]'),
    'topics', coalesce((select jsonb_agg(jsonb_build_object('topic', t.topic, 'pretest', t.pre, 'weeks', t.cells) order by t.topic)
      from (select tp.topic,
              (select round(100.0 * count(*) filter (where r.is_correct) / nullif(count(*), 0), 0)
                 from public.exam_responses r join public.exam_attempts xa on xa.id = r.attempt_id
                 join public.exams ex on ex.id = xa.exam_id and ex.kind = 'pretest'
                 join public.question_versions v on v.id = r.version_id
                where xa.submitted_at is not null and v.topic = tp.topic and public._in_cohort(xa.user_id, p_cohort)) as pre,
              (select jsonb_agg((select round(100.0 * count(*) filter (where a.is_correct) / nullif(count(*), 0), 0)
                                   from public.answers a join public.question_versions v on v.id = a.version_id
                                  where v.topic = tp.topic and public._in_cohort(a.user_id, p_cohort)
                                    and date_trunc('week', a.answered_at at time zone 'Asia/Bangkok')::date = w) order by w)
                 from unnest(coalesce(v_weeks, '{}')) w) as cells
            from (select distinct v.topic from public.answers a join public.question_versions v on v.id = a.version_id
                   where a.answered_at >= v_since and public._in_cohort(a.user_id, p_cohort)
                  union
                  select distinct v.topic from public.exam_responses r join public.question_versions v on v.id = r.version_id
                    join public.exam_attempts xa on xa.id = r.attempt_id
                   where public._in_cohort(xa.user_id, p_cohort)) tp) t), '[]'),
    'monthly_exam_id', v_monthly.id
  );
end $$;

create or replace function public.log_names_shown()
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform public._require_instructor();
  perform public._emit('names_shown');
end $$;

-- Exams tab
create or replace function public.exam_list(p_cohort uuid default null)
returns table (id uuid, kind text, title text, cohort_id uuid, cohort text, opens_at timestamptz, closes_at timestamptz,
               duration_min int, status text, n_items int, started int, submitted int, avg_score numeric, eligible int)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._require_instructor();
  return query
  select e.id, e.kind, e.title, e.cohort_id, c.name, e.opens_at, e.closes_at, e.duration_min, e.status,
         (select count(*) from public.exam_items i where i.exam_id = e.id)::int,
         (select count(*) from public.exam_attempts a where a.exam_id = e.id)::int,
         (select count(*) from public.exam_attempts a where a.exam_id = e.id and a.submitted_at is not null)::int,
         (select round(avg(a.score), 1) from public.exam_attempts a where a.exam_id = e.id and a.submitted_at is not null),
         (select count(*) from public.profiles p where p.role = 'student' and (e.cohort_id is null or p.cohort_id = e.cohort_id))::int
  from public.exams e left join public.cohorts c on c.id = e.cohort_id
  where p_cohort is null or e.cohort_id is null or e.cohort_id = p_cohort
  order by e.opens_at desc;
end $$;

-- One exam: items with difficulty, attempts, KR-20 reliability.
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
                  where v.status = 'live' and q.pool = e.kind and q.retired_at is null)
  );
end $$;

-- Research dataset: pseudonymous, only students who agreed to research use.
create or replace function public.research_export(p_cohort uuid default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._require_instructor();
  return jsonb_build_object(
    'consented', (select count(*) from public.consents cs join public.profiles p on p.id = cs.user_id
                   where cs.research and p.role = 'student' and (p_cohort is null or p.cohort_id = p_cohort)),
    'students', (select count(*) from public.profiles p where p.role = 'student' and (p_cohort is null or p.cohort_id = p_cohort)),
    'answers', coalesce((select jsonb_agg(jsonb_build_object('student', public._user_code(a.user_id), 'question_id', v.question_id,
              'version', v.version, 'topic', v.topic, 'niche', v.niche, 'correct', a.is_correct, 'confidence', a.confidence,
              'answered_at', a.answered_at) order by a.answered_at)
       from public.answers a join public.question_versions v on v.id = a.version_id
       join public.consents cs on cs.user_id = a.user_id and cs.research
       join public.profiles p on p.id = a.user_id and p.role = 'student'
      where p_cohort is null or p.cohort_id = p_cohort), '[]'),
    'exams', coalesce((select jsonb_agg(jsonb_build_object('student', public._user_code(a.user_id), 'exam_id', a.exam_id,
              'kind', e.kind, 'title', e.title, 'score', a.score, 'n_correct', a.n_correct, 'n_total', a.n_total,
              'submitted_at', a.submitted_at))
       from public.exam_attempts a join public.exams e on e.id = a.exam_id
       join public.consents cs on cs.user_id = a.user_id and cs.research
       join public.profiles p on p.id = a.user_id and p.role = 'student'
      where a.submitted_at is not null and (p_cohort is null or p.cohort_id = p_cohort)), '[]'));
end $$;

-- ---------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------
revoke execute on function public._srs_apply(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public._streak(uuid) from public, anon, authenticated;
revoke execute on function public._exam_result(uuid) from public, anon, authenticated;
revoke execute on function public._require_user() from public, anon, authenticated;
revoke execute on function public._user_code(uuid) from public, anon;
revoke execute on function public._practice_version(uuid) from public, anon, authenticated;
revoke execute on function public._in_cohort(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._exam_visible(public.exams) from public, anon, authenticated;
revoke execute on function public._my_cohort() from public, anon;
grant execute on function public._my_cohort() to authenticated;   -- used inside RLS

do $$
declare f text;
begin
  foreach f in array array[
    'save_cohort(text, date, uuid)', 'set_student_cohort(uuid, uuid)', 'set_consent(boolean, boolean)',
    'submit_answer(uuid, text, text)', 'reveal_card(uuid)', 'review_card(uuid, text)',
    'session_cards(text, text[], int)', 'toggle_bookmark(text)', 'mark_lecture_read(uuid)', 'my_lecture_status()',
    'save_exam(jsonb)', 'set_exam_items(uuid, uuid[])', 'pick_exam_items(uuid, int)', 'set_exam_status(uuid, text)',
    'my_exams()', 'start_exam(uuid)', 'save_exam_response(uuid, int, text, text, boolean)', 'submit_exam(uuid)',
    'exam_result(uuid)', 'my_status()', 'my_progress(int)', 'student_summary(uuid, int)', 'item_stats(uuid, int)',
    'cohort_overview(uuid, int)', 'log_names_shown()', 'exam_list(uuid)', 'exam_detail(uuid)', 'research_export(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
