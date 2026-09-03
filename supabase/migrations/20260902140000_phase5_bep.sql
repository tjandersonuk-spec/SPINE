-- Phase 5, part one -- the BIM execution plan.
--
-- The BEP is what makes a drawing number mean something. Without it the
-- register is a list of strings: nothing can say whether a name is compliant,
-- which company originated it, or whether revision C02 is construction issue or
-- still preliminary. So it comes before the register rather than after.

create table bep (
  project_id uuid primary key references projects(id) on delete cascade,
  delimiter text not null default '-',
  created_at timestamptz not null default now()
);

-- One row per field of the naming convention, in order. min/max length are what
-- makes a name checkable rather than merely present.
create table bep_fields (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references bep(project_id) on delete cascade,
  position int not null,
  name text not null,
  min_len int not null check (min_len >= 1),
  max_len int not null,
  required boolean not null default true,
  -- Where this field's permitted values come from. 'directory' is the important
  -- one: it means the codes are a live join to the project's companies, not a
  -- stored list -- see bep_field_codes() below.
  source text not null check (source in ('project','directory','standard','free')),
  unique (project_id, position),
  constraint bep_fields_len_sane check (max_len >= min_len)
);

create table bep_field_values (
  field_id uuid not null references bep_fields(id) on delete cascade,
  code text not null,
  description text,
  primary key (field_id, code)
);

-- Revision prefix -> construction status. The longest matching prefix wins, so
-- 'CR' beats 'C' without needing the rules to be ordered by hand.
create table bep_revision_rules (
  project_id uuid not null references bep(project_id) on delete cascade,
  prefix text not null,
  construction_status text not null,
  primary key (project_id, prefix)
);

create table bep_suitability_codes (
  project_id uuid not null references bep(project_id) on delete cascade,
  code text not null,
  description text,
  in_use boolean not null default true,
  primary key (project_id, code)
);

create table bep_agreements (
  project_id uuid not null references bep(project_id) on delete cascade,
  topic_key text not null,
  position text,
  agreed_by uuid references profiles(id),
  agreed_on date,
  status text not null default 'Not started'
    check (status in ('Not started','Draft','Agreed')),
  primary key (project_id, topic_key)
);

-- The Originator field has no stored values, ever. Its permitted codes are the
-- project's companies, resolved at read time -- two lists of the same thing
-- diverge, and a BEP that disagrees with the directory is unenforceable.
create or replace function bep_field_codes(p_field uuid)
returns table (code text, description text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select v.code, v.description
  from bep_fields f
  join bep_field_values v on v.field_id = f.id
  where f.id = p_field and f.source <> 'directory'
  union all
  select c.originator_code, c.name
  from bep_fields f
  join companies c on c.project_id = f.project_id
  where f.id = p_field and f.source = 'directory'
    and c.originator_code is not null
  order by 1;
$$;

-- The starting point a project adopts and then edits: the seven-field ISO 19650
-- UK Annex structure, with the discipline letters coming from the account's own
-- discipline list rather than a second copy of them.
create or replace function seed_bep(p_project uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_field uuid;
  v_code text;
begin
  select organisation_id into v_org from projects where id = p_project;
  if v_org is null then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if not (is_account_staff(v_org) or is_project_admin(p_project)) then
    raise exception 'Only the contractor''s team may set up the BEP' using errcode = '42501';
  end if;
  if exists (select 1 from bep where project_id = p_project) then
    return 'This project already has a BEP.';
  end if;

  insert into bep (project_id) values (p_project);

  insert into bep_fields (project_id, position, name, min_len, max_len, required, source)
  values
    (p_project, 1, 'Project',    3, 6, true,  'project'),
    (p_project, 2, 'Originator', 3, 6, true,  'directory'),
    (p_project, 3, 'Volume',     2, 4, true,  'standard'),
    (p_project, 4, 'Level',      2, 2, true,  'standard'),
    (p_project, 5, 'Type',       2, 2, true,  'standard'),
    (p_project, 6, 'Role',       1, 2, true,  'standard'),
    (p_project, 7, 'Number',     4, 4, true,  'free');

  select id into v_field from bep_fields where project_id = p_project and position = 3;
  insert into bep_field_values (field_id, code, description) values
    (v_field,'ZZ','All volumes / whole project'),
    (v_field,'BC','Block C');

  select id into v_field from bep_fields where project_id = p_project and position = 4;
  insert into bep_field_values (field_id, code, description) values
    (v_field,'ZZ','All levels'), (v_field,'XX','No level applicable'),
    (v_field,'B1','Basement 1'), (v_field,'GF','Ground floor'),
    (v_field,'01','Level 01'), (v_field,'02','Level 02'), (v_field,'03','Level 03'),
    (v_field,'RF','Roof');

  select id into v_field from bep_fields where project_id = p_project and position = 5;
  insert into bep_field_values (field_id, code, description) values
    (v_field,'DR','Drawing'), (v_field,'M3','3D model'), (v_field,'M2','2D model'),
    (v_field,'SH','Schedule'), (v_field,'SP','Specification'), (v_field,'RP','Report'),
    (v_field,'CA','Calculations'), (v_field,'CO','Correspondence');

  -- Role codes are the discipline letters already held on the account's
  -- discipline list. Copying them into a second table is how the two drift.
  select id into v_field from bep_fields where project_id = p_project and position = 6;
  for v_code in
    select distinct d.iso_letter from disciplines d
    where (d.organisation_id = v_org or (d.organisation_id is null
           and not exists (select 1 from disciplines f where f.organisation_id = v_org)))
      and d.iso_letter is not null
  loop
    insert into bep_field_values (field_id, code, description)
    select v_field, v_code, string_agg(d.name, ', ' order by d.sort_order)
    from disciplines d
    where d.iso_letter = v_code
      and (d.organisation_id = v_org or (d.organisation_id is null
           and not exists (select 1 from disciplines f where f.organisation_id = v_org)))
    on conflict do nothing;
  end loop;

  insert into bep_revision_rules (project_id, prefix, construction_status) values
    (p_project, 'P',  'Preliminary'),
    (p_project, 'C',  'Construction'),
    (p_project, 'CR', 'Construction (revised)');

  insert into bep_suitability_codes (project_id, code, description) values
    (p_project,'S0','Work in progress'), (p_project,'S1','Suitable for coordination'),
    (p_project,'S2','Suitable for information'), (p_project,'S3','Suitable for review and comment'),
    (p_project,'S4','Suitable for stage approval'), (p_project,'A1','Authorised and accepted'),
    (p_project,'B1','Partial sign-off, with comments');

  return 'BEP set up: seven fields, three revision rules, seven suitability codes.';
end;
$$;

revoke all on function seed_bep(uuid) from public;
grant execute on function seed_bep(uuid) to authenticated;
grant execute on function bep_field_codes(uuid) to authenticated;
