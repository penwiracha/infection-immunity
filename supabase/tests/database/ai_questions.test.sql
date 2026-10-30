-- AI question generation bookkeeping (0010). The Typhoon call itself runs in the Edge Function.
begin;
set search_path = public, extensions;
select plan(11);
\set i1 '00000000-0000-0000-0000-0000000000b1'
\set i2 '00000000-0000-0000-0000-0000000000b2'
\set s1 '00000000-0000-0000-0000-0000000000c1'
insert into auth.users (id, email) values (:'i1', 'i1@t'), (:'i2', 'i2@t'), (:'s1', 's1@t');
update profiles set role = 'instructor' where id in (:'i1', :'i2');
create temp table ids (k text primary key, v uuid); grant all on ids to public;
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
grant execute on function pg_temp.as_user(uuid) to public;

select pg_temp.as_user(:'i1');
insert into ids select 'L', save_lecture('{"number":1,"title":"L1","niche":"extra","summary":"Capsule blocks C3b"}');
select publish_lecture((select v from ids where k = 'L'));

select pg_temp.as_user(:'s1');
select throws_ok(format($$select ai_generation_begin(%L, 5, 'lecture')$$, (select v from ids where k = 'L')), '42501', null, 'students cannot generate');

select pg_temp.as_user(:'i1');
create temp table g1 as select ai_generation_begin((select v from ids where k = 'L'), 10, 'lecture') as j; grant select on g1 to public;
select is((select j -> 'lecture' ->> 'summary' from g1), 'Capsule blocks C3b', 'the lecture summary comes back for the prompt');
select ok((select jsonb_array_length(j -> 'vocab' -> 'topic') > 0 from g1), 'and the allowed tag ids');
select is((select (j ->> 'remaining')::int from g1), 90, 'daily allowance counts down');
select throws_ok(format($$select ai_generation_begin(%L, 5, 'lecture')$$, (select v from ids where k = 'L')), '55000', null, 'one generation at a time');
select lives_ok(format($$select ai_generation_finish(%L, 'done', 'typhoon-test', 8, 2)$$, (select (j ->> 'id')::uuid from g1)), 'finish records the outcome');
select throws_ok(format($$select ai_generation_begin(%L, 21, 'pdf', 'notes.pdf', 5000)$$, (select v from ids where k = 'L')), '22023', null, 'at most 20 per request');
select throws_ok(format($$select ai_generation_begin(%L, 5, 'lecture')$$, gen_random_uuid()), '22023', null, 'a real lecture is required');
-- use up the allowance (written directly by the test, as the table owner)
reset role;
insert into ai_generations (user_id, lecture_id, source, n_requested, status) select :'i1', v, 'lecture', 20, 'done' from ids, generate_series(1, 4) where k = 'L';
select pg_temp.as_user(:'i1');
select throws_ok(format($$select ai_generation_begin(%L, 15, 'lecture')$$, (select v from ids where k = 'L')), '54000', null, 'the daily limit holds');
select pg_temp.as_user(:'i2');
select is((select count(*)::int from ai_generation_list()), 0, 'instructors see only their own generations');
reset role;
select ok(exists (select 1 from content_events where event_type = 'questions_generated'), 'generating is logged');
select * from finish();
rollback;
