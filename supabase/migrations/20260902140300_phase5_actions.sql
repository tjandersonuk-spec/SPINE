-- Phase 5, part four -- the actions.
--
-- Import and reconcile are deliberately separate. Importing writes the raw rows
-- and touches the register not at all; the register changes only when a person
-- accepts a row. A register nobody accepted is a register nobody trusts.

create or replace function import_documents(
  p_project uuid, p_label text, p_rows jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid; v_import uuid; v_row jsonb; v_i int := 0; v_errors jsonb := '[]'::jsonb;
begin
  select organisation_id into v_org from projects where id = p_project;
  if v_org is null then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if not (is_account_staff(v_org) or is_project_admin(p_project)) then
    raise exception 'Only the contractor''s team may import a CDE export'
      using errcode = '42501';
  end if;
  if not account_is_live(v_org) then
    raise exception 'Account is not live' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The file contained no rows' using errcode = '22023';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    if nullif(btrim(coalesce(v_row->>'document_number','')), '') is null then
      v_errors := v_errors || jsonb_build_object('row', v_i, 'field', 'document_number',
        'message', 'Missing document number');
    end if;
    if nullif(btrim(coalesce(v_row->>'revision','')), '') is null then
      v_errors := v_errors || jsonb_build_object('row', v_i, 'field', 'revision',
        'message', 'Missing revision');
    end if;
    if nullif(btrim(coalesce(v_row->>'file_format','')), '') is null then
      v_errors := v_errors || jsonb_build_object('row', v_i, 'field', 'file_format',
        'message', 'Missing file format -- the register needs it to tell a PDF from a DWG');
    end if;
  end loop;

  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('ok', false, 'row_count', v_i, 'errors', v_errors);
  end if;

  insert into document_imports (project_id, label, imported_by, row_count)
  values (p_project, coalesce(nullif(btrim(p_label),''), 'CDE export'), auth.uid(),
          jsonb_array_length(p_rows))
  returning id into v_import;

  insert into document_rows (project_id, import_id, document_number, title, revision,
                             workflow_status, file_format)
  select p_project, v_import, btrim(e->>'document_number'), nullif(btrim(coalesce(e->>'title','')),''),
         btrim(e->>'revision'), nullif(btrim(coalesce(e->>'workflow_status','')),''),
         btrim(e->>'file_format')
  from jsonb_array_elements(p_rows) e;

  return jsonb_build_object('ok', true, 'import_id', v_import,
    'row_count', jsonb_array_length(p_rows));
end;
$$;

-- What the latest import says that the register does not. Nothing is applied:
-- this is the list a person works through.
create or replace function reconcile_preview(p_project uuid)
returns table (
  document_number text, title text, revision text, workflow_status text,
  register_revision text, change text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with latest as (
    select id from document_imports where project_id = p_project
    order by imported_at desc limit 1
  ),
  -- Only PDFs reach the register; a DWG of the same number sets has_dwg and is
  -- not a row of its own. This is the one place two source rows collapse to one.
  pdfs as (
    select distinct on (d.document_number)
           d.document_number, d.title, d.revision, d.workflow_status
    from document_rows d
    where d.project_id = p_project
      and d.import_id = (select id from latest)
      and lower(d.file_format) = 'pdf'
    order by d.document_number, d.id
  )
  select p.document_number, p.title, p.revision, p.workflow_status,
         r.revision,
         case
           when r.id is null then 'new'
           when r.revision is null then 'first issue'
           when r.revision is distinct from p.revision then 'revised'
           when r.title is distinct from p.title then 'retitled'
           else 'unchanged'
         end
  from pdfs p
  left join drawing_register r
    on r.project_id = p_project and r.document_number = p.document_number
  order by p.document_number;
$$;

-- Accept specific rows into the register. Only what the user picked, and only
-- from the latest import.
create or replace function accept_into_register(p_project uuid, p_numbers text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_org uuid; v_added int := 0; v_updated int := 0;
begin
  select organisation_id into v_org from projects where id = p_project;
  if v_org is null then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if not (is_account_staff(v_org) or is_project_admin(p_project)) then
    raise exception 'Only the contractor''s team may reconcile the register'
      using errcode = '42501';
  end if;
  if coalesce(array_length(p_numbers, 1), 0) = 0 then
    raise exception 'Nothing was selected' using errcode = '22023';
  end if;

  with src as (
    select * from reconcile_preview(p_project)
    where document_number = any(p_numbers) and change <> 'unchanged'
  ),
  ins as (
    insert into drawing_register (project_id, document_number, title, revision,
                                  workflow_status, last_synced)
    select p_project, s.document_number, s.title, s.revision, s.workflow_status, current_date
    from src s
    on conflict (project_id, document_number) do update
      set title = excluded.title,
          revision = excluded.revision,
          workflow_status = excluded.workflow_status,
          last_synced = current_date
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted)
  into v_added, v_updated from ins;

  return jsonb_build_object('ok', true, 'added', v_added, 'updated', v_updated);
end;
$$;

-- Issue a transmittal. A pack is expanded here into individual items, each
-- freezing the revision as it stands now: the transmittal stores drawings,
-- never a pack reference, because the pack changes and the historic issue must
-- not.
create or replace function issue_transmittal(
  p_project uuid, p_method text, p_reason text, p_notes text,
  p_pack uuid, p_drawing_ids uuid[], p_recipients jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid; v_ref text; v_id uuid; v_ids uuid[]; v_n int; v_r jsonb;
begin
  select organisation_id into v_org from projects where id = p_project;
  if v_org is null then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if not (is_account_staff(v_org) or is_project_admin(p_project)) then
    raise exception 'Only the contractor''s team may issue a transmittal'
      using errcode = '42501';
  end if;

  v_ids := case
    when p_pack is not null then
      (select array_agg(i.drawing_id) from drawing_pack_items i where i.pack_id = p_pack)
    else p_drawing_ids
  end;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'A transmittal must carry at least one drawing' using errcode = '22023';
  end if;

  v_ref := next_reference(p_project, 'transmittal', 'TX');
  insert into transmittals (project_id, reference, method, reason, notes, issued_by)
  values (p_project, v_ref, p_method, nullif(btrim(coalesce(p_reason,'')),''),
          nullif(btrim(coalesce(p_notes,'')),''), auth.uid())
  returning id into v_id;

  -- The revision as it stands at this instant, frozen. A drawing not yet
  -- delivered cannot be issued.
  insert into transmittal_items (transmittal_id, drawing_id, revision_at_issue)
  select v_id, r.id, r.revision
  from drawing_register r
  where r.id = any(v_ids) and r.project_id = p_project and r.revision is not null;
  get diagnostics v_n = row_count;

  if v_n = 0 then
    raise exception 'None of those drawings has been delivered yet, so there is nothing to issue'
      using errcode = '22023';
  end if;

  -- An empty distribution means the whole project; a populated one means those
  -- people, and the host and raiser see it either way.
  if p_recipients is not null and jsonb_array_length(p_recipients) > 0 then
    for v_r in select * from jsonb_array_elements(p_recipients) loop
      insert into transmittal_recipients (transmittal_id, company_id, person_id, distribution)
      values (v_id, (v_r->>'company_id')::uuid, (v_r->>'person_id')::uuid,
              coalesce(nullif(v_r->>'distribution',''), 'information'))
      on conflict do nothing;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'transmittal_id', v_id, 'reference', v_ref,
    'drawing_count', v_n);
end;
$$;

create or replace function create_pack(p_project uuid, p_name text, p_purpose text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_org uuid; v_id uuid;
begin
  select organisation_id into v_org from projects where id = p_project;
  if v_org is null then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if not (is_account_staff(v_org) or is_project_admin(p_project)) then
    raise exception 'Only the contractor''s team may create a pack' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'A pack needs a name' using errcode = '22023';
  end if;
  insert into drawing_packs (project_id, reference, name, purpose, owner_id)
  values (p_project, next_reference(p_project, 'pack', 'PK'), btrim(p_name),
          nullif(btrim(coalesce(p_purpose,'')),''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function import_documents(uuid, text, jsonb) from public;
grant execute on function import_documents(uuid, text, jsonb) to authenticated;
revoke all on function accept_into_register(uuid, text[]) from public;
grant execute on function accept_into_register(uuid, text[]) to authenticated;
revoke all on function issue_transmittal(uuid, text, text, text, uuid, uuid[], jsonb) from public;
grant execute on function issue_transmittal(uuid, text, text, text, uuid, uuid[], jsonb) to authenticated;
revoke all on function create_pack(uuid, text, text) from public;
grant execute on function create_pack(uuid, text, text) to authenticated;
revoke all on function next_reference(uuid, text, text) from public;
revoke all on function reconcile_preview(uuid) from public;
grant execute on function reconcile_preview(uuid) to authenticated;
