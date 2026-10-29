-- =====================================================================
-- Student app + exams — security and behaviour tests (pgTAP).
-- Supabase:  supabase test db        Local:  scripts/test-db.sh
-- =====================================================================
begin;
set search_path = public, extensions;
select plan(67);

\set admin '00000000-0000-0000-0000-0000000000a1'
\set i1    '00000000-0000-0000-0000-0000000000b1'
\set i2    '00000000-0000-0000-0000-0000000000b2'
\set s1    '00000000-0000-0000-0000-0000000000c1'
\set s2    '00000000-0000-0000-0000-0000000000c2'

insert into auth.users (id, email) values
  (:'admin', 'admin@test'), (:'i1', 'i1@test'), (:'i2', 'i2@test'), (:'s1', 's1@test'), (:'s2', 's2@test');
update profiles set role = 'admin' where id = :'admin';
update profiles set role = 'instructor' where id in (:'i1', :'i2');

create temp table ids (k text primary key, v uuid);
grant all on ids to public;
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
grant execute on function pg_temp.as_user(uuid) to public;
create function pg_temp.q(p_stem text, p_pool text, p_niche text, p_topic text) returns jsonb language sql as $$
  select jsonb_build_object('stem', p_stem, 'options', jsonb_build_array('Alpha', 'Bravo', 'Charlie', 'Delta'),
    'correct_option_id', 'B', 'explanation', 'Because Bravo.', 'niche', p_niche, 'topic', p_topic,
    'lecture_id', (select v from ids where k = 'L'), 'pool', p_pool)
$$;
grant execute on function pg_temp.q(text, text, text, text) to public;

-- make + publish one item through the real workflow (as the admin)
create function pg_temp.live_item(k text, p jsonb) returns void language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  r := save_question(p);
  insert into ids values (k, (r ->> 'question_id')::uuid), (k || 'v', (r ->> 'version_id')::uuid);
  perform publish_question_now((r ->> 'version_id')::uuid);
  execute 'reset role';
end $$;
grant execute on function pg_temp.live_item(text, jsonb) to public;

select pg_temp.as_user(:'i1');
insert into ids select 'L', save_lecture('{"number":1,"title":"Innate immunity","niche":"extra"}');
select publish_lecture((select v from ids where k = 'L'));
reset role;

select pg_temp.live_item('P1', pg_temp.q('Practice one about capsules', 'practice', 'extra', 'evasion'));
select pg_temp.live_item('P2', pg_temp.q('Practice two about interferon', 'practice', 'cyto', 'immune-response'));
select pg_temp.live_item('T1', pg_temp.q('Pretest one about complement', 'pretest', 'extra', 'evasion'));
select pg_temp.live_item('T2', pg_temp.q('Pretest two about granulomas', 'pretest', 'vesic', 'immune-response'));
select pg_temp.live_item('M1', pg_temp.q('Monthly one about IgE', 'monthly', 'surf', 'immune-response'));

-- =====================================================================
-- Cohorts
-- =====================================================================
select pg_temp.as_user(:'i1');
insert into ids select 'C', save_cohort('2567', '2026-06-01');
insert into ids select 'C2', save_cohort('2568');
select lives_ok(format($$select set_student_cohort(%L, %L)$$, :'s1', (select v from ids where k = 'C')), 'instructor assigns a cohort');
select set_student_cohort(:'s2', (select v from ids where k = 'C2'));
select pg_temp.as_user(:'s1');
select throws_ok(format($$update profiles set cohort_id = %L where id = %L$$, (select v from ids where k = 'C2'), :'s1'),
                 '42501', null, 'student cannot move themselves to another cohort');
select throws_ok(format($$select set_student_cohort(%L, %L)$$, :'s1', (select v from ids where k = 'C2')),
                 '42501', null, 'student cannot call set_student_cohort');
select throws_ok($$select save_cohort('hack')$$, '42501', null, 'student cannot create cohorts');

-- =====================================================================
-- Consent and the pre-test gate
-- =====================================================================
select pg_temp.as_user(:'i1');
insert into ids select 'E', save_exam(jsonb_build_object('kind', 'pretest', 'title', 'Pre-test 2567',
                                     'cohort_id', (select v from ids where k = 'C'), 'duration_min', 30));
select throws_ok(format($$select set_exam_items(%L, array[%L]::uuid[])$$, (select v from ids where k = 'E'), (select v from ids where k = 'P1')),
                 '22023', null, 'a practice item cannot go into a pre-test');
select is(set_exam_items((select v from ids where k = 'E'), array[(select v from ids where k = 'T1'), (select v from ids where k = 'T2')]),
          2, 'pre-test items set');

select pg_temp.as_user(:'s1');
select is((select count(*)::int from exams), 0, 'student cannot see a draft exam');
select is((my_status() -> 'pretest' ->> 'state'), 'none', 'no gate while the pre-test is a draft');
select throws_ok(format($$select start_exam(%L)$$, (select v from ids where k = 'E')), 'P0002', null, 'student cannot start a draft exam');

select pg_temp.as_user(:'i1');
select lives_ok(format($$select set_exam_status(%L, 'open')$$, (select v from ids where k = 'E')), 'instructor opens the pre-test');

select pg_temp.as_user(:'s2');
select is((select count(*)::int from exams), 0, 'a student in another cohort does not see it');
select is((my_status() -> 'pretest' ->> 'state'), 'none', 'and is not gated by it');

select pg_temp.as_user(:'s1');
select is((my_status() -> 'pretest' ->> 'state'), 'todo', 'student in the cohort must take the pre-test');
select throws_ok(format($$select start_exam(%L)$$, (select v from ids where k = 'E')), '42501', null, 'consent is required before starting');
select throws_ok($$select set_consent(false, true)$$, '22023', null, 'platform consent cannot be declined and still continue');
select lives_ok($$select set_consent(true, false)$$, 'student records consent (research declined)');

create temp table att as select start_exam((select v from ids where k = 'E')) as r;
grant select on att to public;
select is((select jsonb_array_length(r -> 'items') from att), 2, 'start_exam returns the items');
select ok((select (r -> 'items')::text from att) !~ 'correct|explanation|Because', 'start_exam sends no keys or explanations');
select is((my_status() -> 'pretest' ->> 'state'), 'in_progress', 'gate shows the pre-test as in progress');
select is((select count(*)::int from exam_items), 0, 'student cannot read exam_items');
select is((select count(*)::int from question_versions where question_id in (select v from ids where k in ('T1', 'T2'))), 0,
          'student cannot read pre-test questions directly');
select is((select count(*)::int from question_keys), 0, 'student cannot read keys');
select lives_ok(format($$select save_exam_response(%L, 1, 'B', 'sure', false)$$, (select (r ->> 'attempt_id') from att)), 'answer saved');
select lives_ok(format($$select save_exam_response(%L, 2, 'A', 'guess', true)$$, (select (r ->> 'attempt_id') from att)), 'second answer saved, flagged');
select throws_ok(format($$select save_exam_response(%L, 1, 'Z')$$, (select (r ->> 'attempt_id') from att)), '22023', null, 'unknown option rejected');
select is((select count(*)::int from exam_responses), 0, 'student cannot read exam_responses (no per-item key leak)');

create temp table res as select submit_exam((select (r ->> 'attempt_id')::uuid from att)) as r;
grant select on res to public;
select is((select (r ->> 'score')::numeric from res), 50.0, 'submission is scored');
select is((select jsonb_array_length(r -> 'by_niche') from res), 2, 'result is broken down by niche');
select throws_ok(format($$select save_exam_response(%L, 1, 'A')$$, (select (r ->> 'attempt_id') from att)), '55000', null, 'no changes after submitting');
select throws_ok(format($$select start_exam(%L)$$, (select v from ids where k = 'E')), '55000', null, 'cannot retake a submitted exam');
select is((my_status() -> 'pretest' ->> 'state'), 'done', 'gate opens once submitted');

select pg_temp.as_user(:'s2');
select throws_ok(format($$select exam_result(%L)$$, (select (r ->> 'attempt_id') from att)), 'P0002', null, 'another student cannot read my result');

select pg_temp.as_user(:'i1');
select is((exam_detail((select v from ids where k = 'E')) -> 'attempts' -> 0 ->> 'score')::numeric, 50.0, 'instructor sees the attempt');
select throws_ok(format($$select set_exam_status(%L, 'draft')$$, (select v from ids where k = 'E')), '55000', null,
                 'an exam with attempts cannot go back to draft');
select is((select count(*)::int from exam_list() where id = (select v from ids where k = 'E') and submitted = 1), 1, 'exam_list counts submissions');

-- =====================================================================
-- Spaced review, flashcards, confidence, bookmarks
-- =====================================================================
select pg_temp.as_user(:'s1');
select is((select count(*)::int from session_cards('due')), 2, 'new practice cards appear in a due session');
select ok((select bool_and(is_new) from session_cards('due')), 'and are marked new');
select is((select count(*)::int from session_cards('mixed') where question_id in (select v from ids where k in ('T1','T2','M1'))), 0,
          'exam-pool items never become practice cards');
select is((reveal_card((select v from ids where k = 'P1v')) ->> 'answer'), 'Bravo', 'flashcard reveals the keyed answer');
select throws_ok(format($$select reveal_card(%L)$$, (select v from ids where k = 'T1v')), 'P0002', null, 'flashcards cannot reveal pre-test keys');
select ok((review_card((select v from ids where k = 'P1'), 'good') ->> 'interval_days')::real = 3, 'good on a new card = 3 days');
select ok((select due_at > now() + interval '2 days' from srs_state where question_id = (select v from ids where k = 'P1')), 'due date moved');
select ok((review_card((select v from ids where k = 'P1'), 'again') ->> 'interval_days')::real = 0, 'again resets the interval');
select ok((select due_at < now() + interval '11 minutes' from srs_state where question_id = (select v from ids where k = 'P1')), 'again = 10 minutes');
select is((submit_answer((select v from ids where k = 'P2v'), 'A', 'sure') ->> 'correct'), 'false', 'confidently wrong answer recorded');
select is((select confidence from answers where version_id = (select v from ids where k = 'P2v')), 'sure', 'confidence is stored');
select is((select last_rating from srs_state where question_id = (select v from ids where k = 'P2')), 'again', 'a wrong answer schedules the card again');
select throws_ok($$select submit_answer(gen_random_uuid(), 'A', 'certain')$$, '22023', null, 'unknown confidence rejected');
select is(toggle_bookmark('evasion'), true, 'bookmark a topic');
select throws_ok($$select toggle_bookmark('not-a-topic')$$, '22023', null, 'only known topics can be bookmarked');
select is((select count(*)::int from session_cards('topics', array['evasion'])), 1, 'bookmarked-topic session');
select is((my_progress(30) ->> 'streak')::int, 1, 'studying today starts a streak');
select ok((my_progress(30) -> 'confidence' ->> 'confidently_wrong_pct') is not null, 'progress reports confidently wrong answers');

select pg_temp.as_user(:'s2');
select is((select count(*)::int from srs_state), 0, 'students cannot see each other''s review schedule');

-- =====================================================================
-- Instructor reporting by cohort and period
-- =====================================================================
select pg_temp.as_user(:'i1');
select is((cohort_overview((select v from ids where k = 'C'), 30) ->> 'students')::int, 1, 'cohort filter counts one student');
select is((cohort_overview((select v from ids where k = 'C'), 30) ->> 'pretest_avg')::numeric, 50::numeric, 'pre-test average for the cohort');
select ok(jsonb_array_length(cohort_overview(null, 30) -> 'topics') >= 1, 'topic accuracy rows are returned');
select is((select count(*)::int from student_summary((select v from ids where k = 'C2'), 30)), 1, 'student list filtered by cohort');
select is((research_export(null) ->> 'consented')::int, 0, 'research export only includes consenting students');
select lives_ok($$select log_names_shown()$$, 'revealing names is logged');
select ok((select count(*) from item_stats(null, 30)) >= 1, 'item stats by period');
insert into ids select 'EM', save_exam('{"kind":"monthly","title":"Check-in 1","duration_min":30}');
select is(pick_exam_items((select v from ids where k = 'EM'), 5), 1, 'auto-pick takes only live monthly items');
select set_exam_status((select v from ids where k = 'EM'), 'open');
select pg_temp.as_user(:'s1');
select is((select count(*)::int from my_exams()), 2, 'student sees the pre-test and the open check-in');
select mark_lecture_read((select v from ids where k = 'L'));
select is((select completed from my_lecture_status() where lecture_id = (select v from ids where k = 'L')), true, 'lecture marked as read');
select throws_ok($$select cohort_overview()$$, '42501', null, 'students cannot read cohort reports');
select throws_ok($$select research_export()$$, '42501', null, 'students cannot export research data');
reset role;
select ok(exists (select 1 from audit_log where table_name = 'exams' and action = 'publish'), 'opening an exam is audited');

select * from finish();
rollback;
