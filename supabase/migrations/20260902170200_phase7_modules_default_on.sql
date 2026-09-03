-- A module nobody has decided about is ON.
--
-- module_on() has always read an absent key as false. Nothing read it until
-- Phase 7 wired the sidebar to it, and then every account whose entitlement map
-- had never been populated -- which is every account, since the column defaults
-- to '{}' -- lost its whole navigation at once.
--
-- Fail-closed is right for security and wrong here. Modules are packaging, not
-- permission: RLS decides what a person may read, and it is unchanged by any of
-- this. Failing closed on packaging does not protect anything; it breaks the
-- product for anyone who has not yet been sold a list of features.
--
-- So: a key that is a real module and is absent from the map is on. A key that
-- is not a module at all stays off, because a nav entry naming a module that
-- does not exist should never appear -- that half of the rule was right and is
-- kept.

create or replace function module_on(p_project uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    -- Not a module at all: off, always. A nav entry whose key is missing from
    -- module_keys() can never be switched on by anyone.
    when not (p_key = any(module_keys())) then false
    else coalesce(
      ((o.modules || coalesce(p.modules_override, '{}'::jsonb)) ->> p_key)::boolean,
      -- Absent means nobody has decided, which means included.
      true)
  end
  from projects p join organisations o on o.id = p.organisation_id
  where p.id = p_project;
$$;

-- The shell gets the resolved map -- every module key with an explicit answer --
-- rather than the raw jsonb. Otherwise the client has to reimplement the
-- absent-means-on rule, and the two would eventually disagree.
create or replace function project_shell(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when can_see_project(p_project) then
    jsonb_build_object(
      'project_id', p.id,
      'project_name', p.name,
      'project_code', p.code,
      'organisation_id', o.id,
      'account_name', o.name,
      'brand_colour', o.brand_colour,
      'logo_path', o.logo_path,
      'theme', o.theme,
      'modules', (
        select jsonb_object_agg(k, coalesce(
          ((o.modules || coalesce(p.modules_override, '{}'::jsonb)) ->> k)::boolean, true))
        from unnest(module_keys()) as k))
  end
  from projects p
  join organisations o on o.id = p.organisation_id
  where p.id = p_project;
$$;

grant execute on function module_on(uuid, text) to authenticated;
grant execute on function project_shell(uuid) to authenticated;
