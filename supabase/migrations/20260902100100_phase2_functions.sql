-- Phase 2 — the first spine, and the catalogue copy.
--
-- SPINE 1: nothing is assigned to a company. It is assigned to a DISCIPLINE,
-- and companies hold disciplines. companies_for_discipline() is that lookup, and
-- it is live: novate the architect and every deliverable follows, because
-- nothing was ever pinned to the old company. Never cache its result, and never
-- add a company_id to a record that should be asking this question.

create or replace function companies_for_discipline(p_project uuid, p_code text)
returns table (company_id uuid, name text, originator_code text, company_type text)
language sql stable security definer
set search_path = public, pg_temp as $$
  select c.id, c.name, c.originator_code, c.company_type
  from companies c
  join company_disciplines cd on cd.company_id = c.id
  where c.project_id = p_project
    and cd.discipline_code = p_code
    and can_see_project(p_project)
  order by c.name
$$;

-- The disciplines an account works to: its own fork if it has one, the
-- published default until then. Editing the published set never reaches a fork.
create or replace function account_disciplines(p_org uuid)
returns table (code text, name text, sort_order int, forked boolean)
language sql stable security definer
set search_path = public, pg_temp as $$
  select d.code, d.name, d.sort_order, true
  from disciplines d
  where d.organisation_id = p_org and is_account_member(p_org)
  union all
  select d.code, d.name, d.sort_order, false
  from disciplines d
  where d.organisation_id is null
    and is_account_member(p_org)
    and not exists (select 1 from disciplines f where f.organisation_id = p_org)
  order by 3, 1
$$;

-- Taking the fork is what makes the list theirs to edit.
create or replace function fork_disciplines(p_org uuid)
returns int language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_count int;
begin
  if not is_account_admin(p_org) then raise exception 'not permitted'; end if;
  if exists (select 1 from disciplines where organisation_id = p_org) then
    return 0;  -- already forked; a second call must not duplicate
  end if;
  insert into disciplines (organisation_id, code, name, sort_order)
  select p_org, code, name, sort_order from disciplines where organisation_id is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- What a project works to: the account's list, less anything struck out for
-- this job. `required = false` drops a discipline from the gap report and the
-- coverage list without deleting it.
create or replace function project_disciplines_in_use(p_project uuid)
returns table (code text, name text, sort_order int, required boolean)
language sql stable security definer
set search_path = public, pg_temp as $$
  select d.code, d.name, d.sort_order,
         coalesce(pd.required, true)
  from projects p
  cross join lateral account_disciplines(p.organisation_id) d
  left join project_disciplines pd
    on pd.project_id = p.id and pd.discipline_code = d.code
  where p.id = p_project and can_see_project(p_project)
  order by d.sort_order, d.code
$$;

-- A discipline nobody on the project holds. The matrix shows these in hi-vis,
-- and it is the only thing that colour ever means.
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

-- ---------------------------------------------------------------------------
-- Selecting a firm onto a project — the copy, not a join
-- ---------------------------------------------------------------------------

create or replace function add_company_to_project(
  p_project uuid, p_catalogue_company uuid, p_originator_code text,
  p_company_type text, p_disciplines text[] default '{}'
) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_org uuid; v_cat catalogue_companies; v_id uuid;
begin
  select organisation_id into v_org from projects where id = p_project;
  if not found then raise exception 'no such project'; end if;
  if not (is_account_admin(v_org) or is_project_admin(p_project)) then
    raise exception 'not permitted';
  end if;
  if not account_is_live(v_org) then raise exception 'account is not active'; end if;
  if coalesce(trim(p_originator_code), '') = '' then
    raise exception 'an originator code is required';
  end if;

  select * into v_cat from catalogue_companies
   where id = p_catalogue_company and organisation_id = v_org;
  if not found then raise exception 'that firm is not in this account''s catalogue'; end if;

  if exists (select 1 from companies
             where project_id = p_project and catalogue_company_id = p_catalogue_company) then
    raise exception 'that firm is already on this project';
  end if;

  -- the snapshot: name and address are copied now and never re-read
  insert into companies (project_id, catalogue_company_id, name, address,
                         originator_code, company_type)
  values (p_project, p_catalogue_company, v_cat.name, v_cat.address,
          upper(trim(p_originator_code)), p_company_type)
  returning id into v_id;

  insert into company_disciplines (company_id, discipline_code)
  select v_id, unnest(coalesce(p_disciplines, '{}'))
  on conflict do nothing;

  return v_id;
end $$;

-- Bringing an individual onto a project copies them too.
create or replace function add_person_to_project(
  p_company uuid, p_contact uuid, p_is_primary boolean default false
) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_project uuid; v_org uuid; v_contact contacts; v_id uuid;
begin
  select c.project_id, p.organisation_id into v_project, v_org
  from companies c join projects p on p.id = c.project_id where c.id = p_company;
  if not found then raise exception 'no such company on a project'; end if;
  if not (is_account_admin(v_org) or is_project_admin(v_project)) then
    raise exception 'not permitted';
  end if;

  select * into v_contact from contacts where id = p_contact;
  if not found then raise exception 'no such person in the catalogue'; end if;

  if exists (select 1 from project_people
             where project_id = v_project and contact_id = p_contact) then
    raise exception 'that person is already on this project';
  end if;

  if p_is_primary then
    update project_people set is_primary = false where company_id = p_company;
  end if;

  insert into project_people (project_id, company_id, contact_id, name, job_role,
                              email, phone, is_primary,
                              profile_id)
  values (v_project, p_company, p_contact, v_contact.name, v_contact.job_role,
          v_contact.email, v_contact.phone, p_is_primary,
          (select id from profiles where lower(email) = lower(v_contact.email)))
  returning id into v_id;
  return v_id;
end $$;

-- The one link back the other way: a correction made on a project can be
-- offered to the catalogue. Deliberately explicit — it never happens by itself.
create or replace function push_company_correction_to_catalogue(p_company uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_org uuid; c companies;
begin
  select * into c from companies where id = p_company;
  if not found then raise exception 'no such company'; end if;
  select organisation_id into v_org from projects where id = c.project_id;
  if not is_account_admin(v_org) then raise exception 'not permitted'; end if;
  if c.catalogue_company_id is null then
    raise exception 'this company was added to the project directly and has no catalogue entry';
  end if;
  update catalogue_companies set name = c.name, address = c.address
  where id = c.catalogue_company_id;
end $$;

-- ---------------------------------------------------------------------------
-- Appointment document status — derived, never stored
-- ---------------------------------------------------------------------------

create or replace function company_appointment_status(p_company uuid)
returns table (slot text, state text, filename text, uploaded_at timestamptz)
language sql stable security definer
set search_path = public, pg_temp as $$
  select s.slot,
         case
           when d.id is null then 'missing'
           when d.superseded_by is not null then 'superseded'
           when d.approved then 'approved'
           else 'awaiting approval'
         end,
         d.filename, d.uploaded_at
  from (values ('competency_statement'), ('team_cvs'), ('appointment'), ('scope_of_work'))
       as s(slot)
  left join appointment_documents d on d.company_id = p_company and d.slot = s.slot
  where exists (select 1 from companies c
                where c.id = p_company and can_see_project(c.project_id))
  order by s.slot
$$;

grant execute on function companies_for_discipline(uuid, text) to authenticated;
grant execute on function account_disciplines(uuid) to authenticated;
grant execute on function fork_disciplines(uuid) to authenticated;
grant execute on function project_disciplines_in_use(uuid) to authenticated;
grant execute on function project_discipline_gaps(uuid) to authenticated;
grant execute on function add_company_to_project(uuid, uuid, text, text, text[]) to authenticated;
grant execute on function add_person_to_project(uuid, uuid, boolean) to authenticated;
grant execute on function push_company_correction_to_catalogue(uuid) to authenticated;
grant execute on function company_appointment_status(uuid) to authenticated;
