-- Two corrections to what a member of an account sees.
--
-- 1. My accounts listed an account once per member of it.
--
-- The policy on organisation_members is right: a member may see who else is in
-- their account. The client query was wrong — it read that table without
-- filtering to itself, so a five-person account came back five times, each row
-- carrying the same account. Rather than adding a filter to the client and
-- hoping the next caller remembers, this is now a function of its own, the same
-- shape as my_projects(): one row per account, for the caller, by construction.
--
-- 2. Members could not see invitations or requests.
--
-- §1b said an invitation is visible to the account's admins and its addressee
-- and nobody else, on the reasoning that an un-accepted invitee is a name and
-- an email and nothing more. In use that is wrong: a team that cannot see who
-- has already been invited invites them again, and the person who asked for
-- someone to be added has no way to see it is in hand. Anyone in the account
-- can now see both. Acting on them is unchanged — issuing, revoking, approving
-- and declining are still an admin's.

create or replace function my_accounts()
returns table (
  id uuid,
  name text,
  status text,
  role text,
  brand_colour text,
  joined_at timestamptz
) language sql stable security definer
set search_path = public, pg_temp as $$
  select o.id, o.name, o.status, m.role, o.brand_colour, m.joined_at
  from organisation_members m
  join organisations o on o.id = m.organisation_id
  where m.profile_id = auth.uid()
  order by o.name
$$;

drop policy if exists invitations_select on invitations;
create policy invitations_select on invitations for select to authenticated
using (
  is_platform_owner()
  or is_account_member(organisation_id)
  or lower(email) = (select lower(email) from profiles where id = auth.uid())
);

drop policy if exists membership_requests_select on membership_requests;
create policy membership_requests_select on membership_requests for select to authenticated
using (is_account_member(organisation_id) or requested_by = auth.uid());

-- A second request for the same address would otherwise hit the unique index
-- and surface as a constraint name, which tells the person nothing.
create or replace function request_membership(
  p_project uuid, p_email text, p_role text,
  p_project_role text default 'member',
  p_person_name text default null, p_note text default null
) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_org uuid; v_id uuid;
begin
  select organisation_id into v_org from projects where id = p_project;
  if not found then raise exception 'no such project'; end if;

  if not (is_account_staff(v_org)
          or exists (select 1 from project_members
                     where project_id = p_project and profile_id = auth.uid())) then
    raise exception 'not permitted';
  end if;
  if not account_is_live(v_org) then raise exception 'account is not active'; end if;
  if coalesce(trim(p_email), '') = '' then raise exception 'email is required'; end if;

  if exists (select 1 from organisation_members m join profiles pr on pr.id = m.profile_id
             where m.organisation_id = v_org and lower(pr.email) = lower(trim(p_email))) then
    raise exception 'that person is already a member of this account';
  end if;

  if exists (select 1 from membership_requests
             where organisation_id = v_org and lower(email) = lower(trim(p_email))
               and status = 'pending') then
    raise exception 'someone has already asked for that person to be added';
  end if;

  if exists (select 1 from invitations
             where organisation_id = v_org and lower(email) = lower(trim(p_email))
               and accepted_at is null and revoked_at is null and declined_at is null
               and expires_at > now()) then
    raise exception 'that person has already been invited';
  end if;

  insert into membership_requests (organisation_id, project_id, email, person_name,
                                   proposed_role, proposed_project_role, note, requested_by)
  values (v_org, p_project, lower(trim(p_email)), nullif(trim(coalesce(p_person_name,'')),''),
          p_role, p_project_role, p_note, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

grant execute on function my_accounts() to authenticated;
