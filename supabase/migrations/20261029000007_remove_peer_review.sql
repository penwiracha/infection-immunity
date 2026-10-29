-- =====================================================================
-- 0007 remove the last of peer review
--   * versions left "in review" or "approved" (never live) go back to draft,
--     so their authors can simply publish them
--   * those two states can no longer be set
--   * submit_question / review_question / publish_question are dropped;
--     publish_question_now (0006) is the only way to put a question live
--   * question_reviews is kept, read-only, as history
-- =====================================================================

select set_config('app.audit_action', 'cleanup', true);
update public.question_versions
   set status = 'draft', submitted_at = null, approved_by = null, approved_at = null
 where status in ('in_review', 'approved');

alter table public.question_versions drop constraint if exists question_versions_status_check;
alter table public.question_versions
  add constraint question_versions_status_check check (status in ('draft', 'live', 'superseded', 'retired'));

drop index if exists public.question_versions_one_open;
create unique index question_versions_one_open on public.question_versions (question_id) where status = 'draft';

drop function if exists public.submit_question(uuid);
drop function if exists public.review_question(uuid, text, text);
drop function if exists public.publish_question(uuid);
