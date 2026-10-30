-- Theme, bookmarks of any kind, students' own flashcards, hiding lectures and questions (0008).
begin;
set search_path = public, extensions;
select plan(53);

\set admin '00000000-0000-0000-0000-0000000000a1'
\set i1    '00000000-0000-0000-0000-0000000000b1'
\set i2    '00000000-0000-0000-0000-0000000000b2'
\set s1    '00000000-0000-0000-0000-0000000000c1'
\set s2    '00000000-0000-0000-0000-0000000000c2'
insert into auth.users (id, email) values (:'admin', 'a@t'), (:'i1', 'i1@t'), (:'i2', 'i2@t'), (:'s1', 's1@t'), (:'s2', 's2@t');
update profiles set role = 'admin' where id = :'admin';
update profiles set role = 'instructor' where id in (:'i1', :'i2');
create temp table ids (k text primary key, v uuid); grant all on ids to public;
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
grant execute on function pg_temp.as_user(uuid) to public;
create function pg_temp.id(p text) returns uuid language sql as $$ select v from ids where k = p $$;
grant execute on function pg_temp.id(text) to public;
create function pg_temp.q(p_stem text, p_lec text) returns jsonb language sql as $$
  select jsonb_build_object('stem', p_stem, 'options', jsonb_build_array('Alpha', 'Bravo', 'Charlie'),
    'correct_option_id', 'A', 'explanation', 'Because.', 'niche', 'extra', 'topic', 'evasion',
    'organism_ids', jsonb_build_array((select id from vocab where kind = 'organism' order by sort, id limit 1)),
    'lecture_id', (select v from ids where k = p_lec), 'pool', 'practice')
$$;
grant execute on function pg_temp.q(text, text) to public;

-- content: lecture L1 with Q1 (unused) and Q2 (answered); lecture L2 with Q3
select pg_temp.as_user(:'i1');
insert into ids select 'L1', save_lecture('{"number":1,"title":"L1","niche":"extra"}');
insert into ids select 'L2', save_lecture('{"number":2,"title":"L2","niche":"extra"}');
select publish_lecture(pg_temp.id('L1')); select publish_lecture(pg_temp.id('L2'));
create temp table r as select k, save_question(pg_temp.q('Stem ' || k, l)) as j
  from (values ('1', 'L1'), ('2', 'L1'), ('3', 'L2')) x(k, l);
grant select on r to public;
insert into ids select 'Q' || k, (j ->> 'question_id')::uuid from r;
insert into ids select 'V' || k, (j ->> 'version_id')::uuid from r;
select publish_question_now(pg_temp.id('V' || k)) from (values ('1'), ('2'), ('3')) x(k);
select pg_temp.as_user(:'s1');
select submit_answer(pg_temp.id('V2'), 'A', 'sure');

-- ===== theme =====
select lives_ok($$update profiles set theme = 'dark' where id = auth.uid()$$, 'a user can set their own theme');
select is((select theme from profiles where id = auth.uid()), 'dark', 'the theme is saved');
select throws_ok($$update profiles set theme = 'neon' where id = auth.uid()$$, '23514', null, 'only system, light or dark');

-- ===== hiding questions =====
select pg_temp.as_user(:'i2');
select throws_ok(format($$select set_question_hidden(%L, true)$$, pg_temp.id('Q1')), '42501', null, 'only the author or an admin can hide a question');
select pg_temp.as_user(:'i1');
select throws_ok(format($$select set_question_hidden(%L, true)$$, pg_temp.id('Q2')), '55000', null, 'a question students have answered cannot be hidden');
select lives_ok(format($$select set_question_hidden(%L, true)$$, pg_temp.id('Q1')), 'an unused question can be hidden by its author');
select isnt((select hidden_at from question_list() where question_id = pg_temp.id('Q1')), null, 'the question bank shows it as hidden');
select pg_temp.as_user(:'s1');
select is((select count(*)::int from question_versions where question_id = pg_temp.id('Q1')), 0, 'students cannot read a hidden question');
select is((select count(*)::int from session_cards('mixed', null, 50) where question_id = pg_temp.id('Q1')), 0, 'it is not in practice sessions');
select throws_ok(format($$select submit_answer(%L, 'A')$$, pg_temp.id('V1')), 'P0002', null, 'and cannot be answered');
select throws_ok(format($$select reveal_card(%L)$$, pg_temp.id('V1')), 'P0002', null, 'or turned over as a flashcard');
select pg_temp.as_user(:'i1');
select throws_ok(format($$select set_question_hidden(%L, true)$$, gen_random_uuid()), 'P0002', null, 'unknown question');
select lives_ok(format($$select set_question_hidden(%L, false)$$, pg_temp.id('Q1')), 'a hidden question can be shown again');
select pg_temp.as_user(:'s1');
select is((select count(*)::int from question_versions where question_id = pg_temp.id('Q1')), 1, 'students see it again');
reset role;
select ok(exists (select 1 from audit_log where table_name = 'questions' and action = 'hide' and row_id = pg_temp.id('Q1')::text), 'hiding is audited');
select ok(exists (select 1 from audit_log where table_name = 'questions' and action = 'unhide' and row_id = pg_temp.id('Q1')::text), 'showing is audited');
select ok(exists (select 1 from content_events where event_type = 'question_hidden' and question_id = pg_temp.id('Q1')), 'and logged as an event');

-- hidden items are never picked for an exam
select pg_temp.as_user(:'admin');
insert into ids select 'MQ', (save_question(pg_temp.q('Monthly item', 'L1') || '{"pool":"monthly"}') ->> 'question_id')::uuid;
select publish_question_now((select id from question_versions where question_id = pg_temp.id('MQ')));
select set_question_hidden(pg_temp.id('MQ'), true);
insert into ids select 'E', save_exam('{"kind":"monthly","title":"Check-in"}');
select is(pick_exam_items(pg_temp.id('E'), 5), 0, 'a hidden item is not auto-picked');
select throws_ok(format($$select set_exam_items(%L, array[%L]::uuid[])$$, pg_temp.id('E'), pg_temp.id('MQ')), '22023', null, 'or added by hand');

-- ===== hiding lectures =====
select pg_temp.as_user(:'i2');
select throws_ok(format($$select set_lecture_hidden(%L, true)$$, pg_temp.id('L1')), '42501', null, 'only the author or an admin can hide a lecture');
select pg_temp.as_user(:'i1');
select lives_ok(format($$select set_lecture_hidden(%L, true)$$, pg_temp.id('L1')), 'the author hides a published lecture (even one students used)');
select pg_temp.as_user(:'s1');
select is((select count(*)::int from lectures where id = pg_temp.id('L1')), 0, 'students cannot see a hidden lecture');
select is((select count(*)::int from session_cards('mixed', null, 50) s join question_versions v on v.id = s.version_id
            where v.lecture_id = pg_temp.id('L1')), 0, 'its practice questions leave practice too');
select is((select count(*)::int from session_cards('mixed', null, 50)), 1, 'other lectures are untouched');
select throws_ok(format($$select log_lecture_view(%L)$$, pg_temp.id('L1')), 'P0002', null, 'a hidden lecture cannot be opened');
select pg_temp.as_user(:'i2');
select is((select count(*)::int from lectures where id = pg_temp.id('L1')), 1, 'other instructors still see it');
select pg_temp.as_user(:'i1');
select set_lecture_hidden(pg_temp.id('L1'), false);
select pg_temp.as_user(:'s1');
select is((select count(*)::int from lectures where id = pg_temp.id('L1')), 1, 'shown again');
reset role;
select ok(exists (select 1 from content_events where event_type = 'lecture_hidden' and lecture_id = pg_temp.id('L1')), 'hiding a lecture is logged');

-- ===== bookmarks of any kind =====
select pg_temp.as_user(:'s1');
select is(toggle_saved('lecture', pg_temp.id('L2')::text), true, 'bookmark a lecture');
select is(toggle_saved('organism', (select id from vocab where kind = 'organism' order by sort, id limit 1)), true, 'bookmark an organism');
select is(toggle_bookmark('evasion'), true, 'bookmark a topic (old call still works)');
select throws_ok($$select toggle_saved('disease', 'not-a-disease')$$, '22023', null, 'unknown ids are refused');
select throws_ok(format($$select toggle_saved('lecture', %L)$$, gen_random_uuid()), '22023', null, 'unknown lectures are refused');
select is(jsonb_array_length(my_status() -> 'saved'), 3, 'my_status lists every bookmark');
select is(my_status() -> 'bookmarks', '["evasion"]'::jsonb, 'and the topic ids as before');
select is((select count(*)::int from session_cards('saved', null, 50, jsonb_build_array(jsonb_build_object('kind', 'lecture', 'ref', pg_temp.id('L2'))))), 1,
          'a saved session can use the ticked bookmarks only');
select is(toggle_saved('lecture', pg_temp.id('L2')::text), false, 'toggling again removes it');

-- ===== students' own flashcards =====
select throws_ok($$select save_my_card('{"front":"  ","back":"x"}')$$, '22023', null, 'a card needs a front');
insert into ids select 'C', save_my_card('{"front":"Capsule?","back":"Blocks C3b","topic":"evasion"}');
select is((select count(*)::int from my_card_session('due')), 1, 'a new card is due at once');
select lives_ok(format($$select review_my_card(%L, 'good')$$, pg_temp.id('C')), 'the student rates it');
select is((select count(*)::int from my_card_session('due')), 0, 'then it waits');
select is((select count(*)::int from my_card_session('mine')), 1, 'and is still in their deck');
select pg_temp.as_user(:'s2');
select is((select count(*)::int from student_cards), 0, 'other students cannot read it');
select throws_ok(format($$select review_my_card(%L, 'good')$$, pg_temp.id('C')), 'P0002', null, 'or rate it');
select throws_ok(format($$select save_my_card('{"id":"%s","front":"x","back":"y"}')$$, pg_temp.id('C')), 'P0002', null, 'or edit it');
select pg_temp.as_user(:'i1');
select is((select count(*)::int from student_cards), 0, 'instructors cannot read it');
select is((select count(*)::int from audit_log where table_name = 'student_cards'), 0, 'nor its audit rows');
select throws_ok($$select student_card_list()$$, '42501', null, 'the card list is for admins');
select pg_temp.as_user(:'s1');
select lives_ok(format($$select delete_my_card(%L)$$, pg_temp.id('C')), 'the student deletes it');
select is((select count(*)::int from my_cards()), 0, 'it leaves their deck');
select pg_temp.as_user(:'admin');
select isnt((select deleted_at from student_card_list() where id = pg_temp.id('C')), null, 'admins still see it, marked deleted');
select is((select reviews from student_card_list() where id = pg_temp.id('C')), 1, 'with its review count');
select is((select array_agg(action order by id) from audit_log where table_name = 'student_cards'), array['create', 'delete'], 'creating and deleting are in the audit log');

select * from finish();
rollback;
