-- People & roles: admin list, staff invites, sign-up with an invite code (0011).
begin;
set search_path = public, extensions;
select plan(16);
\set admin '00000000-0000-0000-0000-0000000000a1'
\set i1    '00000000-0000-0000-0000-0000000000b1'
\set s1    '00000000-0000-0000-0000-0000000000c1'
insert into auth.users (id, email) values (:'admin', 'a@t.ac.th'), (:'i1', 'i1@t.ac.th'), (:'s1', 's1@t.ac.th');
update profiles set role = 'admin' where id = :'admin';
update profiles set role = 'instructor' where id = :'i1';
create temp table inv (k text primary key, j jsonb); grant all on inv to public;
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
grant execute on function pg_temp.as_user(uuid) to public;

select pg_temp.as_user(:'i1');
select throws_ok($$select people_list()$$, '42501', null, 'instructors cannot list everyone');
select throws_ok($$select create_staff_invite('x@t.ac.th', 'instructor')$$, '42501', null, 'or invite staff');
select throws_ok(format($$select set_user_role(%L, 'admin')$$, :'s1'), '42501', null, 'or change roles');

select pg_temp.as_user(:'admin');
select is((select count(*)::int from people_list()), 3, 'admins see everyone');
select is((select role::text from people_list() where email = 'a@t.ac.th'), 'admin', 'with their role');
select lives_ok(format($$select set_user_role(%L, 'instructor')$$, :'s1'), 'an admin promotes a student');
select isnt((select role_changed_at from people_list() where user_id = :'s1'), null, 'the list shows when the role changed');
select throws_ok(format($$select set_user_role(%L, 'student')$$, :'admin'), '42501', null, 'nobody changes their own role');
select throws_ok($$select create_staff_invite('i1@t.ac.th', 'instructor')$$, '23505', null, 'existing accounts are changed in the list, not invited');
select throws_ok($$select create_staff_invite('not-an-email', 'instructor')$$, '22023', null, 'a real email is needed');
insert into inv select 'new', create_staff_invite(' New.Teacher@T.ac.th ', 'instructor');
select is((select length(j ->> 'code') from inv), 10, 'invites get a 10-character code');
select is((select state from staff_invite_list() where email = 'new.teacher@t.ac.th'), 'open', 'listed as open');
reset role;

-- sign-ups: wrong email with the code -> student; right email -> instructor, once
insert into auth.users (id, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-0000000000d1', 'someone.else@t.ac.th', jsonb_build_object('class_code', (select j ->> 'code' from inv)));
select is((select role::text from profiles where id = '00000000-0000-0000-0000-0000000000d1'), 'student', 'the code only works with the invited email');
insert into auth.users (id, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-0000000000d2', 'new.teacher@t.ac.th', jsonb_build_object('class_code', lower((select j ->> 'code' from inv))));
select is((select role::text from profiles where id = '00000000-0000-0000-0000-0000000000d2'), 'instructor', 'the invited person signs up as an instructor');
select isnt((select used_at from staff_invites where email = 'new.teacher@t.ac.th'), null, 'the invite is used up');
select ok(exists (select 1 from audit_log where table_name = 'staff_invites' and action = 'invite'), 'invites are audited');
select * from finish();
rollback;
