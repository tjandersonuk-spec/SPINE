-- Phase 7, part two -- what the shell needs to paint itself and to know what a
-- project is entitled to.
--
-- Both come from the account record, and neither is reachable by a member who
-- is not an admin of it -- but every member needs to read them, or the app
-- cannot render. One definer function, returning exactly the four brand facts
-- and the module map, and nothing else about the account.

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
      -- The whole customiser: name, logo, one colour, light or dark. Semantic
      -- colours are not here and never will be -- if a tenant could make
      -- "overdue" blue, the convention holding every page together is gone.
      'brand_colour', o.brand_colour,
      'logo_path', o.logo_path,
      'theme', o.theme,
      -- Entitlements, already merged: the account's map with the project's
      -- override applied on top, so the shell asks one question rather than
      -- reimplementing the precedence rule.
      'modules', o.modules || coalesce(p.modules_override, '{}'::jsonb))
  end
  from projects p
  join organisations o on o.id = p.organisation_id
  where p.id = p_project;
$$;

comment on function project_shell(uuid) is
  'Branding and entitlements for one project. The only account facts a non-admin member may read.';

grant execute on function project_shell(uuid) to authenticated;

-- The account-level equivalent, for screens outside a project.
create or replace function account_branding(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when is_account_member(p_org) or is_platform_owner() then
    jsonb_build_object(
      'organisation_id', o.id, 'account_name', o.name,
      'brand_colour', o.brand_colour, 'logo_path', o.logo_path, 'theme', o.theme)
  end
  from organisations o where o.id = p_org;
$$;

grant execute on function account_branding(uuid) to authenticated;

-- A module key that no page answers to would silently entitle nothing, so the
-- valid set is stated once, here, and the setter checks against it.
create or replace function module_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'preassessment','precon','client',
    'directory','drm','scope','bep','programme',
    'docs','tx','materials','crs',
    'planning','bc','bsa','breeam','highways','utilities',
    'fees','budget','risk','warranties',
    'handover','gateways','reports','audit'
  ];
$$;

grant execute on function module_keys() to authenticated;

-- Setting entitlements. An account admin decides for the account; a project
-- override is theirs too, because turning a module off for one job is a
-- commercial decision rather than a project one.
create or replace function set_modules(p_org uuid, p_modules jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare k text;
begin
  if not (is_account_admin(p_org) or is_platform_owner()) then
    raise exception 'Only an account admin may change entitlements' using errcode = '42501';
  end if;
  for k in select jsonb_object_keys(p_modules) loop
    if not (k = any(module_keys())) then
      raise exception 'No module called "%"', k using errcode = '22023';
    end if;
  end loop;
  update organisations set modules = p_modules where id = p_org;
end;
$$;

create or replace function set_project_modules(p_project uuid, p_override jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_org uuid; k text;
begin
  select organisation_id into v_org from projects where id = p_project;
  if v_org is null then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if not (is_account_admin(v_org) or is_platform_owner()) then
    raise exception 'Only an account admin may change entitlements' using errcode = '42501';
  end if;
  if p_override is not null then
    for k in select jsonb_object_keys(p_override) loop
      if not (k = any(module_keys())) then
        raise exception 'No module called "%"', k using errcode = '22023';
      end if;
    end loop;
  end if;
  update projects set modules_override = p_override where id = p_project;
end;
$$;

revoke all on function set_modules(uuid, jsonb) from public;
grant execute on function set_modules(uuid, jsonb) to authenticated;
revoke all on function set_project_modules(uuid, jsonb) from public;
grant execute on function set_project_modules(uuid, jsonb) to authenticated;
