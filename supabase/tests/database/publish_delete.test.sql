-- Publish without review; delete questions and exams safely.
begin;
set search_path = public, extensions;
select plan(17);

\set admin '00000000-0000-0000-0000-0000000000a1'
\set i1    '00000000-0000-0000-0000-0000000000b1'
\set i2    '00000000-0000-0000-0000-0000000000b2'
\set s1    '00000000-0000-0000-0000-0000000000c1'
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

select pg_temp.as_user(:'i1');
insert into ids select 'L', save_lecture('{"number":1,"title":"L1","niche":"extra"}');
create temp table r1 as select save_question(pg_temp.q('Unused practice item', 'practice')) as r; grant select on r1 to public;
create temp table r2 as select save_question(pg_temp.q('Answered practice item', 'practice')) as r; grant select on r2 to public;
insert into ids select 'Q1', (r ->> 'question_id')::uuid from r1;
insert into ids select 'V1', (r ->> 'version_id')::uuid from r1;
insert into ids select 'Q2', (r ->> 'question_id')::uuid from r2;
insert into ids select 'V2', (r ->> 'version_id')::uuid from r2;

-- publish directly
select pg_temp.as_user(:'i2');
select throws_ok(format($$select publish_question_now(%L)$$, (select v from ids where k = 'V1')), '42501', null, 'another instructor cannot publish my draft');
select pg_temp.as_user(:'i1');
select lives_ok(format($$select publish_question_now(%L)$$, (select v from ids where k = 'V1')), 'the author publishes without review');
select publish_question_now((select v from ids where k = 'V2'));
reset role;
select is((select status from question_versions where id = (select v from ids where k = 'V1')), 'live', 'it is live');
select ok(exists (select 1 from audit_log where table_name = 'question_versions' and action = 'publish'
                  and row_id = (select v::text from ids where k = 'V1') and actor_id = :'i1'), 'publishing is audited');

select pg_temp.as_user(:'admin');
insert into ids select 'M', (save_question(pg_temp.q('Monthly item', 'monthly')) ->> 'version_id')::uuid;
select pg_temp.as_user(:'i1');
select throws_ok(format($$select publish_question_now(%L)$$, (select v from ids where k = 'M')), '42501', null, 'instructors cannot publish monthly-pool items');
select pg_temp.as_user(:'admin');
select lives_ok(format($$select publish_question_now(%L)$$, (select v from ids where k = 'M')), 'admins can');

-- a student answers Q2
select pg_temp.as_user(:'s1');
select submit_answer((select v from ids where k = 'V2'), 'A', 'sure');

-- delete questions
select pg_temp.as_user(:'i2');
select throws_ok(format($$select delete_question(%L)$$, (select v from ids where k = 'Q1')), '42501', null, 'only the author or an admin can delete');
select pg_temp.as_user(:'i1');
select lives_ok(format($$select delete_question(%L)$$, (select v from ids where k = 'Q1')), 'an unused live question can be deleted by its author');
reset role;
select is((select count(*)::int from questions where id = (select v from ids where k = 'Q1')), 0, 'it is gone');
select ok(exists (select 1 from audit_log where table_name = 'question_keys' and action = 'delete'), 'the deleted key is kept in the audit log');
select pg_temp.as_user(:'i1');
select throws_ok(format($$select delete_question(%L)$$, (select v from ids where k = 'Q2')), '55000', null, 'an answered question cannot be deleted normally');
select throws_ok(format($$select delete_question(%L, true)$$, (select v from ids where k = 'Q2')), '55000', null, 'instructors cannot force it');
select pg_temp.as_user(:'admin');
select lives_ok(format($$select delete_question(%L, true)$$, (select v from ids where k = 'Q2')), 'an admin can force-delete it with its answers');
reset role;
select is((select count(*)::int from answers), 0, 'its answers went with it');

-- delete exams
select pg_temp.as_user(:'i1');
insert into ids select 'E', save_exam('{"kind":"monthly","title":"Check-in"}');
select lives_ok(format($$select delete_exam(%L)$$, (select v from ids where k = 'E')), 'an exam nobody started can be deleted');
select pg_temp.as_user(:'s1');
select throws_ok(format($$select delete_exam(%L)$$, gen_random_uuid()), '42501', null, 'students cannot delete exams');
select throws_ok(format($$select delete_question(%L)$$, gen_random_uuid()), '42501', null, 'students cannot delete questions');

select * from finish();
rollback;
