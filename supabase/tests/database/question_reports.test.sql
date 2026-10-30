-- "Report a problem" on questions (0012).
begin;
set search_path = public, extensions;
select plan(14);
\set i1 '00000000-0000-0000-0000-0000000000b1'
\set s1 '00000000-0000-0000-0000-0000000000c1'
\set s2 '00000000-0000-0000-0000-0000000000c2'
insert into auth.users (id, email) values (:'i1', 'i1@t'), (:'s1', 's1@t'), (:'s2', 's2@t');
update profiles set role = 'instructor' where id = :'i1';
create temp table ids (k text primary key, v uuid); grant all on ids to public;
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
grant execute on function pg_temp.as_user(uuid) to public;
create function pg_temp.id(p text) returns uuid language sql as $$ select v from ids where k = p $$;
grant execute on function pg_temp.id(text) to public;

select pg_temp.as_user(:'i1');
insert into ids select 'L', save_lecture('{"number":1,"title":"L1","niche":"extra"}');
select publish_lecture(pg_temp.id('L'));
create temp table r as select save_question(jsonb_build_object('stem', 'Which blocks C3b?', 'options', jsonb_build_array('Capsule', 'Pili', 'Toxin'),
  'correct_option_id', 'A', 'explanation', 'Because.', 'niche', 'extra', 'topic', 'evasion', 'lecture_id', pg_temp.id('L'))) as j;
grant select on r to public;
insert into ids select 'Q', (j ->> 'question_id')::uuid from r;
insert into ids select 'V', (j ->> 'version_id')::uuid from r;
select pg_temp.as_user(:'s1');
select throws_ok(format($$select report_question(%L, 'typo')$$, pg_temp.id('V')), 'P0002', null, 'a draft cannot be reported by students');
select pg_temp.as_user(:'i1');
select publish_question_now(pg_temp.id('V'));

select pg_temp.as_user(:'s1');
select throws_ok(format($$select report_question(%L, 'nonsense')$$, pg_temp.id('V')), '22023', null, 'a reason is required');
select throws_ok(format($$select report_question(%L, 'other', '  ')$$, pg_temp.id('V')), '22023', null, '"other" needs a comment');
select lives_ok(format($$select report_question(%L, 'wrong_key', 'I think B is right')$$, pg_temp.id('V')), 'a student reports a live question');
select throws_ok(format($$select report_question(%L, 'typo')$$, pg_temp.id('V')), '23505', null, 'one open report per student per question');
select is((select count(*)::int from question_reports), 1, 'students see their own reports');
select throws_ok($$select question_report_list()$$, '42501', null, 'but not the instructor list');
select pg_temp.as_user(:'s2');
select is((select count(*)::int from question_reports), 0, 'other students do not see them');
select lives_ok(format($$select report_question(%L, 'unclear')$$, pg_temp.id('V')), 'a second student reports it too');

select pg_temp.as_user(:'i1');
select is((select count(*)::int from question_report_list('open', pg_temp.id('Q'))), 2, 'instructors see both open reports');
select ok((select reporter_code like 'S-%' from question_report_list() limit 1), 'reporters appear by short ID');
select lives_ok(format($$select resolve_question_report(%L, 'fixed', 'Key corrected in v2')$$,
  (select id from question_report_list() where reason = 'wrong_key')), 'an instructor marks it fixed');
select is((select count(*)::int from question_report_list('open')), 1, 'one left open');
reset role;
select ok(exists (select 1 from audit_log where table_name = 'question_reports' and action = 'resolve'), 'resolving is audited');
select * from finish();
rollback;
