-- =====================================================================
-- 0002 instructor authoring — lectures, versioned questions, answer keys,
-- review workflow, student answers, item statistics.
--
-- Decisions (confirmed 2026-10-29)
--   * One approval by an instructor other than the version's author.
--   * Instructors see their own drafts plus anything submitted, approved,
--     live, superseded or retired. Admins see everything.
--   * Lecture summaries are plain text, one bullet per line.
--
-- Question lifecycle (per version)
--   draft -> in_review -> approved -> live -> superseded | retired
--             \-> (returned) draft
-- Only one version per question may be live, and only one may be open
-- (draft / in_review / approved). Editing a live item opens a new version;
-- the live version keeps serving students until the new one goes live.
-- Non-draft versions are immutable, so every answer stays linked to exactly
-- the text the student saw.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Lectures
-- ---------------------------------------------------------------------
create table public.lectures (
  id            uuid primary key default gen_random_uuid(),
  number        int  not null check (number > 0),
  title         text not null check (length(btrim(title)) > 0),
  niche         text not null,
  summary       text not null default '',          -- plain text, one bullet per line
  disease_ids   text[] not null default '{}',
  organism_ids  text[] not null default '{}',
  cascade_step  text,
  status        text not null default 'draft' check (status in ('draft', 'published')),
  author_id     uuid not null references auth.users (id),
  updated_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  published_at  timestamptz
);
create unique index lectures_published_number_uq on public.lectures (number) where status = 'published';

alter table public.content_events
  add constraint content_events_lecture_fk foreign key (lecture_id) references public.lectures (id) on delete set null;

alter table public.lectures enable row level security;
revoke all on public.lectures from anon, authenticated;
grant select on public.lectures to authenticated;
create policy lectures_select on public.lectures for select to authenticated
  using (status = 'published'
         or (public.is_instructor() and (author_id = auth.uid() or public.is_admin())));

create trigger lectures_audit after insert or update or delete on public.lectures
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- Questions, versions, keys, reviews, answers
-- ---------------------------------------------------------------------
create table public.questions (
  id               uuid primary key default gen_random_uuid(),
  pool             text not null default 'practice' check (pool in ('practice', 'pretest', 'monthly')),
  author_id        uuid not null references auth.users (id),
  source           text not null default 'manual' check (source in ('manual', 'import', 'ai', 'duplicate')),
  duplicated_from  uuid references public.questions (id),
  retired_at       timestamptz,
  retired_by       uuid references auth.users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.question_versions (
  id            uuid primary key default gen_random_uuid(),
  question_id   uuid not null references public.questions (id),
  version       int  not null,
  status        text not null default 'draft'
                check (status in ('draft', 'in_review', 'approved', 'live', 'superseded', 'retired')),
  stem          text not null,
  options       jsonb not null,           -- [{"id":"A","text":"..."}, ...] 3 to 5 entries
  niche         text not null,
  topic         text not null,
  lecture_id    uuid not null references public.lectures (id),
  organism_ids  text[] not null default '{}',
  disease_ids   text[] not null default '{}',
  tier          text,
  failure_mode  text,
  bloom         text,
  difficulty    text,
  author_id     uuid not null references auth.users (id),   -- who wrote THIS version
  submitted_at  timestamptz,
  approved_by   uuid references auth.users (id),
  approved_at   timestamptz,
  live_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (question_id, version)
);
create unique index question_versions_one_live on public.question_versions (question_id) where status = 'live';
create unique index question_versions_one_open on public.question_versions (question_id)
  where status in ('draft', 'in_review', 'approved');
create index question_versions_stem_trgm on public.question_versions using gin (stem extensions.gin_trgm_ops);
create index question_versions_lecture_idx on public.question_versions (lecture_id);

-- Answer keys and explanations. Never readable by students; written only by functions.
create table public.question_keys (
  version_id         uuid primary key references public.question_versions (id),
  correct_option_id  text not null,
  explanation        text not null check (length(btrim(explanation)) > 0)
);

create table public.question_reviews (
  id           uuid primary key default gen_random_uuid(),
  version_id   uuid not null references public.question_versions (id),
  reviewer_id  uuid not null references auth.users (id),
  decision     text not null check (decision in ('approved', 'returned')),
  comment      text,
  created_at   timestamptz not null default now()
);

create table public.answers (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references auth.users (id) on delete cascade,
  version_id        uuid not null references public.question_versions (id),
  chosen_option_id  text not null,
  is_correct        boolean not null,
  answered_at       timestamptz not null default now()
);
create index answers_version_idx on public.answers (version_id);
create index answers_user_idx on public.answers (user_id, answered_at desc);

-- Content of a version is frozen once it leaves draft.
create or replace function public.freeze_question_version()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.status <> 'draft' and (
       new.stem, new.options, new.niche, new.topic, new.lecture_id, new.organism_ids, new.disease_ids,
       new.tier, new.failure_mode, new.bloom, new.difficulty, new.question_id, new.version, new.author_id)
     is distinct from (
       old.stem, old.options, old.niche, old.topic, old.lecture_id, old.organism_ids, old.disease_ids,
       old.tier, old.failure_mode, old.bloom, old.difficulty, old.question_id, old.version, old.author_id) then
    raise exception 'question version % is %, its content cannot change; edit to create a new version', old.id, old.status
      using errcode = '55000';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger question_versions_freeze before update on public.question_versions
  for each row execute function public.freeze_question_version();

create or replace function public.freeze_question_key()
returns trigger
language plpgsql set search_path = ''
as $$
declare v_status text;
begin
  select status into v_status from public.question_versions where id = old.version_id;
  if v_status <> 'draft' then
    raise exception 'answer key for a % version cannot change', v_status using errcode = '55000';
  end if;
  return new;
end $$;
create trigger question_keys_freeze before update or delete on public.question_keys
  for each row execute function public.freeze_question_key();

create trigger questions_audit after insert or update or delete on public.questions
  for each row execute function public.audit_row();
create trigger question_versions_audit after insert or update or delete on public.question_versions
  for each row execute function public.audit_row();
create trigger question_keys_audit after insert or update or delete on public.question_keys
  for each row execute function public.audit_row();
create trigger question_reviews_audit after insert on public.question_reviews
  for each row execute function public.audit_row();

-- ---- RLS ------------------------------------------------------------
alter table public.questions        enable row level security;
alter table public.question_versions enable row level security;
alter table public.question_keys    enable row level security;
alter table public.question_reviews enable row level security;
alter table public.answers          enable row level security;

revoke all on public.questions, public.question_versions, public.question_keys,
              public.question_reviews, public.answers from anon, authenticated;
grant select on public.questions, public.question_versions, public.question_reviews, public.answers to authenticated;
grant select on public.question_keys to authenticated;   -- RLS limits this to instructors

-- Can the caller (an instructor) see this version?
create or replace function public.can_see_version(p_status text, p_author uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_instructor()
     and (p_status <> 'draft' or p_author = auth.uid() or public.is_admin())
$$;

-- Definer helpers so the questions <-> question_versions policies do not recurse.
create or replace function public._question_is_practice_live(p_question uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.questions q
                     where q.id = p_question and q.pool = 'practice' and q.retired_at is null) $$;

create or replace function public._question_visible(p_question uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.question_versions v
                     where v.question_id = p_question
                       and (public.can_see_version(v.status, v.author_id)
                            or (v.status = 'live' and public._question_is_practice_live(p_question)))) $$;

create policy question_versions_select on public.question_versions for select to authenticated
  using (public.can_see_version(status, author_id)
         or (status = 'live' and public._question_is_practice_live(question_id)));

create policy questions_select on public.questions for select to authenticated
  using (public._question_visible(id));

create policy question_keys_select on public.question_keys for select to authenticated
  using (public.is_instructor() and exists (
           select 1 from public.question_versions v
           where v.id = version_id and public.can_see_version(v.status, v.author_id)));

create policy question_reviews_select on public.question_reviews for select to authenticated
  using (public.is_instructor() and exists (
           select 1 from public.question_versions v
           where v.id = version_id and public.can_see_version(v.status, v.author_id)));

create policy answers_select on public.answers for select to authenticated
  using (user_id = auth.uid() or public.is_instructor());

-- =====================================================================
-- Functions — the only write path
-- =====================================================================
create or replace function public._require_instructor()
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_instructor() then
    raise exception 'instructor role required' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Lectures
-- ---------------------------------------------------------------------
create or replace function public.validate_lecture(p jsonb)
returns text[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  e text[] := '{}';
  v_missing text[];
begin
  if coalesce(p ->> 'number', '') !~ '^\d{1,6}$' then
    e := e || text 'Lecture number must be a positive whole number.';
  elsif (p ->> 'number')::int < 1 then
    e := e || text 'Lecture number must be a positive whole number.';
  end if;
  if coalesce(btrim(p ->> 'title'), '') = '' then e := e || text 'Title is required.'; end if;
  if coalesce(p ->> 'niche', '') = '' then
    e := e || text 'Niche is required.';
  elsif cardinality(public.vocab_missing('niche', array[p ->> 'niche'])) > 0 then
    e := e || ('Unknown niche: ' || (p ->> 'niche'));
  end if;
  v_missing := public.vocab_missing('disease', array(select jsonb_array_elements_text(coalesce(p -> 'disease_ids', '[]'))));
  if cardinality(v_missing) > 0 then e := e || ('Unknown disease: ' || array_to_string(v_missing, ', ')); end if;
  v_missing := public.vocab_missing('organism', array(select jsonb_array_elements_text(coalesce(p -> 'organism_ids', '[]'))));
  if cardinality(v_missing) > 0 then e := e || ('Unknown organism: ' || array_to_string(v_missing, ', ')); end if;
  if coalesce(p ->> 'cascade_step', '') <> ''
     and cardinality(public.vocab_missing('cascade_step', array[p ->> 'cascade_step'])) > 0 then
    e := e || ('Unknown cascade step: ' || (p ->> 'cascade_step'));
  end if;
  if length(coalesce(p ->> 'summary', '')) > 20000 then e := e || text 'Summary is too long (20,000 characters max).'; end if;
  return e;
end $$;

create or replace function public.save_lecture(p jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
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
  if v_row.author_id <> auth.uid() and not public.is_admin() then
    raise exception 'only the author or an admin can edit this lecture' using errcode = '42501';
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
end $$;

create or replace function public.set_lecture_status(p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_row public.lectures;
begin
  perform public._require_instructor();
  if p_status not in ('draft', 'published') then raise exception 'bad status' using errcode = '22023'; end if;
  select * into v_row from public.lectures where id = p_id for update;
  if not found then raise exception 'lecture not found' using errcode = 'P0002'; end if;
  if v_row.author_id <> auth.uid() and not public.is_admin() then
    raise exception 'only the author or an admin can publish or unpublish this lecture' using errcode = '42501';
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
end $$;

create or replace function public.publish_lecture(p_id uuid)   returns void language sql security definer set search_path = ''
  as $$ select public.set_lecture_status(p_id, 'published') $$;
create or replace function public.unpublish_lecture(p_id uuid) returns void language sql security definer set search_path = ''
  as $$ select public.set_lecture_status(p_id, 'draft') $$;

-- How many distinct students have opened this lecture (used to warn before unpublishing).
create or replace function public.lecture_view_count(p_id uuid)
returns int
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._require_instructor();
  return (select count(distinct user_id) from public.content_events
          where lecture_id = p_id and event_type = 'lecture_viewed');
end $$;

-- Student-side event logging (only student event types, only published lectures).
create or replace function public.log_lecture_view(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not exists (select 1 from public.lectures where id = p_id and status = 'published') then
    raise exception 'lecture not found' using errcode = 'P0002';
  end if;
  perform public._emit('lecture_viewed', p_id);
end $$;

-- ---------------------------------------------------------------------
-- Question validation
-- ---------------------------------------------------------------------
-- Accepts options as [{"id":"A","text":".."}] or ["..",".."]; returns [{"id","text"}] with ids A..E.
create or replace function public._normalise_options(p jsonb)
returns jsonb
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', coalesce(nullif(btrim(case jsonb_typeof(o) when 'object' then o ->> 'id' end), ''), chr(64 + i::int)),
           'text', btrim(coalesce(case jsonb_typeof(o) when 'object' then o ->> 'text' else o #>> '{}' end, '')))
         order by i), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality as t(o, i)
$$;

create or replace function public.validate_question(p jsonb)
returns text[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  e text[] := '{}';
  v_opts jsonb := public._normalise_options(p -> 'options');
  v_n int := jsonb_array_length(v_opts);
  v_correct text := nullif(btrim(p ->> 'correct_option_id'), '');
  v_missing text[];
begin
  if coalesce(btrim(p ->> 'stem'), '') = '' then e := e || text 'Stem is required.'; end if;
  if v_n < 3 or v_n > 5 then e := e || text 'A question needs 3 to 5 options.'; end if;
  if exists (select 1 from jsonb_array_elements(v_opts) o where o ->> 'text' = '') then
    e := e || text 'Options cannot be empty.';
  end if;
  if (select count(distinct lower(regexp_replace(o ->> 'text', '\s+', ' ', 'g'))) from jsonb_array_elements(v_opts) o
      where o ->> 'text' <> '') < (select count(*) from jsonb_array_elements(v_opts) o where o ->> 'text' <> '') then
    e := e || text 'Options must not repeat.';
  end if;
  if (select count(distinct o ->> 'id') from jsonb_array_elements(v_opts) o) < v_n then
    e := e || text 'Option ids must be unique.';
  end if;
  if v_correct is null then
    e := e || text 'Mark exactly one option as correct.';
  elsif not exists (select 1 from jsonb_array_elements(v_opts) o where o ->> 'id' = v_correct) then
    e := e || text 'The correct answer must be one of the options.';
  end if;
  if coalesce(btrim(p ->> 'explanation'), '') = '' then e := e || text 'An explanation is required.'; end if;

  if coalesce(p ->> 'niche', '') = '' then e := e || text 'Tag a niche.';
  elsif cardinality(public.vocab_missing('niche', array[p ->> 'niche'])) > 0 then e := e || ('Unknown niche: ' || (p ->> 'niche')); end if;
  if coalesce(p ->> 'topic', '') = '' then e := e || text 'Tag a topic.';
  elsif cardinality(public.vocab_missing('topic', array[p ->> 'topic'])) > 0 then e := e || ('Unknown topic: ' || (p ->> 'topic')); end if;
  if coalesce(p ->> 'lecture_id', '') = '' then
    e := e || text 'Tag a lecture.';
  elsif (p ->> 'lecture_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    e := e || text 'Unknown lecture.';
  elsif not exists (select 1 from public.lectures l where l.id = (p ->> 'lecture_id')::uuid) then
    e := e || text 'Unknown lecture.';
  end if;

  v_missing := public.vocab_missing('organism', array(select jsonb_array_elements_text(coalesce(p -> 'organism_ids', '[]'))));
  if cardinality(v_missing) > 0 then e := e || ('Unknown organism: ' || array_to_string(v_missing, ', ')); end if;
  v_missing := public.vocab_missing('disease', array(select jsonb_array_elements_text(coalesce(p -> 'disease_ids', '[]'))));
  if cardinality(v_missing) > 0 then e := e || ('Unknown disease: ' || array_to_string(v_missing, ', ')); end if;
  if coalesce(p ->> 'tier', '') <> '' and cardinality(public.vocab_missing('tier', array[p ->> 'tier'])) > 0 then
    e := e || ('Unknown tier: ' || (p ->> 'tier')); end if;
  if coalesce(p ->> 'failure_mode', '') <> '' and cardinality(public.vocab_missing('failure_mode', array[p ->> 'failure_mode'])) > 0 then
    e := e || ('Unknown failure mode: ' || (p ->> 'failure_mode')); end if;
  if coalesce(p ->> 'bloom', '') <> '' and cardinality(public.vocab_missing('bloom', array[p ->> 'bloom'])) > 0 then
    e := e || ('Unknown Bloom level: ' || (p ->> 'bloom')); end if;
  if coalesce(p ->> 'difficulty', '') <> '' and cardinality(public.vocab_missing('difficulty', array[p ->> 'difficulty'])) > 0 then
    e := e || ('Unknown difficulty: ' || (p ->> 'difficulty')); end if;
  if coalesce(p ->> 'pool', 'practice') not in ('practice', 'pretest', 'monthly') then
    e := e || text 'Pool must be practice, pretest or monthly.'; end if;
  return e;
end $$;

-- Near-duplicate stems (trigram similarity), for the "possible duplicate" warning.
create or replace function public.similar_stems(p_stem text, p_exclude_question uuid default null, p_threshold real default 0.55)
returns table (question_id uuid, version_id uuid, version int, status text, stem text, score real)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._require_instructor();
  return query
    select v.question_id, v.id, v.version, v.status, v.stem, extensions.similarity(v.stem, p_stem) as score
    from public.question_versions v
    where (p_exclude_question is null or v.question_id <> p_exclude_question)
      and v.status not in ('superseded')
      and public.can_see_version(v.status, v.author_id)
      and extensions.similarity(v.stem, p_stem) >= p_threshold
    order by score desc
    limit 5;
end $$;

-- ---------------------------------------------------------------------
-- Create / edit
-- ---------------------------------------------------------------------
create or replace function public._write_version_content(p_version uuid, p jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.question_versions set
    stem = btrim(p ->> 'stem'),
    options = public._normalise_options(p -> 'options'),
    niche = p ->> 'niche', topic = p ->> 'topic', lecture_id = (p ->> 'lecture_id')::uuid,
    organism_ids = array(select jsonb_array_elements_text(coalesce(p -> 'organism_ids', '[]'))),
    disease_ids  = array(select jsonb_array_elements_text(coalesce(p -> 'disease_ids', '[]'))),
    tier = nullif(p ->> 'tier', ''), failure_mode = nullif(p ->> 'failure_mode', ''),
    bloom = nullif(p ->> 'bloom', ''), difficulty = nullif(p ->> 'difficulty', '')
  where id = p_version;
  insert into public.question_keys (version_id, correct_option_id, explanation)
  values (p_version, btrim(p ->> 'correct_option_id'), btrim(p ->> 'explanation'))
  on conflict (version_id) do update
    set correct_option_id = excluded.correct_option_id, explanation = excluded.explanation
    where (public.question_keys.correct_option_id, public.question_keys.explanation)
          is distinct from (excluded.correct_option_id, excluded.explanation);
end $$;

create or replace function public._new_version(p_question uuid, p_version int, p jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  insert into public.question_versions
    (question_id, version, status, stem, options, niche, topic, lecture_id, organism_ids, disease_ids,
     tier, failure_mode, bloom, difficulty, author_id)
  values
    (p_question, p_version, 'draft', btrim(p ->> 'stem'), public._normalise_options(p -> 'options'),
     p ->> 'niche', p ->> 'topic', (p ->> 'lecture_id')::uuid,
     array(select jsonb_array_elements_text(coalesce(p -> 'organism_ids', '[]'))),
     array(select jsonb_array_elements_text(coalesce(p -> 'disease_ids', '[]'))),
     nullif(p ->> 'tier', ''), nullif(p ->> 'failure_mode', ''), nullif(p ->> 'bloom', ''),
     nullif(p ->> 'difficulty', ''), auth.uid())
  returning id into v_id;
  insert into public.question_keys (version_id, correct_option_id, explanation)
  values (v_id, btrim(p ->> 'correct_option_id'), btrim(p ->> 'explanation'));
  return v_id;
end $$;

-- p: { question_id?, stem, options, correct_option_id, explanation, niche, topic, lecture_id,
--      organism_ids[], disease_ids[], tier, failure_mode, bloom, difficulty, pool?, source? }
-- Returns { question_id, version_id, version, new_version }.
create or replace function public.save_question(p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
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

  -- New item
  if v_qid is null then
    v_pool := coalesce(v_pool, 'practice');
    if v_pool <> 'practice' and not public.is_admin() then
      raise exception 'only an admin can place an item in the % pool', v_pool using errcode = '42501';
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
  if v_pool is not null and v_pool <> v_q.pool and not public.is_admin() then
    raise exception 'only an admin can move an item to the % pool', v_pool using errcode = '42501';
  end if;
  if v_q.pool <> 'practice' and not public.is_admin() then
    raise exception 'only an admin can edit % items', v_q.pool using errcode = '42501';
  end if;
  if v_pool is not null and v_pool <> v_q.pool then
    perform set_config('app.audit_action', 'edit', true);
    update public.questions set pool = v_pool, updated_at = now() where id = v_qid;
  end if;

  perform set_config('app.audit_action', 'edit', true);
  select * into v_open from public.question_versions
   where question_id = v_qid and status in ('draft', 'in_review', 'approved') for update;

  if found then
    if v_open.author_id <> auth.uid() and not public.is_admin() then
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
end $$;

-- ---------------------------------------------------------------------
-- Workflow
-- ---------------------------------------------------------------------
create or replace function public.submit_question(p_version uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v public.question_versions;
begin
  perform public._require_instructor();
  select * into v from public.question_versions where id = p_version for update;
  if not found then raise exception 'version not found' using errcode = 'P0002'; end if;
  if v.author_id <> auth.uid() and not public.is_admin() then
    raise exception 'only the author can submit this version' using errcode = '42501';
  end if;
  if v.status <> 'draft' then raise exception 'only drafts can be submitted (this one is %)', v.status using errcode = '55000'; end if;
  perform set_config('app.audit_action', 'submit', true);
  update public.question_versions set status = 'in_review', submitted_at = now() where id = p_version;
  perform public._emit('question_submitted', null, v.question_id, p_version);
end $$;

-- decision: 'approved' | 'returned' (a comment is required when returning)
create or replace function public.review_question(p_version uuid, p_decision text, p_comment text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v public.question_versions;
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
  if p_decision = 'approved' then
    update public.question_versions set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_version;
    perform public._emit('question_approved', null, v.question_id, p_version);
  else
    update public.question_versions set status = 'draft', submitted_at = null where id = p_version;
    perform public._emit('question_returned', null, v.question_id, p_version, jsonb_build_object('comment', btrim(p_comment)));
  end if;
end $$;

create or replace function public.publish_question(p_version uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v public.question_versions; q public.questions;
begin
  perform public._require_instructor();
  select * into v from public.question_versions where id = p_version for update;
  if not found then raise exception 'version not found' using errcode = 'P0002'; end if;
  select * into q from public.questions where id = v.question_id for update;
  if v.status <> 'approved' then raise exception 'only approved versions can go live (this one is %)', v.status using errcode = '55000'; end if;
  if q.retired_at is not null then raise exception 'question is retired' using errcode = '55000'; end if;
  if q.pool <> 'practice' and not public.is_admin() then
    raise exception 'only an admin can put % items live', q.pool using errcode = '42501';
  end if;
  if not (public.is_admin() or v.author_id = auth.uid() or v.approved_by = auth.uid()) then
    raise exception 'only the author, the approver or an admin can put this live' using errcode = '42501';
  end if;
  perform set_config('app.audit_action', 'supersede', true);
  update public.question_versions set status = 'superseded' where question_id = v.question_id and status = 'live';
  perform set_config('app.audit_action', 'publish', true);
  update public.question_versions set status = 'live', live_at = now() where id = p_version;
  update public.questions set updated_at = now() where id = v.question_id;
  perform public._emit('question_live', null, v.question_id, p_version);
end $$;

-- Removes the item from every student pool; all versions, keys and answers are kept.
create or replace function public.retire_question(p_question uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare q public.questions;
begin
  perform public._require_instructor();
  select * into q from public.questions where id = p_question for update;
  if not found then raise exception 'question not found' using errcode = 'P0002'; end if;
  if q.retired_at is not null then return; end if;
  if q.author_id <> auth.uid() and not public.is_admin() then
    raise exception 'only the author or an admin can retire this item' using errcode = '42501';
  end if;
  perform set_config('app.audit_action', 'retire', true);
  update public.questions set retired_at = now(), retired_by = auth.uid(), updated_at = now() where id = p_question;
  update public.question_versions set status = 'retired'
   where question_id = p_question and status in ('draft', 'in_review', 'approved', 'live');
  perform public._emit('question_retired', null, p_question);
end $$;

create or replace function public.set_question_pool(p_question uuid, p_pool text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can change an item''s pool' using errcode = '42501';
  end if;
  if p_pool not in ('practice', 'pretest', 'monthly') then raise exception 'bad pool' using errcode = '22023'; end if;
  perform set_config('app.audit_action', 'pool_change', true);
  update public.questions set pool = p_pool, updated_at = now() where id = p_question;
  if not found then raise exception 'question not found' using errcode = 'P0002'; end if;
end $$;

-- Copy the newest version the caller can see into a brand-new draft item they own.
create or replace function public.duplicate_question(p_question uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v public.question_versions;
  k public.question_keys;
begin
  perform public._require_instructor();
  select * into v from public.question_versions
   where question_id = p_question and public.can_see_version(status, author_id)
   order by version desc limit 1;
  if not found then raise exception 'question not found' using errcode = 'P0002'; end if;
  select * into k from public.question_keys where version_id = v.id;
  return public.save_question(jsonb_build_object(
    'stem', v.stem, 'options', v.options, 'correct_option_id', k.correct_option_id, 'explanation', k.explanation,
    'niche', v.niche, 'topic', v.topic, 'lecture_id', v.lecture_id,
    'organism_ids', to_jsonb(v.organism_ids), 'disease_ids', to_jsonb(v.disease_ids),
    'tier', v.tier, 'failure_mode', v.failure_mode, 'bloom', v.bloom, 'difficulty', v.difficulty,
    'source', 'duplicate', 'duplicated_from', p_question));
end $$;

-- Bulk import. Every item lands as a NEW DRAFT owned by the caller, whatever the
-- file says (status/question_id/pool fields are ignored for non-admins; pool honoured for admins).
-- p_source: 'import' or 'ai' (AI-generated items are tagged so reviewers know).
-- Returns [{index, ok, question_id?, errors?}]; valid rows are saved, invalid rows reported.
create or replace function public.import_questions(p_items jsonb, p_source text default 'import')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
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
      if not public.is_admin() then v_item := v_item - 'pool'; end if;
      -- allow "lecture_number" as a friendlier alternative to lecture_id
      if coalesce(v_item ->> 'lecture_id', '') = '' and coalesce(v_item ->> 'lecture_number', '') ~ '^\d+$' then
        select id into v_lecture from public.lectures
         where number = (v_item ->> 'lecture_number')::int
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
end $$;

-- ---------------------------------------------------------------------
-- Students answer live practice items
-- ---------------------------------------------------------------------
create or replace function public.submit_answer(p_version uuid, p_option text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v public.question_versions;
  k public.question_keys;
  v_ok boolean;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  select v2.* into v from public.question_versions v2
    join public.questions q on q.id = v2.question_id
   where v2.id = p_version and v2.status = 'live' and q.pool = 'practice' and q.retired_at is null;
  if not found then raise exception 'question not available' using errcode = 'P0002'; end if;
  if not exists (select 1 from jsonb_array_elements(v.options) o where o ->> 'id' = p_option) then
    raise exception 'not an option of this question' using errcode = '22023';
  end if;
  select * into k from public.question_keys where version_id = p_version;
  v_ok := (k.correct_option_id = p_option);
  insert into public.answers (user_id, version_id, chosen_option_id, is_correct) values (auth.uid(), p_version, p_option, v_ok);
  perform public._emit('question_answered', v.lecture_id, v.question_id, p_version,
                       jsonb_build_object('option', p_option, 'correct', v_ok));
  return jsonb_build_object('correct', v_ok, 'correct_option_id', k.correct_option_id, 'explanation', k.explanation);
end $$;

-- ---------------------------------------------------------------------
-- Instructor reporting
-- ---------------------------------------------------------------------
-- One row per question: its newest visible version plus answer stats across all versions.
create or replace function public.question_list()
returns table (
  question_id uuid, pool text, item_author uuid, source text, retired_at timestamptz,
  version_id uuid, version int, status text, stem text, niche text, topic text, lecture_id uuid,
  lecture_number int, lecture_title text, tier text, difficulty text, bloom text, failure_mode text,
  organism_ids text[], disease_ids text[], version_author uuid, author_name text,
  live_version_id uuid, live_version int, answers int, pct_correct numeric, updated_at timestamptz,
  last_return_comment text
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
           order by r.created_at desc limit 1)
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

-- Item analysis for live items: first attempts only; discrimination = point-biserial
-- correlation between getting this item right and the student's overall score.
create or replace function public.item_stats()
returns table (question_id uuid, version_id uuid, version int, stem text, n int, pct_correct numeric,
               discrimination numeric, option_counts jsonb, correct_option_id text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._require_instructor();
  return query
  with first_attempts as (
    select distinct on (a.user_id, a.version_id) a.*
    from public.answers a order by a.user_id, a.version_id, a.answered_at
  ),
  student_score as (
    select user_id, avg(case when is_correct then 1.0 else 0.0 end) as score
    from first_attempts group by user_id
  )
  select v.question_id, v.id, v.version, v.stem,
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
  group by v.question_id, v.id, v.version, v.stem, k.correct_option_id;
end $$;

create or replace function public.student_summary()
returns table (user_id uuid, display_name text, email text, role public.app_role, answers int,
               pct_correct numeric, lectures_viewed int, last_active timestamptz, joined timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._require_instructor();
  return query
  select p.id, p.display_name, p.email, p.role,
         (select count(*) from public.answers a where a.user_id = p.id)::int,
         (select round(100.0 * count(*) filter (where a.is_correct) / nullif(count(*), 0), 1)
            from public.answers a where a.user_id = p.id),
         (select count(distinct e.lecture_id) from public.content_events e
           where e.user_id = p.id and e.event_type = 'lecture_viewed')::int,
         (select max(e.created_at) from public.content_events e where e.user_id = p.id),
         p.created_at
  from public.profiles p
  order by p.role desc, p.display_name;
end $$;

-- Full export for instructors (keys included), newest visible version of each item.
create or replace function public.export_questions()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
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
                   where v2.question_id = q.id and public.can_see_version(v2.status, v2.author_id)
                   order by v2.version desc limit 1) v on true
    join public.question_keys k on k.version_id = v.id
    left join public.lectures lec on lec.id = v.lecture_id), '[]'::jsonb);
end $$;

-- Lecture list for the instructor tab (with author name and view counts).
create or replace function public.lecture_list()
returns table (id uuid, number int, title text, niche text, status text, author_id uuid, author_name text,
               updated_at timestamptz, published_at timestamptz, viewers int, questions int)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._require_instructor();
  return query
  select l.id, l.number, l.title, l.niche, l.status, l.author_id, p.display_name, l.updated_at, l.published_at,
         (select count(distinct e.user_id) from public.content_events e
           where e.lecture_id = l.id and e.event_type = 'lecture_viewed')::int,
         (select count(distinct v.question_id) from public.question_versions v
           where v.lecture_id = l.id and v.status = 'live')::int
  from public.lectures l
  left join public.profiles p on p.id = l.author_id
  where l.status = 'published' or l.author_id = auth.uid() or public.is_admin()
  order by l.number, l.updated_at desc;
end $$;

-- ---------------------------------------------------------------------
-- Function privileges: internal helpers are not callable over the API.
-- ---------------------------------------------------------------------
revoke execute on function public._require_instructor() from public, anon, authenticated;
revoke execute on function public._normalise_options(jsonb) from public, anon, authenticated;
revoke execute on function public._write_version_content(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public._new_version(uuid, int, jsonb) from public, anon, authenticated;
revoke execute on function public.set_lecture_status(uuid, text) from public, anon, authenticated;
revoke execute on function public.freeze_question_version() from public, anon, authenticated;
revoke execute on function public.freeze_question_key() from public, anon, authenticated;
revoke execute on function public._question_is_practice_live(uuid) from public, anon;
revoke execute on function public._question_visible(uuid) from public, anon;
grant execute on function public._question_is_practice_live(uuid), public._question_visible(uuid) to authenticated;  -- used inside RLS

-- Everything else: signed-in users only (each function checks the role it needs).
do $$
declare f text;
begin
  foreach f in array array[
    'save_lecture(jsonb)', 'publish_lecture(uuid)', 'unpublish_lecture(uuid)', 'lecture_view_count(uuid)',
    'log_lecture_view(uuid)', 'validate_lecture(jsonb)', 'validate_question(jsonb)',
    'similar_stems(text, uuid, real)', 'save_question(jsonb)', 'submit_question(uuid)',
    'review_question(uuid, text, text)', 'publish_question(uuid)', 'retire_question(uuid)',
    'set_question_pool(uuid, text)', 'duplicate_question(uuid)', 'import_questions(jsonb, text)',
    'submit_answer(uuid, text)', 'question_list()', 'item_stats()', 'student_summary()',
    'export_questions()', 'lecture_list()', 'can_see_version(text, uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
