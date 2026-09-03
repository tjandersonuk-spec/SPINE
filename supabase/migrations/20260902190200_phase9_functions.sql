-- Phase 9, part three -- loading, and what is derived.

-- Which company holds this discipline, but only if the answer is unambiguous.
--
-- Two holders means null. That is a decision somebody has to make, and a wrong
-- default is worse than a blank one -- a pre-filled wrong owner gets accepted
-- silently, where a blank gets asked about.
create or replace function sole_holder(p_project uuid, p_discipline text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- No min() over uuid, so the single row is taken explicitly. count(*) = 1 is
  -- the whole condition: two holders means null.
  select (array_agg(c.id))[1]
  from companies c
  join company_disciplines cd on cd.company_id = c.id
  where c.project_id = p_project and cd.discipline_code = p_discipline
  having count(*) = 1;
$$;

grant execute on function sole_holder(uuid, text) to authenticated;

-- Load a checklist onto a project. Copies the template; never links to it.
create or replace function load_checklist(p_project uuid, p_type text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid; v_kind text; v_added int; v_assigned int;
begin
  select organisation_id into v_org from projects where id = p_project;
  if v_org is null then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if not can_write_project_setup(p_project) then
    raise exception 'Only the contractor''s team may load a checklist' using errcode = '42501';
  end if;
  v_kind := 'checklist:' || p_type;
  if not (v_kind = any(tracked_kinds())) then
    raise exception 'No checklist called "%"', p_type using errcode = '22023';
  end if;

  insert into tracked_items (project_id, kind, reference, heading, title, prompt,
                             discipline, company_id, created_by)
  select p_project, v_kind, t.reference, t.heading, t.title, t.prompt, t.discipline,
         -- Pre-assign only where exactly one company holds the discipline.
         sole_holder(p_project, t.discipline),
         auth.uid()
  from account_checklist_templates(v_org, p_type) t
  -- Idempotent: loading twice adds what is new and leaves everything else,
  -- including any answer already written, exactly as it was.
  on conflict (project_id, kind, reference) do nothing;
  get diagnostics v_added = row_count;

  select count(*)::int into v_assigned
  from tracked_items where project_id = p_project and kind = v_kind and company_id is not null;

  return jsonb_build_object('ok', true, 'added', v_added, 'pre_assigned', v_assigned);
end;
$$;

-- Which scope templates to offer for a company: the core standard, plus one per
-- discipline they actually hold.
create or replace function suggested_scope_templates(p_project uuid, p_company uuid)
returns setof scope_templates
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.*
  from account_scope_templates(
         (select organisation_id from projects where id = p_project)) t
  where t.is_core
     or exists (select 1 from company_disciplines cd
                where cd.company_id = p_company and cd.discipline_code = t.discipline);
$$;

-- Apply chosen scope templates to a company's appointment.
--
-- A selection, not a single action: pre-check what suggested_scope_templates()
-- returns and let someone tick anything else by hand for a firm covering more
-- than one discipline.
create or replace function apply_scope_templates(
  p_project uuid, p_company uuid, p_template_ids uuid[]
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_added int := 0; v_n int; t record;
begin
  if not can_write_project_setup(p_project) then
    raise exception 'Only the contractor''s team may apply a scope template'
      using errcode = '42501';
  end if;
  if not exists (select 1 from companies where id = p_company and project_id = p_project) then
    raise exception 'That company is not on this project' using errcode = 'P0002';
  end if;

  for t in select * from scope_templates where id = any(p_template_ids) loop
    insert into tracked_items (project_id, kind, reference, heading, title, prompt,
                               discipline, company_id, template_id, template_name,
                               ext, created_by)
    select p_project, 'scope',
           -- Dedup is on (company, template, reference), never on reference
           -- alone: two templates are free to reuse the same numbering
           -- internally and must not collide because the numbers happen to.
           t.id::text || ':' || p_company::text || ':' || i.reference,
           i.heading, i.description, null, t.discipline, p_company,
           t.id,
           -- The template's name AT THE TIME OF APPLICATION. Renaming it later
           -- must not rewrite history on an appointment that already has its
           -- items.
           t.name,
           jsonb_build_object('riba_stage', i.riba_stage, 'template_reference', i.reference),
           auth.uid()
    from scope_template_items i
    where i.template_id = t.id
    on conflict (project_id, kind, reference) do nothing;
    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
  end loop;

  return jsonb_build_object('ok', true, 'added', v_added);
end;
$$;

-- ------------------------------------------------------------------ derived
-- One view, a case on kind. Nothing here is a stored column.
create or replace view v_tracked_items as
select
  t.*,
  due_date(t.project_id, t.programme_task_uid, t.offset_days, t.anchor,
           t.due_date_override) as due,
  anchor_state(t.project_id, t.programme_task_uid) as anchor_state,
  -- Which company holds the discipline, live. Never a stored answer, so
  -- reassigning a discipline reassigns every item it leads.
  (select c.name from companies c where c.id = t.company_id) as company_name,
  (select count(*)::int
   from companies c
   join company_disciplines cd on cd.company_id = c.id
   where c.project_id = t.project_id and cd.discipline_code = t.discipline) as holders,
  -- Done means done, whatever this kind calls it.
  (t.status in ('Complete','Discharged','Approved','Approved with conditions','Not required'))
    as is_done,
  (t.required
   and t.status not in ('Complete','Discharged','Approved','Approved with conditions','Not required')
   and due_date(t.project_id, t.programme_task_uid, t.offset_days, t.anchor,
                t.due_date_override) < current_date) as overdue,
  -- A response nobody has accepted yet. The provenance is the point: a machine
  -- suggestion that looks like a person's answer stops the checklist meaning
  -- anything.
  (t.response is not null and t.response_source = 'suggested') as awaiting_acceptance
from tracked_items t;

-- Progress per kind.
--
-- required = false drops the row from every denominator and renders it struck
-- through, but the row survives. Deleting it would lose the decision that it
-- was not needed, which is precisely what somebody asks about later.
create or replace function tracked_progress(p_project uuid)
returns table (kind text, total int, done int, overdue int, struck_out int)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    v.kind,
    count(*) filter (where v.required)::int,
    count(*) filter (where v.required and v.is_done)::int,
    count(*) filter (where v.overdue)::int,
    count(*) filter (where not v.required)::int
  from v_tracked_items v
  where v.project_id = p_project
  group by v.kind
  order by v.kind;
$$;

grant execute on function tracked_progress(uuid) to authenticated;

-- Writing a response. Separate from a general update so the provenance and the
-- timestamp move together with the text -- a response with no author is not a
-- response, and a suggestion silently promoted to an answer is worse.
create or replace function set_response(
  p_item uuid, p_response text, p_source text default 'person'
) returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_project uuid;
begin
  select project_id into v_project from tracked_items where id = p_item;
  if v_project is null or not can_see_project(v_project) then
    raise exception 'No such item' using errcode = 'P0002';
  end if;
  if p_source not in ('person','suggested') then
    raise exception 'A response is written by a person or suggested by a machine'
      using errcode = '22023';
  end if;
  update tracked_items set
    response = nullif(btrim(coalesce(p_response,'')), ''),
    response_source = p_source,
    response_by = case when nullif(btrim(coalesce(p_response,'')),'') is null
                       then null else auth.uid() end,
    response_at = case when nullif(btrim(coalesce(p_response,'')),'') is null
                       then null else now() end
  where id = p_item;
end;
$$;

-- Accepting a machine suggestion. A deliberate act by a person, recorded as
-- theirs -- which is the whole reason the two are distinguishable.
create or replace function accept_response(p_item uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_project uuid;
begin
  select project_id into v_project from tracked_items where id = p_item;
  if v_project is null or not can_see_project(v_project) then
    raise exception 'No such item' using errcode = 'P0002';
  end if;
  update tracked_items
  set response_source = 'person', response_by = auth.uid(), response_at = now()
  where id = p_item and response is not null;
end;
$$;

revoke all on function set_response(uuid, text, text) from public;
grant execute on function set_response(uuid, text, text) to authenticated;
revoke all on function accept_response(uuid) from public;
grant execute on function accept_response(uuid) to authenticated;
revoke all on function load_checklist(uuid, text) from public;
grant execute on function load_checklist(uuid, text) to authenticated;
revoke all on function apply_scope_templates(uuid, uuid, uuid[]) from public;
grant execute on function apply_scope_templates(uuid, uuid, uuid[]) to authenticated;
grant execute on function suggested_scope_templates(uuid, uuid) to authenticated;

-- Tracked items carry the anchor columns, so the line inspector must reach
-- them. phase4.test.ts fails the build if a table gains programme_task_uid and
-- offset_days without appearing here.
drop function if exists programme_dependents(uuid, text);
create or replace function programme_dependents(p_project uuid, p_task_uid text)
returns table (module text, record_id uuid, ref text, description text, due date)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select 'Drawing'::text, r.id, r.document_number, coalesce(r.title, ''),
         due_date(r.project_id, r.programme_task_uid, r.offset_days, r.anchor,
                  r.due_date_override)
  from drawing_register r
  where r.project_id = p_project and r.programme_task_uid = p_task_uid
  union all
  select case i.source_kind when 'rfi' then 'RFI' else 'Task' end,
         i.id, i.reference, i.title,
         due_date(i.project_id, i.programme_task_uid, i.offset_days, i.anchor,
                  i.due_date_override)
  from issues i
  where i.project_id = p_project and i.programme_task_uid = p_task_uid
    and can_see(i.project_id, i.visibility, i.raised_by,
                (select pp.profile_id from project_people pp where pp.id = i.person_id))
  union all
  select initcap(replace(split_part(t.kind, ':', 1), '_', ' ')),
         t.id, t.reference, t.title,
         due_date(t.project_id, t.programme_task_uid, t.offset_days, t.anchor,
                  t.due_date_override)
  from tracked_items t
  where t.project_id = p_project and t.programme_task_uid = p_task_uid
    and can_see(t.project_id, t.visibility, t.created_by,
                (select pp.profile_id from project_people pp where pp.id = t.person_id))
  order by 1, 3;
$$;

grant execute on function programme_dependents(uuid, text) to authenticated;
