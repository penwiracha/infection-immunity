-- =====================================================================
-- 0012 "Report a problem" on questions
--   Students flag a practice question (wrong key, unclear, out of date,
--   typo, other) from the question after answering it or from the back of
--   its flashcard. Instructors see open reports on the Today card, in the
--   question bank (filter) and on the question itself, and mark each one
--   fixed or dismissed. Reports are linked to the exact version the
--   student saw. Reporters appear by short ID (S-XXXX), never by name.
-- =====================================================================

create table public.question_reports (
  id               uuid primary key default gen_random_uuid(),
  question_id      uuid not null references public.questions (id) on delete cascade,
  version_id       uuid not null references public.question_versions (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  reason           text not null check (reason in ('wrong_key', 'unclear', 'outdated', 'typo', 'other')),
  comment          text check (length(comment) <= 1000),
  status           text not null default 'open' check (status in ('open', 'fixed', 'dismissed')),
  resolved_by      uuid references auth.users (id),
  resolved_at      timestamptz,
  resolution_note  text check (length(resolution_note) <= 1000),
  created_at       timestamptz not null default now()
);
create index question_reports_question_idx on public.question_reports (question_id, status);
create unique index question_reports_one_open on public.question_reports (question_id, user_id) where status = 'open';

alter table public.question_reports enable row level security;
revoke all on public.question_reports from anon, authenticated;
grant select on public.question_reports to authenticated;
create policy question_reports_select on public.question_reports for select to authenticated
  using (user_id = auth.uid() or public.is_instructor());

create trigger question_reports_audit after insert or update or delete on public.question_reports
  for each row execute function public.audit_row();

insert into public.event_types (id, actor, description) values
  ('question_reported', 'student',    'A student reported a problem with a question'),
  ('report_resolved',   'instructor', 'An instructor marked a question report fixed or dismissed')
on conflict (id) do nothing;


create or replace function public.report_question(p_version uuid, p_reason text, p_comment text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v public.question_versions; v_id uuid;
begin
  perform public._require_user();
  if p_reason not in ('wrong_key', 'unclear', 'outdated', 'typo', 'other') then
    raise exception 'choose what is wrong' using errcode = '22023';
  end if;
  if p_reason = 'other' and coalesce(btrim(p_comment), '') = '' then
    raise exception 'say what is wrong' using errcode = '22023';
  end if;
  if length(coalesce(p_comment, '')) > 1000 then raise exception 'keep the comment under 1,000 characters' using errcode = '22023'; end if;
  select * into v from public.question_versions where id = p_version;
  if not found then raise exception 'question not found' using errcode = 'P0002'; end if;
  -- students may report what they can see in practice, or a version they answered
  if not (public.is_instructor()
          or (v.status = 'live' and public._student_q_ok(v.question_id))
          or exists (select 1 from public.answers a where a.version_id = p_version and a.user_id = auth.uid())) then
    raise exception 'question not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.question_reports r where r.question_id = v.question_id and r.user_id = auth.uid() and r.status = 'open') then
    raise exception 'you have already reported this question; your instructors will look at it' using errcode = '23505';
  end if;
  if (select count(*) from public.question_reports r where r.user_id = auth.uid() and public._day(r.created_at) = public._today()) >= 20 then
    raise exception 'you have sent 20 reports today; please try again tomorrow' using errcode = '54000';
  end if;
  perform set_config('app.audit_action', 'report', true);
  insert into public.question_reports (question_id, version_id, user_id, reason, comment)
  values (v.question_id, p_version, auth.uid(), p_reason, nullif(btrim(p_comment), ''))
  returning id into v_id;
  perform public._emit('question_reported', v.lecture_id, v.question_id, p_version, jsonb_build_object('reason', p_reason));
  return v_id;
end $$;

create or replace function public.resolve_question_report(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare r public.question_reports;
begin
  perform public._require_instructor();
  if p_status not in ('fixed', 'dismissed', 'open') then raise exception 'bad status' using errcode = '22023'; end if;
  select * into r from public.question_reports where id = p_id for update;
  if not found then raise exception 'report not found' using errcode = 'P0002'; end if;
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
end $$;

-- Reports for instructors: all of them, or one question's, newest first.
create or replace function public.question_report_list(p_status text default 'open', p_question uuid default null)
returns table (id uuid, question_id uuid, version_id uuid, version int, stem text, lecture_number int, reason text, comment text,
               reporter_code text, status text, created_at timestamptz, resolved_at timestamptz, resolved_by_name text,
               resolution_note text, version_is_live boolean)
language plpgsql stable security definer set search_path = ''
as $$
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
    and (p_question is null or r.question_id = p_question)
  order by (r.status = 'open') desc, r.created_at desc
  limit 500;
end $$;


do $$
declare f text;
begin
  foreach f in array array['report_question(uuid, text, text)', 'resolve_question_report(uuid, text, text)',
                           'question_report_list(text, uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
