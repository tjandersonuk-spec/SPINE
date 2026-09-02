-- Phase 1 — guards and derived reads. Reference: §1b.
--
-- Every function that reads a membership table is SECURITY DEFINER on purpose.
-- The RLS policies in 0003 call these functions, and those policies sit on the
-- very tables the functions read; without the bypass, Postgres recurses.
-- search_path is pinned on each so a caller cannot shadow a table name.

create or replace function is_platform_owner()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from platform_owners where profile_id = auth.uid())
$$;

create or replace function account_role(p_org uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select role from organisation_members
  where organisation_id = p_org and profile_id = auth.uid()
$$;

create or replace function is_account_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from organisation_members
    where organisation_id = p_org and profile_id = auth.uid())
$$;

create or replace function is_account_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from organisation_members
    where organisation_id = p_org and profile_id = auth.uid() and role = 'admin')
$$;

-- admin and internal see every project in their account with no project_members row
create or replace function is_account_staff(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from organisation_members
    where organisation_id = p_org and profile_id = auth.uid()
      and role in ('admin','internal'))
$$;

create or replace function is_project_admin(p_project uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from project_members
    where project_id = p_project and profile_id = auth.uid()
      and project_role = 'project_admin')
$$;

-- Suspension must bite mid-session, not only at sign-in, so this is consulted by
-- every policy rather than only by the login path.
create or replace function account_is_live(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from organisations where id = p_org and status = 'active')
$$;

-- An archived account stays readable by its members and writable by nobody.
create or replace function account_is_readable(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from organisations where id = p_org and status in ('active','archived'))
$$;

create or replace function can_see_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from projects p
    where p.id = p_project
      and account_is_readable(p.organisation_id)
      and (is_account_staff(p.organisation_id)
           or exists (select 1 from project_members pm
                      where pm.project_id = p.id and pm.profile_id = auth.uid()))
  ) or is_platform_owner()
$$;

-- The Projects tab on the personal landing page. Spans accounts, but only the
-- caller's own memberships — it can never name an account they are not in.
create or replace function my_projects()
returns setof projects language sql stable security definer
set search_path = public, pg_temp as $$
  select p.* from projects p
  join organisations o on o.id = p.organisation_id
  where o.status in ('active','archived')
    and (is_account_staff(o.id)
         or exists (select 1 from project_members pm
                    where pm.project_id = p.id and pm.profile_id = auth.uid()))
$$;

-- The per-project override is the right-hand operand so that it wins.
create or replace function module_on(p_project uuid, p_key text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (o.modules || coalesce(p.modules_override, '{}'::jsonb)) ->> p_key, 'false')::boolean
  from projects p join organisations o on o.id = p.organisation_id
  where p.id = p_project
$$;
