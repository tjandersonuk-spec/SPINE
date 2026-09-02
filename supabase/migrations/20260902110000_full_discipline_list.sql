-- The full discipline list, and the ISO letter each carries.
--
-- Phase 2 seeded twelve disciplines from memory of the shape rather than from
-- the prototype, which holds twenty-six. The omissions are not cosmetic: a
-- project with a quantity surveyor, a geotechnical engineer, a BREEAM assessor
-- and a vertical transportation consultant had nowhere to record any of them,
-- and mechanical, electrical and public health were collapsed into one when the
-- prototype keeps them separate — which is right, because they are separate
-- appointments held by different people.
--
-- Each discipline also carries its ISO 19650 letter. Phase 5's naming
-- convention is built from it, so it belongs here rather than being retrofitted
-- once the register exists.

alter table disciplines add column if not exists iso_letter text;

-- Refresh the published set from the prototype. Forks are untouched; an account
-- that has already forked picks up the additions through
-- refresh_discipline_fork() below, which never overwrites an edit.
delete from disciplines where organisation_id is null;

insert into disciplines (organisation_id, code, name, iso_letter, sort_order) values
  (null, 'CL',  'Client',                                    'K',  10),
  (null, 'PM',  'Project manager',                           'Z',  20),
  (null, 'MC',  'Main contractor / design manager',          'W',  30),
  (null, 'PD',  'Principal designer (CDM)',                  'Z',  40),
  (null, 'PDB', 'Principal designer (Building Safety Act)',  'Z',  50),
  (null, 'QS',  'Quantity surveyor / cost',                  'Q',  60),
  (null, 'A',   'Architect',                                 'A',  70),
  (null, 'ID',  'Interior designer',                         'I',  80),
  (null, 'S',   'Structural engineer',                       'S',  90),
  (null, 'GE',  'Geotechnical engineer',                     'G', 100),
  (null, 'C',   'Civil / infrastructure engineer',           'C', 110),
  (null, 'M',   'Mechanical engineer',                       'M', 120),
  (null, 'E',   'Electrical engineer',                       'E', 130),
  (null, 'P',   'Public health engineer',                    'P', 140),
  (null, 'VT',  'Vertical transportation',                   'Y', 150),
  (null, 'FE',  'Facade engineer',                           'Y', 160),
  (null, 'FS',  'Fire engineer',                             'F', 170),
  (null, 'AC',  'Acoustic consultant',                       'Y', 180),
  (null, 'SU',  'Sustainability / energy assessor',          'Y', 190),
  (null, 'BR',  'BREEAM assessor',                           'Y', 200),
  (null, 'L',   'Landscape architect',                       'L', 210),
  (null, 'EC',  'Ecologist',                                 'Y', 220),
  (null, 'TR',  'Transport / highways',                      'D', 230),
  (null, 'SUR', 'Surveyor',                                  'B', 240),
  (null, 'BC',  'Building control / approved inspector',     'Z', 250),
  (null, 'SC',  'Specialist subcontractor',                  'X', 260);

-- These gain a column, and `create or replace` cannot change a function's
-- output columns, so they are dropped first — innermost last, because each
-- depends on the one below it.
drop function if exists project_discipline_gaps(uuid);
drop function if exists project_disciplines_in_use(uuid);
drop function if exists account_disciplines(uuid);

create or replace function account_disciplines(p_org uuid)
returns table (code text, name text, iso_letter text, sort_order int, forked boolean)
language sql stable security definer
set search_path = public, pg_temp as $$
  select d.code, d.name, d.iso_letter, d.sort_order, true
  from disciplines d
  where d.organisation_id = p_org and is_account_member(p_org)
  union all
  select d.code, d.name, d.iso_letter, d.sort_order, false
  from disciplines d
  where d.organisation_id is null
    and is_account_member(p_org)
    and not exists (select 1 from disciplines f where f.organisation_id = p_org)
  order by 4, 1
$$;

create or replace function fork_disciplines(p_org uuid)
returns int language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_count int;
begin
  if not is_account_admin(p_org) then raise exception 'not permitted'; end if;
  if exists (select 1 from disciplines where organisation_id = p_org) then
    return 0;
  end if;
  insert into disciplines (organisation_id, code, name, iso_letter, sort_order)
  select p_org, code, name, iso_letter, sort_order
  from disciplines where organisation_id is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Adds disciplines the published set has gained since the fork was taken, and
-- touches nothing the account has already edited or deliberately removed by
-- code it still holds. A fork stays the account's own.
create or replace function refresh_discipline_fork(p_org uuid)
returns int language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_count int;
begin
  if not is_account_admin(p_org) then raise exception 'not permitted'; end if;
  insert into disciplines (organisation_id, code, name, iso_letter, sort_order)
  select p_org, p.code, p.name, p.iso_letter, p.sort_order
  from disciplines p
  where p.organisation_id is null
    and not exists (select 1 from disciplines f
                    where f.organisation_id = p_org and f.code = p.code);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function project_disciplines_in_use(p_project uuid)
returns table (code text, name text, iso_letter text, sort_order int, required boolean)
language sql stable security definer
set search_path = public, pg_temp as $$
  select d.code, d.name, d.iso_letter, d.sort_order, coalesce(pd.required, true)
  from projects p
  cross join lateral account_disciplines(p.organisation_id) d
  left join project_disciplines pd
    on pd.project_id = p.id and pd.discipline_code = d.code
  where p.id = p_project and can_see_project(p_project)
  order by d.sort_order, d.code
$$;

grant update (code, name, iso_letter, sort_order) on disciplines to authenticated;
grant execute on function refresh_discipline_fork(uuid) to authenticated;

create or replace function project_discipline_gaps(p_project uuid)
returns table (code text, name text)
language sql stable security definer
set search_path = public, pg_temp as $$
  select d.code, d.name
  from project_disciplines_in_use(p_project) d
  where d.required
    and not exists (
      select 1 from companies c
      join company_disciplines cd on cd.company_id = c.id
      where c.project_id = p_project and cd.discipline_code = d.code)
  order by d.sort_order, d.code
$$;

grant execute on function account_disciplines(uuid) to authenticated;
grant execute on function project_disciplines_in_use(uuid) to authenticated;
grant execute on function project_discipline_gaps(uuid) to authenticated;
