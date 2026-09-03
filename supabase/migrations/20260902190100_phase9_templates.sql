-- Phase 9, part two -- the templates.
--
-- Every template here is a host asset forked from a published default, the same
-- pattern as the DRM library and the discipline list. A project takes a COPY:
-- editing a template must never rewrite a project that has already loaded from
-- it, which is the kind of thing that gets "improved" into a live link by
-- someone trying to be helpful.

-- One table, five checklist types. Five near-identical tables would make the
-- sixth checklist a build instead of a template.
create table checklist_templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) on delete cascade,  -- null = published
  type text not null check (type in ('precon','client','handover','highways','utilities')),
  reference text not null,
  heading text not null,
  title text not null,
  prompt text,
  -- A pre-assignment hint, not an assignment. See load_checklist() for why the
  -- distinction matters.
  discipline text,
  sort_order int not null default 0,
  unique (organisation_id, type, reference)
);
create index on checklist_templates (organisation_id, type, sort_order);

-- Scope templates: one row per NAMED template, not one flat list.
--
-- This shipped broken once and the shape of the bug is worth keeping in mind
-- for every "one flat list applied to everyone" table. A discipline-tagged row
-- was added to the single existing template without the apply flow filtering by
-- discipline, so applying "standard scope" to anyone pulled in every
-- discipline's items -- a mechanical engineer could receive architectural
-- production-information duties. The fix was not a filter bolted on: "the
-- standard items" and "the architectural items" were never one list, and
-- splitting them removed the class of bug rather than one instance.
create table scope_templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) on delete cascade,  -- null = published
  name text not null,
  discipline text,                        -- null for the core standard template
  is_core boolean not null default false, -- the standard template; cannot be deleted
  unique (organisation_id, name)
);

create table scope_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references scope_templates(id) on delete cascade,
  reference text not null,
  heading text not null,
  description text not null,
  riba_stage text not null,
  unique (template_id, reference)
);

-- ------------------------------------------------------------------- forks
-- Taking a copy is what makes a template editable. Until an account forks, it
-- reads the published default and cannot change it.

create or replace function fork_checklist_templates(p_org uuid)
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_count int;
begin
  if not is_account_admin(p_org) then
    raise exception 'Only an account admin may take a copy' using errcode = '42501';
  end if;
  insert into checklist_templates (organisation_id, type, reference, heading, title,
                                   prompt, discipline, sort_order)
  select p_org, t.type, t.reference, t.heading, t.title, t.prompt, t.discipline, t.sort_order
  from checklist_templates t
  where t.organisation_id is null
    and not exists (select 1 from checklist_templates f
                    where f.organisation_id = p_org
                      and f.type = t.type and f.reference = t.reference);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function fork_scope_templates(p_org uuid)
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_count int; t record; v_new uuid;
begin
  if not is_account_admin(p_org) then
    raise exception 'Only an account admin may take a copy' using errcode = '42501';
  end if;
  v_count := 0;
  for t in
    select * from scope_templates s
    where s.organisation_id is null
      and not exists (select 1 from scope_templates f
                      where f.organisation_id = p_org and f.name = s.name)
  loop
    insert into scope_templates (organisation_id, name, discipline, is_core)
    values (p_org, t.name, t.discipline, t.is_core)
    returning id into v_new;
    insert into scope_template_items (template_id, reference, heading, description, riba_stage)
    select v_new, i.reference, i.heading, i.description, i.riba_stage
    from scope_template_items i where i.template_id = t.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- What an account reads: its own fork if it has one, otherwise the published
-- default. Never both -- a half-forked list is how two versions of the same
-- reference end up on one project.
create or replace function account_checklist_templates(p_org uuid, p_type text)
returns setof checklist_templates
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from checklist_templates t
  where t.type = p_type
    and (case when exists (select 1 from checklist_templates f
                           where f.organisation_id = p_org)
              then t.organisation_id = p_org
              else t.organisation_id is null end)
  order by t.sort_order, t.reference;
$$;

create or replace function account_scope_templates(p_org uuid)
returns setof scope_templates
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from scope_templates t
  where (case when exists (select 1 from scope_templates f where f.organisation_id = p_org)
              then t.organisation_id = p_org
              else t.organisation_id is null end)
  order by t.is_core desc, t.name;
$$;

grant execute on function fork_checklist_templates(uuid) to authenticated;
grant execute on function fork_scope_templates(uuid) to authenticated;
grant execute on function account_checklist_templates(uuid, text) to authenticated;
grant execute on function account_scope_templates(uuid) to authenticated;
