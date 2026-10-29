-- Minimal stand-in for the parts of Supabase the migrations rely on, so the
-- test suite can run against plain Postgres (scripts/test-db.sh). Do NOT run it against a real Supabase project. On a real
-- Supabase project none of this is needed: `supabase test db` uses the real thing.
create schema if not exists auth;
create schema if not exists extensions;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}',
  raw_app_meta_data jsonb default '{}',
  created_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
grant usage on schema auth, extensions, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
-- Supabase's default: API roles get every privilege on new public objects; RLS does the filtering.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create extension if not exists pgtap with schema extensions;
