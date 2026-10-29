-- Instructor workflow: publishing, class codes, scheduled check-ins.
begin;
set search_path = public, extensions;
select plan(16);

\set admin '00000000-0000-0000-0000-0000000000a1'
\set i1    '00000000-0000-0000-0000-0000000000b1'
\set i2    '00000000-0000-0000-0000-0000000000b2'
\set s1    '00000000-0000-0000-0000-0000000000c1'
\set s2    '00000000-0000-0000-0000-0000000000c2'
insert into auth.users (id, email) values (:'admin', 'a@t'), (:'i1', 'i1@t'), (:'i2', 'i2@t'), (:'s1', 's1@t');
update profiles set role = 'admin' where id = :'admin';
update profiles set role = 'instructor' where id in (:'i1', :'i2');
create temp table ids (k text primary key, v uuid); grant all on ids to public;
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
grant execute on function pg_temp.as_user(uuid) to public;
create function pg_temp.q(p_stem text, p_pool text) returns jsonb language sql as $$
  select jsonb_build_object('stem', p_stem, 'options', jsonb_build_array('Alpha', 'Bravo', 'Charlie'),
    'correct_option_id', 'A', 'explanation', 'Because.', 'niche', 'extra', 'topic', 'evasion',
    'lecture_id', (select v from ids where k = 'L'), 'pool', p_pool)
$$;
grant execute on function pg_temp.q(text, text) to public;

select pg_temp.as_user(:'admin');
insert into ids select 'L', save_lecture('{"number":1,"title":"L1","niche":"extra"}');
insert into ids select 'P', (save_question(pg_temp.q('Practice item', 'practice')) ->> 'version_id')::uuid;
insert into ids select 'M', (save_question(pg_temp.q('Monthly item', 'monthly')) ->> 'version_id')::uuid;
select pg_temp.as_user(:'i1');
select throws_ok(format($$select publish_question_now(%L)$$, (select v from ids where k = 'M')), '42501', null,
                 'an instructor cannot put a monthly item live');
select pg_temp.as_user(:'admin');
select publish_question_now((select v from ids where k = 'P'));
select publish_question_now((select v from ids where k = 'M'));
reset role;
select is((select status from question_versions where id = (select v from ids where k = 'P')), 'live', 'published practice item is live');

-- class codes
select pg_temp.as_user(:'i1');
insert into ids select 'C', save_cohort('2567');
select ok((select join_code from cohort_list() where id = (select v from ids where k = 'C')) ~ '^[A-Z2-9]{6}$', 'new cohorts get a 6-character code');
select pg_temp.as_user(:'s1');
select throws_ok($$select join_code from cohorts$$, '42501', null, 'students cannot read class codes');
select is((select count(*)::int from cohorts), 1, 'students can still read cohort names');
select throws_ok($$select join_cohort('NOPE99')$$, 'P0002', null, 'a wrong code is rejected');
reset role;
create temp table code as select join_code from cohorts where id = (select v from ids where k = 'C');
grant select on code to public;
select pg_temp.as_user(:'s1');
select is(join_cohort(lower((select join_code from code))), '2567', 'a student joins with the code (any case)');
reset role;
select is((select cohort_id from profiles where id = :'s1'), (select v from ids where k = 'C'), 'their cohort is set');
insert into auth.users (id, email, raw_user_meta_data)
values (:'s2', 's2@t', jsonb_build_object('display_name', 'Ploy', 'class_code', (select join_code from code), 'role', 'admin'));
select is((select cohort_id from profiles where id = :'s2'), (select v from ids where k = 'C'), 'a class code at sign-up puts the student in the cohort');
select is((select role::text from profiles where id = :'s2'), 'student', 'but sign-up metadata still cannot set a role');
select pg_temp.as_user(:'s1');
select throws_ok($$select save_schedule('{}')$$, '42501', null, 'students cannot create schedules');

-- schedules
select pg_temp.as_user(:'i1');
insert into ids select 'S', save_schedule(jsonb_build_object('cohort_id', (select v from ids where k = 'C'), 'day_of_month', least(28, extract(day from _today())::int),
                                                           'n_items', 10, 'open_days', 7));
select pg_temp.as_user(:'s1');
select is(run_due_schedules(), 1, 'the first visit this month creates the check-in');
select is(run_due_schedules(), 0, 'and only once');
reset role;
select is((select status from exams where schedule_id = (select v from ids where k = 'S')), 'open', 'it opens with items from the monthly pool');
select is((select count(*)::int from exam_items i join exams e on e.id = i.exam_id where e.schedule_id = (select v from ids where k = 'S')), 1,
          'it takes what the pool has (1 of 10 requested)');
select pg_temp.as_user(:'s1');
select is((select count(*)::int from my_exams() where kind = 'monthly'), 1, 'the student sees the scheduled check-in');

select * from finish();
rollback;
