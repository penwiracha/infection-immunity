-- Interface language on the profile (0009).
begin;
set search_path = public, extensions;
select plan(4);
\set s1 '00000000-0000-0000-0000-0000000000c1'
\set s2 '00000000-0000-0000-0000-0000000000c2'
insert into auth.users (id, email) values (:'s1', 's1@t'), (:'s2', 's2@t');
select is((select lang from profiles where id = :'s1'), 'en', 'English by default');
select set_config('request.jwt.claims', json_build_object('sub', :'s1', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$update profiles set lang = 'th' where id = auth.uid()$$, 'a user can choose Thai');
select throws_ok($$update profiles set lang = 'fr' where id = auth.uid()$$, '23514', null, 'only en or th');
update profiles set lang = 'th' where id = :'s2';   -- RLS: someone else's row is not updated
reset role;
select is((select lang from profiles where id = :'s2'), 'en', 'nobody can change another user''s language');
select * from finish();
rollback;
