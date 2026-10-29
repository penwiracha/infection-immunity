-- =====================================================================
-- Instructor authoring — security and workflow tests (pgTAP).
-- Supabase:  supabase test db        Local:  scripts/test-db.sh
-- Everything runs in one transaction and is rolled back.
-- =====================================================================
begin;
set search_path = public, extensions;
select plan(79);

\set admin   '00000000-0000-0000-0000-0000000000a1'
\set i1      '00000000-0000-0000-0000-0000000000b1'
\set i2      '00000000-0000-0000-0000-0000000000b2'
\set s1      '00000000-0000-0000-0000-0000000000c1'
\set s2      '00000000-0000-0000-0000-0000000000c2'
\set sneaky  '00000000-0000-0000-0000-0000000000c3'

-- ---- fixtures (as the database owner) --------------------------------
insert into auth.users (id, email) values
  (:'admin', 'admin@test'), (:'i1', 'i1@test'), (:'i2', 'i2@test'), (:'s1', 's1@test'), (:'s2', 's2@test');
update profiles set role = 'admin'      where id = :'admin';
update profiles set role = 'instructor' where id in (:'i1', :'i2');

create temp table ids (k text primary key, v uuid);
grant all on ids to public;

-- act as a signed-in user:  select pg_temp.as_user('<uuid>');
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
grant execute on function pg_temp.as_user(uuid) to public;

-- a valid question payload for lecture k='L1'
create function pg_temp.qpayload(p_stem text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'stem', p_stem,
    'options', jsonb_build_array('C3b opsonisation', 'Polysaccharide capsule', 'IgA protease', 'Antigenic variation'),
    'correct_option_id', 'B',
    'explanation', 'The capsule blocks C3b deposition and phagocytosis.',
    'niche', 'extra', 'topic', 'evasion',
    'lecture_id', (select v from ids where k = 'L1'),
    'organism_ids', jsonb_build_array('streptococcus-pneumoniae'),
    'tier', '1', 'bloom', 'understand', 'difficulty', 'medium') || p_extra
$$;
grant execute on function pg_temp.qpayload(text, jsonb) to public;

-- =====================================================================
-- 1. Roles cannot be self-assigned
-- =====================================================================
select pg_temp.as_user(:'s1');
select throws_ok(format($$update profiles set role = 'admin' where id = %L$$, :'s1'),
                 '42501', null, 'student cannot update their own role column');
select throws_ok(format($$select set_user_role(%L, 'admin')$$, :'s1'),
                 '42501', null, 'student cannot call set_user_role on themselves');
select lives_ok(format($$update profiles set display_name = 'Somchai' where id = %L$$, :'s1'),
                'student can still edit their display name');

select pg_temp.as_user(:'i1');
select throws_ok(format($$update profiles set role = 'admin' where id = %L$$, :'i1'),
                 '42501', null, 'instructor cannot promote themselves');
select throws_ok(format($$select set_user_role(%L, 'instructor')$$, :'s2'),
                 '42501', null, 'instructor cannot grant roles to others');

select pg_temp.as_user(:'admin');
select throws_ok(format($$select set_user_role(%L, 'student')$$, :'admin'),
                 '42501', null, 'admin cannot change their own role');
select lives_ok(format($$select set_user_role(%L, 'instructor')$$, :'s2'), 'admin can grant a role');
reset role;
select is((select role::text from profiles where id = :'s2'), 'instructor', 'role grant took effect');
select ok(exists (select 1 from audit_log where action = 'role_change' and row_id = :'s2' and actor_id = :'admin'),
          'role change is audited with the admin as actor');
update profiles set role = 'student' where id = :'s2';

-- metadata the user controls must not grant a role
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values (:'sneaky', 'sneaky@test', '{"role":"admin"}', '{"role":"admin"}');
select is((select role::text from profiles where id = :'sneaky'), 'student',
          'sign-up metadata claiming admin still creates a student');

-- =====================================================================
-- 2. Lectures: drafts hidden from students and other instructors
-- =====================================================================
select pg_temp.as_user(:'i1');
insert into ids select 'L1', save_lecture(jsonb_build_object(
  'number', 3, 'title', 'Extracellular bacteria', 'niche', 'extra',
  'summary', E'Capsule blocks C3b\n<script>alert("x")</script> stays text',
  'organism_ids', jsonb_build_array('streptococcus-pneumoniae'), 'cascade_step', 'extracellular:S3'));
select lives_ok(format($$select save_lecture(jsonb_build_object('id', %L, 'number', 3, 'title', 'Extracellular bacteria I', 'niche', 'extra',
                       'summary', E'Capsule blocks C3b\n<script>alert("x")</script> stays text'))$$,
                       (select v from ids where k = 'L1')), 'author edits own draft lecture');

select pg_temp.as_user(:'s1');
select is((select count(*)::int from lectures where id = (select v from ids where k = 'L1')), 0, 'student cannot read a draft lecture');
select throws_ok($$select save_lecture('{"number":9,"title":"x","niche":"extra"}')$$, '42501', null, 'student cannot create a lecture');
select throws_ok($$insert into lectures (number, title, niche, author_id) values (9, 'x', 'extra', auth.uid())$$,
                 '42501', null, 'student cannot insert into lectures directly');
select throws_ok($$update lectures set title = 'pwned'$$, '42501', null, 'student cannot update lectures directly');

select pg_temp.as_user(:'i2');
select is((select count(*)::int from lectures where id = (select v from ids where k = 'L1')), 0, 'other instructor cannot see my draft lecture');
select throws_ok(format($$select publish_lecture(%L)$$, (select v from ids where k = 'L1')), '42501', null,
                 'other instructor cannot publish my lecture');

select pg_temp.as_user(:'i1');
select lives_ok(format($$select publish_lecture(%L)$$, (select v from ids where k = 'L1')), 'author publishes lecture');

select pg_temp.as_user(:'s1');
select is((select count(*)::int from lectures where id = (select v from ids where k = 'L1')), 1, 'student sees the published lecture');
select is((select summary from lectures where id = (select v from ids where k = 'L1')),
          E'Capsule blocks C3b\n<script>alert("x")</script> stays text',
          'lecture text with a script tag is stored verbatim (rendered as text by the UI)');
select lives_ok(format($$select log_lecture_view(%L)$$, (select v from ids where k = 'L1')), 'student logs a lecture view');
select throws_ok(format($$select lecture_view_count(%L)$$, (select v from ids where k = 'L1')), '42501', null,
                 'student cannot read view counts');

select pg_temp.as_user(:'i1');
select is(lecture_view_count((select v from ids where k = 'L1')), 1, 'view count feeds the unpublish warning');

-- =====================================================================
-- 3. Questions: students cannot create, edit or read drafts or keys
-- =====================================================================
select pg_temp.as_user(:'i1');
insert into ids select 'Q1', (save_question(pg_temp.qpayload('Which feature lets S. pneumoniae resist phagocytosis?')) ->> 'question_id')::uuid;
insert into ids select 'Q1v1', id from question_versions where question_id = (select v from ids where k = 'Q1');

select pg_temp.as_user(:'s1');
select is((select count(*)::int from question_versions), 0, 'student cannot read draft question versions');
select is((select count(*)::int from questions), 0, 'student cannot read draft questions');
select is((select count(*)::int from question_keys), 0, 'student cannot read answer keys');
select throws_ok(format($$select save_question(%L::jsonb)$$, pg_temp.qpayload('Student-written item')), '42501', null,
                 'student cannot create a question');
select throws_ok($$insert into question_keys (version_id, correct_option_id, explanation) values (gen_random_uuid(), 'A', 'x')$$,
                 '42501', null, 'student cannot write answer keys');
select throws_ok($$update question_versions set stem = 'pwned'$$, '42501', null, 'student cannot edit question versions');
select throws_ok(format($$select submit_question(%L)$$, (select v from ids where k = 'Q1v1')), '42501', null,
                 'student cannot submit a question');

-- other instructors see drafts only once submitted
select pg_temp.as_user(:'i2');
select is((select count(*)::int from question_versions where id = (select v from ids where k = 'Q1v1')), 0,
          'other instructor cannot see my draft question');
select pg_temp.as_user(:'i1');
select lives_ok(format($$select submit_question(%L)$$, (select v from ids where k = 'Q1v1')), 'author submits for review');
select pg_temp.as_user(:'i2');
select is((select count(*)::int from question_versions where id = (select v from ids where k = 'Q1v1')), 1,
          'other instructor sees it once in review');

-- =====================================================================
-- 4. Review rules and pool restrictions
-- =====================================================================
select pg_temp.as_user(:'i1');
select throws_ok(format($$select review_question(%L, 'approved')$$, (select v from ids where k = 'Q1v1')), '42501', null,
                 'author cannot approve their own question');
select throws_ok(format($$select save_question(%L::jsonb)$$, pg_temp.qpayload('Monthly item', '{"pool":"monthly"}')), '42501', null,
                 'instructor cannot create an item in the monthly pool');
select throws_ok(format($$select save_question(%L::jsonb)$$, pg_temp.qpayload('Pretest item', '{"pool":"pretest"}')), '42501', null,
                 'instructor cannot create an item in the pretest pool');
select throws_ok(format($$select set_question_pool(%L, 'monthly')$$, (select v from ids where k = 'Q1')), '42501', null,
                 'instructor cannot move an item to the monthly pool');
select throws_ok(format($$select save_question(%L::jsonb)$$,
                        pg_temp.qpayload('Which feature lets S. pneumoniae resist phagocytosis?',
                                         jsonb_build_object('question_id', (select v from ids where k = 'Q1'), 'pool', 'pretest'))),
                 '42501', null, 'instructor cannot change the pool while editing');

select pg_temp.as_user(:'i2');
select throws_ok(format($$select review_question(%L, 'returned', '')$$, (select v from ids where k = 'Q1v1')), '22023', null,
                 'returning an item requires a comment');
select lives_ok(format($$select review_question(%L, 'approved', 'Clear stem')$$, (select v from ids where k = 'Q1v1')),
                'a different instructor approves');
select pg_temp.as_user(:'i1');
select lives_ok(format($$select publish_question(%L)$$, (select v from ids where k = 'Q1v1')), 'author puts the approved item live');

-- admin-only pools: admin may create pretest items; students never see them in practice
select pg_temp.as_user(:'admin');
insert into ids select 'Q2', (save_question(pg_temp.qpayload('Pretest: capsule function?', '{"pool":"pretest"}')) ->> 'question_id')::uuid;
insert into ids select 'Q2v1', id from question_versions where question_id = (select v from ids where k = 'Q2');
select submit_question((select v from ids where k = 'Q2v1'));
select pg_temp.as_user(:'i2');
select review_question((select v from ids where k = 'Q2v1'), 'approved');
select throws_ok(format($$select publish_question(%L)$$, (select v from ids where k = 'Q2v1')), '42501', null,
                 'only an admin can put a pretest item live');
select pg_temp.as_user(:'admin');
select lives_ok(format($$select publish_question(%L)$$, (select v from ids where k = 'Q2v1')), 'admin puts the pretest item live');

-- =====================================================================
-- 5. Students see live practice items but never keys; answers are recorded
-- =====================================================================
select pg_temp.as_user(:'s1');
select is((select count(*)::int from question_versions where id = (select v from ids where k = 'Q1v1')), 1, 'student sees the live practice item');
select is((select count(*)::int from question_versions where id = (select v from ids where k = 'Q2v1')), 0, 'student cannot browse live pretest items');
select is((select count(*)::int from question_keys), 0, 'student still cannot read any answer key');
select is((submit_answer((select v from ids where k = 'Q1v1'), 'A') ->> 'correct'), 'false', 'wrong answer is marked wrong');
select is((submit_answer((select v from ids where k = 'Q1v1'), 'B') ->> 'correct'), 'true', 'right answer is marked right');
select throws_ok(format($$select submit_answer(%L, 'A')$$, (select v from ids where k = 'Q2v1')), 'P0002', null,
                 'student cannot answer a pretest item through the practice path');

-- =====================================================================
-- 6. Editing a live question creates a new version; past answers untouched
-- =====================================================================
select pg_temp.as_user(:'i1');
create temp table edit_result as
  select save_question(pg_temp.qpayload('Which virulence factor lets S. pneumoniae evade phagocytosis?',
                                         jsonb_build_object('question_id', (select v from ids where k = 'Q1')))) as r;
grant select on edit_result to public;
select is((select (r ->> 'new_version')::boolean from edit_result), true, 'editing a live item opens a new version');
select is((select (r ->> 'version')::int from edit_result), 2, 'the new version is version 2');
insert into ids select 'Q1v2', (r ->> 'version_id')::uuid from edit_result;
select is((select status from question_versions where id = (select v from ids where k = 'Q1v1')), 'live',
          'version 1 keeps serving students while version 2 is reviewed');

reset role;
select throws_ok(format($$update question_versions set stem = 'rewritten' where id = %L$$, (select v from ids where k = 'Q1v1')),
                 '55000', null, 'a live version''s text cannot be changed, even by the owner role');
select throws_ok(format($$update question_keys set correct_option_id = 'A' where version_id = %L$$, (select v from ids where k = 'Q1v1')),
                 '55000', null, 'a live version''s answer key cannot be changed');

select pg_temp.as_user(:'i1');
select submit_question((select v from ids where k = 'Q1v2'));
select pg_temp.as_user(:'i2');
select review_question((select v from ids where k = 'Q1v2'), 'approved');
select publish_question((select v from ids where k = 'Q1v2'));
reset role;
select is((select status from question_versions where id = (select v from ids where k = 'Q1v1')), 'superseded', 'version 1 is superseded');
select is((select count(*)::int from answers where version_id = (select v from ids where k = 'Q1v1')), 2,
          'past answers still point at version 1');
select is((select stem from question_versions where id = (select v from ids where k = 'Q1v1')),
          'Which feature lets S. pneumoniae resist phagocytosis?', 'version 1 text is exactly what students saw');

-- =====================================================================
-- 7. Validation, script tags, AI import
-- =====================================================================
select pg_temp.as_user(:'i1');
select throws_ok(format($$select save_question(%L::jsonb)$$, pg_temp.qpayload('Dup options', '{"options":["A thing","a  thing","Other"]}')),
                 '22023', null, 'duplicate options are rejected');
select throws_ok(format($$select save_question(%L::jsonb)$$, pg_temp.qpayload('Two options', '{"options":["Yes","No"]}')),
                 '22023', null, 'fewer than 3 options are rejected');
select throws_ok(format($$select save_question(%L::jsonb)$$, pg_temp.qpayload('No explanation', '{"explanation":"  "}')),
                 '22023', null, 'an explanation is required');
select throws_ok(format($$select save_question(%L::jsonb)$$, pg_temp.qpayload('No topic', '{"topic":""}')),
                 '22023', null, 'a topic tag is required');
select throws_ok(format($$select save_question(%L::jsonb)$$, pg_temp.qpayload('Bad key', '{"correct_option_id":"E"}')),
                 '22023', null, 'the correct answer must be one of the options');
select is((select stem from similar_stems('Which virulence factor lets S. pneumoniae evade phagocytosis?') limit 1),
          'Which virulence factor lets S. pneumoniae evade phagocytosis?', 'near-duplicate stems are found');

insert into ids select 'Q3', (save_question(pg_temp.qpayload('<script>alert(1)</script> Which cell?')) ->> 'question_id')::uuid;
select is((select stem from question_versions where question_id = (select v from ids where k = 'Q3')),
          '<script>alert(1)</script> Which cell?', 'question text with a script tag is stored verbatim');

create temp table imp as
  select import_questions(jsonb_build_array(
           pg_temp.qpayload('AI item: which complement fragment opsonises?') || '{"status":"live","pool":"monthly"}',
           '{"stem":"broken"}'::jsonb), 'ai') as r;
grant select on imp to public;
select is((select r -> 0 ->> 'ok' from imp), 'true', 'valid imported row is saved');
select is((select r -> 1 ->> 'ok' from imp), 'false', 'invalid imported row is reported, not saved');
select results_eq(
  format($$select v.status, q.pool, q.source from questions q join question_versions v on v.question_id = q.id where q.id = %L$$,
         (select (r -> 0 ->> 'question_id') from imp)),
  $$values ('draft'::text, 'practice'::text, 'ai'::text)$$,
  'AI items import as practice drafts whatever the file claims');

-- =====================================================================
-- 8. Retirement and the audit log
-- =====================================================================
select pg_temp.as_user(:'i1');
select lives_ok(format($$select retire_question(%L)$$, (select v from ids where k = 'Q1')), 'author retires the item');
select lives_ok(format($$select unpublish_lecture(%L)$$, (select v from ids where k = 'L1')), 'author unpublishes the lecture');
select pg_temp.as_user(:'s1');
select is((select count(*)::int from question_versions where question_id = (select v from ids where k = 'Q1')), 0,
          'retired item leaves the student pool');
reset role;
select is((select count(*)::int from answers a join question_versions v on v.id = a.version_id
            where v.question_id = (select v from ids where k = 'Q1')), 2, 'retired item keeps its answer data');

select set_eq(
  format($$select distinct action from audit_log where table_name = 'question_versions'
           and new_values ->> 'question_id' = %L$$, (select v from ids where k = 'Q1')),
  array['create', 'edit', 'submit', 'approve', 'publish', 'supersede', 'retire'],
  'every question create, edit, submit, approval, publish and retirement is in audit_log');
select ok(exists (select 1 from audit_log where table_name = 'question_reviews' and action = 'approve' and actor_id = :'i2'),
          'the approval itself is audited with the reviewer as actor');
select ok(exists (select 1 from audit_log where table_name = 'questions' and action = 'retire'
                  and row_id = (select v::text from ids where k = 'Q1') and actor_id = :'i1'),
          'retirement is audited on the item');
select set_eq(
  format($$select distinct action from audit_log where table_name = 'lectures' and row_id = %L$$, (select v from ids where k = 'L1')),
  array['create', 'edit', 'publish', 'unpublish'],
  'every lecture create, edit, publish and unpublish is in audit_log');
select ok((select bool_and(old_values is not null) from audit_log where table_name = 'lectures' and action = 'edit'
           and row_id = (select v::text from ids where k = 'L1')), 'audit rows carry old values');

select pg_temp.as_user(:'i1');
select throws_ok($$update audit_log set action = 'nothing'$$, '42501', null, 'instructor cannot edit audit_log');
select throws_ok($$delete from audit_log$$, '42501', null, 'instructor cannot delete from audit_log');
reset role;
select throws_ok($$delete from audit_log$$, '42501', null, 'audit_log rejects deletes even from the owner role');

select * from finish();
rollback;
