-- Local test harness. NOT a migration and never applied to a Supabase project —
-- it recreates only what Supabase supplies, so the migrations under
-- supabase/migrations/ can be applied verbatim against a plain PostgreSQL.
--
-- auth.uid() matches Supabase's own implementation: it reads the `sub` claim out
-- of the request.jwt.claims GUC. Tests set that GUC to impersonate a person.

-- Supabase installs extensions into their own schema, not public, and does not
-- put that schema on the search_path of a function that pins one. Mirroring
-- that here is deliberate: it makes an unqualified pgcrypto call fail locally
-- exactly as it fails in production, instead of passing because the harness
-- was more generous than the real thing.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb
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

grant usage on schema public, auth, extensions to anon, authenticated;
