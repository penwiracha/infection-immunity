-- =====================================================================
-- 0010 AI question drafts generated inside the website
--   The Edge Function supabase/functions/generate-questions calls the
--   Typhoon API (key in the TYPHOON_API_KEY secret, never in the browser)
--   on behalf of a signed-in instructor:
--     ai_generation_begin()  checks the role and the daily limit, logs the
--                            request and returns the lecture + tag lists
--     import_questions(..., 'ai')  saves the reply as AI-generated DRAFTS
--     ai_generation_finish() records the outcome
--   Nothing reaches students until an instructor publishes a draft.
--   Only course content is sent to the AI: never student data.
-- =====================================================================

create table public.ai_generations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id),
  lecture_id    uuid references public.lectures (id) on delete set null,
  source        text not null check (source in ('lecture', 'pdf')),
  source_name   text check (length(source_name) <= 200),
  source_chars  int,
  n_requested   int  not null check (n_requested between 1 and 20),
  model         text,
  status        text not null default 'running' check (status in ('running', 'done', 'failed')),
  n_saved       int,
  n_rejected    int,
  error         text,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index ai_generations_user_day_idx on public.ai_generations (user_id, created_at desc);

alter table public.ai_generations enable row level security;
revoke all on public.ai_generations from anon, authenticated;
grant select on public.ai_generations to authenticated;
create policy ai_generations_select on public.ai_generations for select to authenticated
  using (public.is_instructor() and (user_id = auth.uid() or public.is_admin()));

insert into public.event_types (id, actor, description) values
  ('questions_generated', 'instructor', 'An instructor generated AI question drafts in the website')
on conflict (id) do nothing;

-- Daily allowance per instructor (Bangkok day), counted in questions requested.
create or replace function public._ai_daily_limit() returns int language sql immutable set search_path = '' as $$ select 100 $$;

create or replace function public._ai_used_today(p_user uuid)
returns int language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(n_requested), 0)::int from public.ai_generations
   where user_id = p_user and status <> 'failed' and public._day(created_at) = public._today()
$$;

create or replace function public.ai_generation_begin(p_lecture uuid, p_n int, p_source text,
                                                      p_source_name text default null, p_source_chars int default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare l public.lectures; v_id uuid; v_used int;
begin
  perform public._require_instructor();
  if p_source not in ('lecture', 'pdf') then raise exception 'source must be lecture or pdf' using errcode = '22023'; end if;
  if p_n is null or p_n < 1 or p_n > 20 then raise exception 'ask for 1 to 20 questions at a time' using errcode = '22023'; end if;
  select * into l from public.lectures where id = p_lecture;
  if not found or not (l.status = 'published' or l.author_id = auth.uid() or public.is_admin()) then
    raise exception 'choose a lecture to file the questions under' using errcode = '22023';
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
end $$;

create or replace function public.ai_generation_finish(p_id uuid, p_status text, p_model text,
                                                       p_saved int default 0, p_rejected int default 0, p_error text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare g public.ai_generations;
begin
  perform public._require_instructor();
  if p_status not in ('done', 'failed') then raise exception 'bad status' using errcode = '22023'; end if;
  select * into g from public.ai_generations where id = p_id and user_id = auth.uid() and status = 'running' for update;
  if not found then raise exception 'generation not found' using errcode = 'P0002'; end if;
  update public.ai_generations
     set status = p_status, model = left(p_model, 100), n_saved = coalesce(p_saved, 0), n_rejected = coalesce(p_rejected, 0),
         error = left(p_error, 1000), finished_at = now()
   where id = p_id;
  if p_status = 'done' then
    perform public._emit('questions_generated', g.lecture_id, null, null,
      jsonb_build_object('generation_id', p_id, 'source', g.source, 'saved', p_saved, 'rejected', p_rejected, 'model', p_model));
  end if;
end $$;

-- Recent generations: your own (instructors) or everyone's (admins).
create or replace function public.ai_generation_list(p_limit int default 50)
returns table (id uuid, created_at timestamptz, author_name text, lecture_number int, lecture_title text, source text,
               source_name text, n_requested int, n_saved int, n_rejected int, status text, model text, error text,
               used_today int, daily_limit int)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._require_instructor();
  return query
  select g.id, g.created_at, p.display_name, l.number, l.title, g.source, g.source_name, g.n_requested, g.n_saved,
         g.n_rejected, g.status, g.model, g.error, public._ai_used_today(auth.uid()), public._ai_daily_limit()
  from public.ai_generations g
  left join public.profiles p on p.id = g.user_id
  left join public.lectures l on l.id = g.lecture_id
  where g.user_id = auth.uid() or public.is_admin()
  order by g.created_at desc
  limit greatest(1, least(p_limit, 500));
end $$;

revoke execute on function public._ai_used_today(uuid) from public, anon, authenticated;
revoke execute on function public._ai_daily_limit() from public, anon;
do $$
declare f text;
begin
  foreach f in array array['ai_generation_begin(uuid, int, text, text, int)', 'ai_generation_finish(uuid, text, text, int, int, text)',
                           'ai_generation_list(int)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
