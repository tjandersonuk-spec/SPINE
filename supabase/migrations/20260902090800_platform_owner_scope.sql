-- The platform owner sees accounts and people, not project contents.
--
-- §1b gave the owner "see any account's projects for support". On reflection
-- that is more access than running the platform needs, and a customer's design
-- data is the last thing the landlord should be able to read. The owner keeps
-- what the role is actually for — approving, locking, archiving and billing
-- accounts, and finding a login — and loses the ability to read project rows.
--
-- Counts are a different matter: how many projects and members an account has
-- is a billing fact, not project data, so it comes back through a definer
-- function that exposes numbers and nothing else.

drop policy if exists projects_select on projects;
create policy projects_select on projects for select to authenticated
using (
  account_is_readable(organisation_id)
  and (is_account_staff(organisation_id)
       or exists (select 1 from project_members pm
                  where pm.project_id = projects.id and pm.profile_id = auth.uid()))
);

create or replace function can_see_project(p_project uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from projects p
    where p.id = p_project
      and account_is_readable(p.organisation_id)
      and (is_account_staff(p.organisation_id)
           or exists (select 1 from project_members pm
                      where pm.project_id = p.id and pm.profile_id = auth.uid()))
  )
$$;

-- Numbers only. No name, no code, no content.
create or replace function account_summary(p_org uuid)
returns table (project_count int, member_count int, pending_invitations int)
language sql stable security definer
set search_path = public, pg_temp as $$
  select
    (select count(*)::int from projects where organisation_id = p_org),
    (select count(*)::int from organisation_members where organisation_id = p_org),
    (select count(*)::int from invitations
      where organisation_id = p_org and accepted_at is null
        and revoked_at is null and declined_at is null and expires_at > now())
  where is_platform_owner() or is_account_admin(p_org)
$$;

grant execute on function account_summary(uuid) to authenticated;
