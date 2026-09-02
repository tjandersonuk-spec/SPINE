-- Phase 1 — generate invitation tokens without pgcrypto.
--
-- The two invite functions built their token with gen_random_bytes(), which
-- lives in the pgcrypto extension. On Supabase extensions are installed into an
-- `extensions` schema, and these functions pin `search_path = public, pg_temp`,
-- so the call failed at run time with "function gen_random_bytes(integer) does
-- not exist". Adding `extensions` to the search_path would fix it, but leaves
-- the token depending on an extension being installed at all.
--
-- gen_random_uuid() is core PostgreSQL (pg_catalog) and always resolvable. Two
-- of them concatenated give 64 hex characters carrying about 244 bits of
-- randomness, which is more than the 256-bit byte string was ever using in
-- practice and has no extension dependency.

create or replace function new_invitation_token()
returns text language sql volatile
set search_path = public, pg_temp as $$
  select replace(gen_random_uuid()::text, '-', '')
      || replace(gen_random_uuid()::text, '-', '')
$$;

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
          coalesce(p_project_ids, '{}'), new_invitation_token(), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

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
  -- the invitee must already belong to the account that owns the project
  if not exists (
    select 1 from organisation_members m join profiles pr on pr.id = m.profile_id
    where m.organisation_id = v_org and lower(pr.email) = lower(trim(p_email))
  ) then
    raise exception 'invitee is not a member of this account';
  end if;
  insert into invitations (scope, organisation_id, project_id, email,
                           project_role, token, invited_by)
  values ('project', v_org, p_project, lower(trim(p_email)), p_project_role,
          new_invitation_token(), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

grant execute on function new_invitation_token() to authenticated;
