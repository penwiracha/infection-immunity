-- Course coordinators oversee everything; lecturers see only their own content
-- and only the students of the cohorts they are assigned to.
begin;
set search_path = public, extensions;
select plan(38);

\set admin '00000000-0000-0000-0000-0000000000a1'
\set co    '00000000-0000-0000-0000-0000000000a2'
\set l1    '00000000-0000-0000-0000-0000000000b1'
\set l2    '00000000-0000-0000-0000-0000000000b2'
\set s1    '00000000-0000-0000-0000-0000000000c1'
\set s2    '00000000-0000-0000-0000-0000000000c2'
\set s3    '00000000-0000-0000-0000-0000000000c3'
insert into auth.users (id, email) values (:'admin', 'a@t'), (:'co', 'co@t'), (:'l1', 'l1@t'), (:'l2', 'l2@t'),
  (:'s1', 's1@t'), (:'s2', 's2@t'), (:'s3', 's3@t');
update profiles set role = 'admin' where id = :'admin';
update profiles set role = 'coordinator' where id = :'co';
update profiles set role = 'lecturer' where id in (:'l1', :'l2');
create temp table ids (k text primary key, v uuid); grant all on ids to public;
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
grant execute on function pg_temp.as_user(uuid) to public;
create function pg_temp.id(p text) returns uuid language sql as $$ select v from ids where k = p $$;
grant execute on function pg_temp.id(text) to public;
create function pg_temp.q(p_stem text, p_lecture uuid) returns jsonb language sql as $$
  select jsonb_build_object('stem', p_stem, 'options', jsonb_build_array('Alpha', 'Bravo', 'Charlie'),
    'correct_option_id', 'A', 'explanation', 'Because.', 'niche', 'extra', 'topic', 'evasion', 'lecture_id', p_lecture)
$$;
grant execute on function pg_temp.q(text, uuid) to public;

-- roles
select is((select role::text from profiles where id = :'l1'), 'lecturer', 'lecturer is a role');
select pg_temp.as_user(:'l1');
select ok(is_instructor() and not is_coordinator(), 'a lecturer is staff but not a coordinator');
select pg_temp.as_user(:'co');
select ok(is_instructor() and is_coordinator() and not is_admin(), 'a coordinator is staff and a coordinator, not an admin');

-- cohorts: coordinators only
select pg_temp.as_user(:'l1');
select throws_ok($$select save_cohort('2567')$$, '42501', null, 'lecturers cannot create cohorts');
select throws_ok($$select save_exam('{"kind":"pretest","title":"Pre"}')$$, '42501', null, 'lecturers cannot build exams');
select pg_temp.as_user(:'co');
insert into ids select 'A', save_cohort('2567');
insert into ids select 'B', save_cohort('2568');
select set_student_cohort(:'s1', pg_temp.id('A'));
select set_student_cohort(:'s3', pg_temp.id('A'));
select set_student_cohort(:'s2', pg_temp.id('B'));
select throws_ok(format($$select set_cohort_lecturers(%L, array[%L]::uuid[])$$, pg_temp.id('A'), :'s1'), '22023', null,
                 'only lecturers can be assigned to a cohort');
select is(set_cohort_lecturers(pg_temp.id('A'), array[:'l1']::uuid[]), 1, 'a coordinator assigns a lecturer to a cohort');
select ok(exists (select 1 from audit_log where table_name = 'cohort_staff' and action = 'assign'), 'the assignment is audited');
select pg_temp.as_user(:'l1');
select throws_ok(format($$select set_cohort_lecturers(%L, '{}')$$, pg_temp.id('A')), '42501', null, 'lecturers cannot assign lecturers');
select is((select array_agg(name) from cohort_list()), array['2567'], 'a lecturer sees only their assigned cohort');
select is((select count(*)::int from cohort_staff_list()), 1, 'a lecturer sees their own assignment');

-- content: own only
select pg_temp.as_user(:'l1');
insert into ids select 'L1', save_lecture('{"number":1,"title":"Mine","niche":"extra"}');
select publish_lecture(pg_temp.id('L1'));
insert into ids select 'Q1', (save_question(pg_temp.q('Lecturer one item', pg_temp.id('L1'))) ->> 'question_id')::uuid;
insert into ids select 'V1', (select id from question_versions where question_id = pg_temp.id('Q1'));
select publish_question_now(pg_temp.id('V1'));
select pg_temp.as_user(:'l2');
insert into ids select 'L2', save_lecture('{"number":2,"title":"Theirs","niche":"extra"}');
insert into ids select 'Q2', (save_question(pg_temp.q('Lecturer two draft', pg_temp.id('L2'))) ->> 'question_id')::uuid;
insert into ids select 'V2', (select id from question_versions where question_id = pg_temp.id('Q2'));
select throws_ok(format($$select save_question(%L::jsonb)$$, pg_temp.q('Filed elsewhere', pg_temp.id('L1'))), '42501', null,
                 'a lecturer files questions only under their own lectures');

select pg_temp.as_user(:'l1');
select is((select array_agg(title) from lecture_list()), array['Mine'], 'a lecturer lists only their own lectures');
select is((select count(*)::int from lectures where id = pg_temp.id('L2')), 0, 'and cannot read another lecturer''s draft');
select is((select array_agg(question_id) from question_list()), array[pg_temp.id('Q1')], 'a lecturer lists only their own questions');
select is((select count(*)::int from question_versions where question_id = pg_temp.id('Q2')), 0, 'other lecturers'' questions are hidden');
select is((select count(*)::int from question_keys where version_id = pg_temp.id('V2')), 0, 'and so are their answer keys');
select throws_ok(format($$select save_question(%L::jsonb || jsonb_build_object('question_id', %L))$$, pg_temp.q('Edit', pg_temp.id('L1')), pg_temp.id('Q2')),
                 '42501', null, 'a lecturer cannot edit another lecturer''s question');
select throws_ok(format($$select publish_question_now(%L)$$, pg_temp.id('V2')), '42501', null, 'or publish it');
select throws_ok(format($$select save_lecture(%L::jsonb)$$, jsonb_build_object('id', pg_temp.id('L2'), 'number', 2, 'title', 'X', 'niche', 'extra')),
                 '42501', null, 'or edit another lecturer''s lecture');

-- coordinators see and act on everyone's content
select pg_temp.as_user(:'co');
select is((select count(*)::int from lecture_list()), 2, 'a coordinator lists every lecture');
select is((select count(*)::int from question_list()), 2, 'and every question');
select lives_ok(format($$select save_lecture(%L::jsonb)$$, jsonb_build_object('id', pg_temp.id('L2'), 'number', 2, 'title', 'Theirs (edited)', 'niche', 'extra')),
                'a coordinator edits a lecturer''s lecture');
select lives_ok(format($$select publish_question_now(%L)$$, pg_temp.id('V2')), 'and publishes a lecturer''s question');
select pg_temp.as_user(:'l2');
select is((select count(*)::int from question_versions where question_id = pg_temp.id('Q2')), 1,
          'the owner still sees their question after a coordinator acts on it');

-- student data: assigned cohorts only
select pg_temp.as_user(:'s1'); select set_consent(true, true); select submit_answer(pg_temp.id('V1'), 'A', 'sure');
select pg_temp.as_user(:'s2'); select set_consent(true, true); select submit_answer(pg_temp.id('V1'), 'B', 'sure');
select report_question(pg_temp.id('V1'), 'unclear', null);
select pg_temp.as_user(:'l1');
select is((select array_agg(user_id order by user_id) from student_summary(null, null) where role = 'student'), array[:'s1', :'s3']::uuid[],
          'a lecturer''s Students tab shows only students of their cohorts');
select throws_ok(format($$select * from student_summary(%L, null)$$, pg_temp.id('B')), '42501', null, 'another cohort is refused');
select is((select array_agg(distinct user_id) from answers), array[:'s1']::uuid[], 'answers are limited to their students');
select is((select count(*)::int from profiles where id in (:'s2', :'l2', :'co')), 0, 'other students and staff are not visible');
select is((select (cohort_overview(null, 30) ->> 'students')::int), 2, 'the overview counts only their students');
select is((select count(*)::int from question_report_list('all', null)), 1, 'reports on their own questions are visible, from any cohort');
select pg_temp.as_user(:'l2');
select is((select count(*)::int from question_report_list('all', null)), 0, 'other lecturers do not see them');
select pg_temp.as_user(:'co');
select is((select count(*)::int from student_summary(null, null) where role = 'student'), 3, 'a coordinator sees every student');

-- roles and invites
select throws_ok(format($$select set_user_role(%L, 'coordinator')$$, :'l2'), '42501', null, 'a coordinator cannot make coordinators');
select throws_ok($$select create_staff_invite('boss@t.ac.th', 'admin')$$, '42501', null, 'or invite admins');
select lives_ok($$select create_staff_invite('new@t.ac.th', 'lecturer')$$, 'but can invite lecturers');
select lives_ok(format($$select set_user_role(%L, 'student')$$, :'l1'), 'and switch a lecturer back to student');
select is((select count(*)::int from cohort_staff where user_id = :'l1'), 0, 'which removes their cohort assignments');

select * from finish();
rollback;
