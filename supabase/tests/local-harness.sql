-- Local test harness. NOT a migration and never applied to a Supabase project —
-- it recreates only what Supabase supplies, so the migrations under
-- supabase/migrations/ can be applied verbatim against a plain PostgreSQL.
--
-- auth.uid() matches Supabase's own implementation: it reads the `sub` claim out
-- of the request.jwt.claims GUC. Tests set that GUC to impersonate a person.

create extension if not exists pgcrypto;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);

create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), '')::uuid
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end $$;

grant usage on schema public, auth to anon, authenticated;
