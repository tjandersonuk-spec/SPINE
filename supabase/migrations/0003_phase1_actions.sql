-- Phase 1 — the actions that create membership and move an account's lifecycle.
-- These are SECURITY DEFINER because each writes across several tables under one
-- authorisation decision. Every one re-checks permission as its first statement:
-- a definer function with no guard is a privilege escalation.

-- ---------------------------------------------------------------------------
-- Account requests
-- ---------------------------------------------------------------------------

create or replace function request_account(
  p_company_name text, p_company_number text default null,
  p_contact_phone text default null, p_intended_tier text default 'undecided',
  p_note text default null
) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if coalesce(trim(p_company_name), '') = '' then
    raise exception 'company name is required';   -- an Add refuses empty input
  end if;
  insert into account_requests (requested_by, company_name, company_number,
                                contact_phone, intended_tier, note)
  values (auth.uid(), trim(p_company_name), p_company_number, p_contact_phone,
          p_intended_tier, p_note)
  returning id into v_id;
  return v_id;
end $$;

-- Takes the REVIEWED values, not a blind copy of the request: the point of the
-- review step is that a misspelt name or a different tier can be corrected
-- before the account exists.
create or replace function approve_account_request(
  p_request uuid, p_name text, p_slug text, p_tier text, p_modules jsonb
) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_org uuid; v_req account_requests;
begin
  if not is_platform_owner() then raise exception 'not permitted'; end if;
  select * into v_req from account_requests where id = p_request and status = 'pending';
  if not found then raise exception 'no pending request'; end if;

  insert into organisations (name, slug, status, subscription_tier, modules,
                             approved_by, approved_at)
  values (p_name, p_slug, 'active', p_tier, coalesce(p_modules, '{}'::jsonb),
          auth.uid(), now())
  returning id into v_org;

  insert into organisation_members (organisation_id, profile_id, role)
  values (v_org, v_req.requested_by, 'admin');

  update account_requests set status = 'approved', reviewed_by = auth.uid(),
    reviewed_at = now(), organisation_id = v_org where id = p_request;

  insert into platform_audit (owner_id, organisation_id, subject_profile_id,
                              action, detail)
  values (auth.uid(), v_org, v_req.requested_by, 'approve_account_request',
          jsonb_build_object('request_id', p_request, 'name', p_name));
  return v_org;
end $$;

create or replace function reject_account_request(p_request uuid, p_reason text)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if not is_platform_owner() then raise exception 'not permitted'; end if;
  update account_requests set status = 'rejected', reviewed_by = auth.uid(),
    reviewed_at = now(), review_note = p_reason
  where id = p_request and status = 'pending';
  if not found then raise exception 'no pending request'; end if;
  insert into platform_audit (owner_id, action, detail)
  values (auth.uid(), 'reject_account_request',
          jsonb_build_object('request_id', p_request, 'reason', p_reason));
end $$;

-- ---------------------------------------------------------------------------
-- Account lifecycle
-- ---------------------------------------------------------------------------

create or replace function set_account_status(
  p_org uuid, p_status text, p_reason text default null
) returns void language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if not is_platform_owner() then raise exception 'not permitted'; end if;
  if p_status not in ('pending','active','suspended','archived') then
    raise exception 'unknown status %', p_status;
  end if;
  update organisations set
    status        = p_status,
    suspended_by  = case when p_status = 'suspended' then auth.uid() else suspended_by end,
    suspended_at  = case when p_status = 'suspended' then now() else suspended_at end,
    suspend_reason= case when p_status = 'suspended' then p_reason else suspend_reason end,
    archived_by   = case when p_status = 'archived' then auth.uid() else archived_by end,
    archived_at   = case when p_status = 'archived' then now() else archived_at end
  where id = p_org;
  if not found then raise exception 'no such account'; end if;
  insert into platform_audit (owner_id, organisation_id, action, detail)
  values (auth.uid(), p_org, 'set_account_status',
          jsonb_build_object('status', p_status, 'reason', p_reason));
end $$;

-- Deleting an account cascades to its projects and every project-scoped row,
-- including the change log that would explain the deletion. So: only from
-- archived, only with the name typed back, and the audit row is written BEFORE
-- the cascade so the trail outlives its subject.
create or replace function delete_account(p_org uuid, p_confirm_name text)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare v organisations; v_projects int; v_members int;
begin
  if not is_platform_owner() then raise exception 'not permitted'; end if;
  select * into v from organisations where id = p_org;
  if not found then raise exception 'no such account'; end if;
  if v.status <> 'archived' then
    raise exception 'an account must be archived before it can be deleted';
  end if;
  if p_confirm_name is distinct from v.name then
    raise exception 'confirmation name does not match';
  end if;

  select count(*) into v_projects from projects where organisation_id = p_org;
  select count(*) into v_members  from organisation_members where organisation_id = p_org;

  insert into platform_audit (owner_id, organisation_id, action, detail)
  values (auth.uid(), null, 'delete_account',
          jsonb_build_object('organisation_id', p_org, 'name', v.name,
                             'projects', v_projects, 'members', v_members,
                             'created_at', v.created_at));

  delete from organisations where id = p_org;
end $$;

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------

create or replace function create_project(p_org uuid, p_name text, p_code text)
returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  -- Only an account admin, and enforced again by the insert policy in 0004 so
  -- that a direct insert bypassing this function is refused too.
  if not is_account_admin(p_org) then raise exception 'not permitted'; end if;
  if not account_is_live(p_org) then raise exception 'account is not active'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_code), '') = '' then
    raise exception 'name and code are required';
  end if;
  insert into projects (organisation_id, name, code, created_by)
  values (p_org, trim(p_name), trim(p_code), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------

create or replace function invite_to_account(
  p_org uuid, p_email text, p_role text,
  p_company_id uuid default null, p_project_ids uuid[] default '{}'
) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not is_account_admin(p_org) then raise exception 'not permitted'; end if;
  if not account_is_live(p_org) then raise exception 'account is not active'; end if;
  if coalesce(trim(p_email), '') = '' then raise exception 'email is required'; end if;
  insert into invitations (scope, organisation_id, email, role, company_id,
                           project_ids, token, invited_by)
  values ('organisation', p_org, lower(trim(p_email)), p_role, p_company_id,
          coalesce(p_project_ids, '{}'), encode(gen_random_bytes(32), 'hex'), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- A project admin staffs their own project from the account's existing members.
-- They cannot widen the account, so the invitee must already hold membership --
-- checked here, and again on accept, because membership can be revoked during
-- the fourteen days the token stays live.
create or replace function invite_to_project(
  p_project uuid, p_email text, p_project_role text default 'member'
) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_org uuid; v_id uuid;
begin
  select organisation_id into v_org from projects where id = p_project;
  if not found then raise exception 'no such project'; end if;
  if not (is_account_admin(v_org) or is_project_admin(p_project)) then
    raise exception 'not permitted';
  end if;
  if not account_is_live(v_org) then raise exception 'account is not active'; end if;
  if not exists (
    select 1 from organisation_members m join profiles pr on pr.id = m.profile_id
    where m.organisation_id = v_org and lower(pr.email) = lower(trim(p_email))
  ) then
    raise exception 'invitee is not a member of this account';
  end if;
  insert into invitations (scope, organisation_id, project_id, email,
                           project_role, token, invited_by)
  values ('project', v_org, p_project, lower(trim(p_email)), p_project_role,
          encode(gen_random_bytes(32), 'hex'), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Membership is created here and nowhere else. Accepting is the consent step.
create or replace function accept_invitation(p_token text)
returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare v invitations; v_email text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select email into v_email from profiles where id = auth.uid();

  select * into v from invitations where token = p_token;
  if not found then raise exception 'invitation not found'; end if;
  if v.accepted_at is not null then raise exception 'invitation already accepted'; end if;
  if v.revoked_at is not null then raise exception 'invitation revoked'; end if;
  if v.expires_at < now() then raise exception 'invitation expired'; end if;
  if lower(v_email) <> lower(v.email) then
    raise exception 'invitation was issued to a different address';
  end if;
  if not account_is_live(v.organisation_id) then
    raise exception 'account is not active';
  end if;

  if v.scope = 'organisation' then
    insert into organisation_members (organisation_id, profile_id, role, company_id)
    values (v.organisation_id, auth.uid(), v.role, v.company_id)
    on conflict (organisation_id, profile_id) do nothing;
    if array_length(v.project_ids, 1) is not null then
      insert into project_members (project_id, profile_id, added_by)
      select unnest(v.project_ids), auth.uid(), v.invited_by
      on conflict (project_id, profile_id) do nothing;
    end if;
  else
    -- re-check: the invitee may have left the account since the token was issued
    if not exists (
      select 1 from organisation_members
      where organisation_id = v.organisation_id and profile_id = auth.uid()
    ) then
      raise exception 'invitee is no longer a member of this account';
    end if;
    insert into project_members (project_id, profile_id, project_role, added_by)
    values (v.project_id, auth.uid(), v.project_role, v.invited_by)
    on conflict (project_id, profile_id) do nothing;
  end if;

  update invitations set accepted_at = now(), accepted_by = auth.uid() where id = v.id;
  return v.id;
end $$;
