-- Phase 1 — table and column privileges.
--
-- The blanket grants come first. A hosted Supabase project already applies these
-- by default privilege, but stating them means this migration produces the same
-- result on a plain PostgreSQL and does not depend on how the database was set
-- up. The revokes below are then the last word in both places.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

--
-- RLS decides which ROWS a policy lets through; it says nothing about which
-- COLUMNS may be written. Supabase grants `authenticated` update on every column
-- of every table in public by default, so a row a policy legitimately allows
-- someone to edit is one they can edit ENTIRELY. Three escalations follow from
-- that, and each is closed here by revoking the blanket grant and re-granting
-- only the columns that role has any business writing.

-- 1. A person may edit their own profile row. With every column writable they
--    could set profiles.email to a colleague's address and then redeem an
--    invitation addressed to that colleague, because accept_invitation()
--    matches on it. Email is proved by Auth and is not the user's to type.
revoke update on profiles from authenticated;
grant update (name, phone) on profiles to authenticated;

-- 2. An account admin may edit their own account for branding. With every column
--    writable they could switch on `modules` they have not paid for, or move
--    `status` and `subscription_tier`. Entitlements are the platform owner's.
revoke update on organisations from authenticated;
grant update (name, brand_colour, logo_path, theme) on organisations to authenticated;

-- 3. An account admin or project admin may edit a project. modules_override is
--    merged over the account's map and wins, so a writable override is the same
--    escalation one level down.
revoke update on projects from authenticated;
grant update (name, code) on projects to authenticated;

-- 4. A requester may withdraw their own request. Everything else on the row --
--    the reviewer, the timestamp, the reason -- is the platform owner's record
--    of what they decided.
revoke update on account_requests from authenticated;
grant update (status) on account_requests to authenticated;

-- 5. An admin may revoke or re-date an invitation. They must not be able to
--    rewrite who it was for or what it granted after it was sent.
revoke update on invitations from authenticated;
grant update (revoked_at, revoked_by, expires_at) on invitations to authenticated;

-- Nobody writes the audit trail through the API; only the definer functions do.
revoke insert, update, delete on platform_audit from authenticated;

-- ---------------------------------------------------------------------------
-- The platform owner's own edit path, since the policy above no longer gives
-- one. Amending an account is audited, like every other owner action.
-- ---------------------------------------------------------------------------

create or replace function update_account_as_owner(
  p_org uuid, p_name text, p_slug text, p_tier text, p_modules jsonb
) returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_before organisations;
begin
  if not is_platform_owner() then raise exception 'not permitted'; end if;
  select * into v_before from organisations where id = p_org;
  if not found then raise exception 'no such account'; end if;

  update organisations set
    name = coalesce(p_name, name),
    slug = coalesce(p_slug, slug),
    subscription_tier = coalesce(p_tier, subscription_tier),
    modules = coalesce(p_modules, modules)
  where id = p_org;

  insert into platform_audit (owner_id, organisation_id, action, detail)
  values (auth.uid(), p_org, 'update_account',
          jsonb_build_object(
            'from', jsonb_build_object('name', v_before.name, 'slug', v_before.slug,
                     'tier', v_before.subscription_tier, 'modules', v_before.modules),
            'to', jsonb_build_object('name', coalesce(p_name, v_before.name),
                     'slug', coalesce(p_slug, v_before.slug),
                     'tier', coalesce(p_tier, v_before.subscription_tier),
                     'modules', coalesce(p_modules, v_before.modules))));
end $$;

-- Remove a person from a project. Distinct from removing them from the account:
-- this leaves their membership and every other project untouched.
create or replace function remove_from_project(p_project uuid, p_profile uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  select organisation_id into v_org from projects where id = p_project;
  if not found then raise exception 'no such project'; end if;
  if not (is_account_admin(v_org) or is_project_admin(p_project)) then
    raise exception 'not permitted';
  end if;
  if not account_is_live(v_org) then raise exception 'account is not active'; end if;
  delete from project_members where project_id = p_project and profile_id = p_profile;
end $$;
