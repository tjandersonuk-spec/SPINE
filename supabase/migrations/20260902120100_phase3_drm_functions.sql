-- Phase 3 — loading a matrix, and reading it.

-- The account's library: its fork if it has one, the published set until then.
create or replace function account_drm_library(p_org uuid)
returns table (ref text, category_code text, category_name text, item text,
               default_lead_discipline text, cdp_likely boolean, guidance_note text,
               sort_order int, forked boolean)
language sql stable security definer
set search_path = public, pg_temp as $$
  with forked as (
    select exists (select 1 from drm_library_items where organisation_id = p_org) as yes
  )
  select l.ref, l.category_code, c.name, l.item, l.default_lead_discipline,
         l.cdp_likely, l.guidance_note, l.sort_order, (l.organisation_id is not null)
  from drm_library_items l
  left join drm_categories c
    on c.code = l.category_code
   and c.organisation_id is not distinct from l.organisation_id
  cross join forked f
  where is_account_member(p_org)
    and ((f.yes and l.organisation_id = p_org)
      or (not f.yes and l.organisation_id is null))
  order by l.sort_order, l.ref
$$;

create or replace function fork_drm_library(p_org uuid)
returns int language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_count int;
begin
  if not is_account_admin(p_org) then raise exception 'not permitted'; end if;
  if exists (select 1 from drm_library_items where organisation_id = p_org) then
    return 0;
  end if;
  insert into drm_categories (organisation_id, code, name, sort_order)
  select p_org, code, name, sort_order from drm_categories where organisation_id is null;
  insert into drm_library_items (organisation_id, library_version, ref, category_code, item,
                                 default_lead_discipline, cdp_likely, guidance_note, sort_order)
  select p_org, library_version, ref, category_code, item,
         default_lead_discipline, cdp_likely, guidance_note, sort_order
  from drm_library_items where organisation_id is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Load the matrix into a project. A snapshot: the rows are copied, the version
-- is stamped, and nothing reads back to the library afterwards.
create or replace function load_drm_into_project(p_project uuid)
returns text language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_org uuid; v_count int; v_version text;
begin
  select organisation_id into v_org from projects where id = p_project;
  if not found then raise exception 'no such project'; end if;
  if not (is_account_admin(v_org) or is_project_admin(p_project)) then
    raise exception 'not permitted';
  end if;
  if not account_is_live(v_org) then raise exception 'account is not active'; end if;
  if exists (select 1 from drm_items where project_id = p_project) then
    raise exception 'this project already has a matrix';
  end if;

  select coalesce(
    (select library_version from drm_library_items where organisation_id = v_org limit 1),
    (select library_version from drm_library_items where organisation_id is null limit 1))
  into v_version;

  insert into drm_items (project_id, library_item_id, ref, category_code, item,
                         lead_discipline, guidance_note)
  select p_project, l.id, l.ref, l.category_code, l.item,
         l.default_lead_discipline, l.guidance_note
  from drm_library_items l
  where l.organisation_id is not distinct from
        (case when exists (select 1 from drm_library_items where organisation_id = v_org)
              then v_org else null end);
  get diagnostics v_count = row_count;

  update projects set drm_library_version = v_version where id = p_project;
  return format('Loaded %s items at version %s.', v_count, v_version);
end $$;

-- ---------------------------------------------------------------------------
-- Reading the matrix
-- ---------------------------------------------------------------------------

-- Who leads each item, resolved live. Never stored, never cached: this is what
-- makes a novation a one-line change to the directory instead of a migration.
create or replace function drm_leads(p_project uuid)
returns table (drm_item_id uuid, ref text, item text, lead_discipline text,
               company_id uuid, company_name text)
language sql stable security definer
set search_path = public, pg_temp as $$
  -- The lateral matters. Joining company_disciplines on the discipline code
  -- alone matches every project's rows, and the companies join then fails for
  -- the foreign ones, leaving a null holder beside the real answer. Scope the
  -- lookup to this project inside the subquery, so an item with no holder
  -- yields exactly one null row and an item with two yields two.
  select d.id, d.ref, d.item, d.lead_discipline, h.id, h.name
  from drm_items d
  left join lateral (
    select c.id, c.name
    from companies c
    join company_disciplines cd on cd.company_id = c.id
    where c.project_id = d.project_id
      and cd.discipline_code = d.lead_discipline
  ) h on true
  where d.project_id = p_project and can_see_project(p_project)
  order by d.ref, h.name
$$;

-- The gap report. Handover §3 calls this the app's reason to exist, and it is
-- two different failures wearing one colour, so it says which.
create or replace function drm_gaps(p_project uuid)
returns table (drm_item_id uuid, ref text, category_code text, item text,
               lead_discipline text, gap_reason text)
language sql stable security definer
set search_path = public, pg_temp as $$
  select d.id, d.ref, d.category_code, d.item, d.lead_discipline,
    case when d.lead_discipline is null
      then 'No lead discipline assigned'
      else 'Discipline ' || d.lead_discipline || ' is not held by any appointed company'
    end
  from drm_items d
  where d.project_id = p_project
    and d.applicable
    and can_see_project(p_project)
    -- a discipline struck out for this job cannot be a gap
    and coalesce((select pd.required from project_disciplines pd
                  where pd.project_id = d.project_id
                    and pd.discipline_code = d.lead_discipline), true)
    and (d.lead_discipline is null
         or not exists (
           select 1 from companies c
           join company_disciplines cd on cd.company_id = c.id
           where c.project_id = d.project_id and cd.discipline_code = d.lead_discipline))
  order by d.ref
$$;

-- One number for the dashboard, and the same number the matrix shows, because
-- both come from the same function.
create or replace function drm_gap_count(p_project uuid)
returns int language sql stable security definer
set search_path = public, pg_temp as $$
  select count(*)::int from drm_gaps(p_project)
$$;

create or replace function set_drm_lead(p_item uuid, p_discipline text)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_project uuid; v_org uuid;
begin
  select d.project_id, p.organisation_id into v_project, v_org
  from drm_items d join projects p on p.id = d.project_id where d.id = p_item;
  if not found then raise exception 'no such matrix item'; end if;
  if not (is_account_admin(v_org) or is_project_admin(v_project)) then
    raise exception 'not permitted';
  end if;
  if not account_is_live(v_org) then raise exception 'account is not active'; end if;
  -- nullif so that clearing a lead is possible: an item nobody leads is a gap,
  -- and being able to say so is the point
  update drm_items set lead_discipline = nullif(trim(coalesce(p_discipline,'')), '')
  where id = p_item;
end $$;

grant execute on function account_drm_library(uuid) to authenticated;
grant execute on function fork_drm_library(uuid) to authenticated;
grant execute on function load_drm_into_project(uuid) to authenticated;
grant execute on function drm_leads(uuid) to authenticated;
grant execute on function drm_gaps(uuid) to authenticated;
grant execute on function drm_gap_count(uuid) to authenticated;
grant execute on function set_drm_lead(uuid, text) to authenticated;
