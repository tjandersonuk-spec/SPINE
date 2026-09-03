-- Phase 12, part five -- warranties.
--
-- THE ONE PLACE IN THIS SCHEMA WHERE "WHO OWNS THIS" IS NOT A STORED COLUMN,
-- and the comment is here because the next engineer's instinct will be to
-- normalise it into one.
--
-- A warranty links to a DRM reference. Its owner is resolved at read time
-- through whichever company currently holds that item's lead discipline. Add a
-- company_id and reassigning the matrix silently leaves every linked warranty
-- pointing at the firm that used to be responsible -- an owner that goes stale
-- the moment the matrix changes, which is exactly what this design avoids.
-- Reassigning drm_items.lead_discipline reassigns every warranty under it,
-- with no write to this table at all.

create table warranty_templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) on delete cascade,
  reference text not null,
  -- Matches drm_library_items.ref, e.g. '04.060'.
  drm_ref text not null,
  title text not null check (btrim(title) <> ''),
  description text,
  period_years int,
  beneficiary text,
  form text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (organisation_id, reference)
);

create table warranties (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,
  -- Matches this project's drm_items.ref. NOT a company. See the header.
  drm_ref text,
  title text not null check (btrim(title) <> ''),
  description text,
  period_years int,
  beneficiary text,
  form text,
  -- The actual manufacturer or subcontractor once known, which is a different
  -- question from who is chasing it. Free text on purpose: the firm giving a
  -- twenty-year roof warranty is often not in the project directory at all.
  provided_by text,
  status text not null default 'Not started'
    check (status in ('Not started','Requested','Draft received','Under review',
                      'Approved','Executed','Not required')),
  required boolean not null default true,
  programme_task_uid text,
  offset_days int not null default 0,
  anchor text not null default 'finish' check (anchor in ('start','finish')),
  due_date_override date,
  custom boolean not null default false,
  template_id uuid references warranty_templates(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, reference)
);
create index on warranties (project_id, status);
create index on warranties (project_id, drm_ref);
create index on warranties (project_id, programme_task_uid);

-- Ownership, resolved live.
--
-- Returns NO ROWS where the DRM item has no lead discipline, or where no
-- company on this project holds it. That absence IS the "no owner" state, and
-- the UI shows it the way the matrix's own gap detector shows a gap, because
-- it is running the same query in spirit.
create or replace function warranty_owner(p_warranty uuid)
returns table (company_id uuid, company_name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.name
  from warranties w
  join drm_items d
    on d.project_id = w.project_id and d.ref = w.drm_ref and d.applicable
  join company_disciplines cd on cd.discipline_code = d.lead_discipline
  join companies c on c.id = cd.company_id and c.project_id = w.project_id
  where w.id = p_warranty;
$$;

grant execute on function warranty_owner(uuid) to authenticated;

-- The same resolution, set-wise, so the register does not run a function per
-- row. A warranty whose discipline two firms hold appears with both -- the
-- matrix's own ambiguity, surfaced rather than resolved by picking one.
create or replace view v_warranties as
select
  w.*,
  due_date(w.project_id, w.programme_task_uid, w.offset_days, w.anchor,
           w.due_date_override)                       as due,
  anchor_state(w.project_id, w.programme_task_uid)    as anchor_state,
  d.item                                              as drm_item,
  d.lead_discipline,
  d.applicable                                        as drm_applicable,
  -- The resolved owner or owners, live through the lead discipline.
  coalesce((select array_agg(c.name order by c.name)
            from company_disciplines cd
            join companies c on c.id = cd.company_id and c.project_id = w.project_id
            where cd.discipline_code = d.lead_discipline and d.applicable), '{}')
                                                      as owners,
  coalesce((select count(*)::int
            from company_disciplines cd
            join companies c on c.id = cd.company_id and c.project_id = w.project_id
            where cd.discipline_code = d.lead_discipline and d.applicable), 0)
                                                      as holders,
  (w.status in ('Executed','Not required'))            as is_done,
  (w.required
   and w.status not in ('Executed','Not required')
   and due_date(w.project_id, w.programme_task_uid, w.offset_days, w.anchor,
                w.due_date_override) < current_date)   as overdue,
  -- The gap, and it is the same gap the matrix shows: nobody holds the lead
  -- discipline for the item this warranty hangs off, so nobody is chasing it.
  (w.required and (
     w.drm_ref is null
     or d.id is null
     or d.lead_discipline is null
     or not exists (select 1 from company_disciplines cd
                    join companies c on c.id = cd.company_id
                     and c.project_id = w.project_id
                    where cd.discipline_code = d.lead_discipline)))
                                                      as unallocated
from warranties w
left join drm_items d on d.project_id = w.project_id and d.ref = w.drm_ref;

create or replace function warranty_totals(p_project uuid)
returns table (total int, done int, overdue int, unallocated int, struck_out int)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    count(*) filter (where required)::int,
    count(*) filter (where required and is_done)::int,
    count(*) filter (where overdue)::int,
    count(*) filter (where unallocated)::int,
    count(*) filter (where not required)::int
  from v_warranties where project_id = p_project;
$$;

grant execute on function warranty_totals(uuid) to authenticated;

-- Loading the published list. Skips on title match and never invents a date.
create or replace function load_warranty_library(p_project uuid)
returns table (added int, skipped int)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid; v_added int := 0; v_skipped int := 0; t record;
begin
  select organisation_id into v_org from projects where id = p_project;
  if v_org is null or not can_write_project_setup(p_project) then
    raise exception 'Not permitted to load the warranty library on this project'
      using errcode = '42501';
  end if;
  for t in
    select * from warranty_templates
     where organisation_id = v_org
        or (organisation_id is null
            and not exists (select 1 from warranty_templates f
                             where f.organisation_id = v_org))
     order by sort_order, reference
  loop
    if exists (select 1 from warranties x
                where x.project_id = p_project and lower(x.title) = lower(t.title)) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into warranties (
      project_id, reference, drm_ref, title, description, period_years,
      beneficiary, form, template_id)
    values (
      p_project, next_reference(p_project, 'WTY', 'WTY'), t.drm_ref, t.title,
      t.description, t.period_years, t.beneficiary, t.form, t.id);
    v_added := v_added + 1;
  end loop;
  return query select v_added, v_skipped;
end;
$$;

grant execute on function load_warranty_library(uuid) to authenticated;
