-- Account settings: own name, email sync, no access to other people's profiles.
begin;
set search_path = public, extensions;
select plan(6);

\set s1 '00000000-0000-0000-0000-0000000000c1'
\set s2 '00000000-0000-0000-0000-0000000000c2'
insert into auth.users (id, email) values (:'s1', 'one@test'), (:'s2', 'two@test');

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
grant execute on function pg_temp.as_user(uuid) to public;

select pg_temp.as_user(:'s1');
select lives_ok(format($$update profiles set display_name = 'Somchai J.' where id = %L$$, :'s1'), 'a user can rename themselves');
select throws_ok(format($$update profiles set display_name = %L where id = %L$$, repeat('x', 81), :'s1'), '23514', null, 'names are limited to 80 characters');
update profiles set display_name = 'hacked' where id = :'s2';
reset role;
select is((select display_name from profiles where id = :'s2'), 'two', 'a user cannot rename someone else');
select throws_ok(format($$set local role authenticated; select set_config('request.jwt.claims', '{"sub":"%s"}', true); update profiles set email = 'x@y' where id = '%s'$$, :'s1', :'s1'),
                 '42501', null, 'the email column is not directly writable');
reset role;
update auth.users set email = 'one.new@test' where id = :'s1';
select is((select email from profiles where id = :'s1'), 'one.new@test', 'changing the sign-in email updates the profile');
select is((select display_name from profiles where id = :'s1'), 'Somchai J.', 'the new name was saved');

select * from finish();
rollback;
