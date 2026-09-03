-- Phase 12, part ten -- the admin override is the ADMIN override.
--
-- Found by the risk register's own test, and it is a correction to the Phase 6
-- primitive rather than anything specific to a risk.
--
-- can_see() returned true for every member of account STAFF -- admin and
-- internal together -- before it looked at the mode at all. For `internal`
-- mode that is the mode's definition and is right. For `named` mode it is a
-- clause one word too wide: it handed every internal member of the contractor
-- every restricted record on the project, which is precisely what a closed
-- audience is for. A costed risk is a commercial position long before it is a
-- shared one, and "the whole office" is not the position.
--
-- The override is now: an account ADMIN, or that project's own admin -- the
-- design manager, who is the role the prototype gives the override to. An
-- `internal` member sees a named record when they have been named on it, like
-- anybody else.
-- The two trailing defaults are part of the signature every caller already
-- relies on, so they are restated rather than dropped.
create or replace function can_see(
  p_project uuid, p_visibility jsonb,
  p_raised_by uuid default null, p_owner_profile uuid default null
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when not can_see_project(p_project) then false
    -- The raiser and the owner are never locked out of their own record: a
    -- list that hides an item from the person carrying it reads as the item
    -- having vanished.
    when auth.uid() = p_raised_by or auth.uid() = p_owner_profile then true
    -- The admin override, and only admin.
    when exists (select 1 from projects p
                 where p.id = p_project
                   and (is_account_admin(p.organisation_id) or is_project_admin(p.id)))
      then true
    else case coalesce(p_visibility->>'mode', 'project')
      when 'project' then true
      -- The host's own staff, which is what this mode means. Admin already
      -- returned true above; this is the branch `internal` still passes.
      when 'internal' then exists (
        select 1 from projects p
        where p.id = p_project and is_account_staff(p.organisation_id))
      when 'named' then
        exists (select 1 from jsonb_array_elements_text(
                  coalesce(p_visibility->'people', '[]'::jsonb)) x
                where x.value::uuid = auth.uid())
      when 'parties' then
        exists (select 1 from jsonb_array_elements_text(
                  coalesce(p_visibility->'people', '[]'::jsonb)) x
                where x.value::uuid = auth.uid())
        or exists (
          select 1
          from jsonb_array_elements_text(
                 coalesce(p_visibility->'companies', '[]'::jsonb)) x
          join companies c on c.id = x.value::uuid
          where c.project_id = p_project
            and c.id in (select company_id from my_company_tree(p_project)))
      -- A mode no branch understands never falls through to "everyone".
      -- visibility_is_valid() refuses one at write time; this is the second
      -- line of defence, and it is closed.
      else false
    end
  end;
$$;

grant execute on function can_see(uuid, jsonb, uuid, uuid) to authenticated;
