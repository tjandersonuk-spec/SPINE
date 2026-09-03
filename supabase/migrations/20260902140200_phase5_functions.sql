-- Phase 5, part three -- the derivations.
--
-- Construction status, naming compliance, originating company, DWG
-- availability, due and overdue, "revised since issue": all computed on read.
-- None of them is a column.

-- Who may change a project's set-up: the account's own staff, or that project's
-- admin. Named once because Phase 5 adds fifteen tables that all ask it, and
-- fifteen copies of the same predicate is fifteen chances to get one wrong.
create or replace function can_write_project_setup(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from projects p
    where p.id = p_project
      and account_is_live(p.organisation_id)
      and (is_account_staff(p.organisation_id) or is_project_admin(p.id)));
$$;

grant execute on function can_write_project_setup(uuid) to authenticated;

-- Revision prefix -> construction status, longest prefix first so 'CR' beats
-- 'C' without the rules needing to be ordered by hand.
create or replace function construction_status(p_project uuid, p_revision text)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select r.construction_status
  from bep_revision_rules r
  where r.project_id = p_project
    and upper(btrim(coalesce(p_revision, ''))) like r.prefix || '%'
  order by length(r.prefix) desc
  limit 1;
$$;

-- Does this document number follow the project's convention? Returns null when
-- it does, or the reason when it does not, so a caller can show the reason
-- rather than an unexplained cross.
create or replace function naming_error(p_project uuid, p_number text)
returns text
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_delim text;
  v_parts text[];
  v_expected int;
  f record;
  v_part text;
begin
  select delimiter into v_delim from bep where project_id = p_project;
  if v_delim is null then return null; end if;   -- no BEP, nothing to check against

  select count(*) into v_expected from bep_fields where project_id = p_project;
  if v_expected = 0 then return null; end if;

  v_parts := string_to_array(coalesce(p_number, ''), v_delim);
  if array_length(v_parts, 1) is distinct from v_expected then
    return format('Expected %s fields separated by "%s", found %s',
      v_expected, v_delim, coalesce(array_length(v_parts, 1), 0));
  end if;

  for f in select * from bep_fields where project_id = p_project order by position loop
    v_part := v_parts[f.position];
    if f.required and coalesce(btrim(v_part), '') = '' then
      return format('%s is missing', f.name);
    end if;
    if length(v_part) < f.min_len or length(v_part) > f.max_len then
      return format('%s "%s" is %s characters; expected %s to %s',
        f.name, v_part, length(v_part), f.min_len, f.max_len);
    end if;
    -- A field with a fixed list must use it. 'free' and 'project' are not
    -- checked against values: a drawing number is not a controlled vocabulary.
    if f.source in ('standard','directory')
       and exists (select 1 from bep_field_codes(f.id))
       and not exists (select 1 from bep_field_codes(f.id) c where c.code = v_part) then
      return format('%s "%s" is not one of the permitted codes', f.name, v_part);
    end if;
  end loop;
  return null;
end;
$$;

-- The register as anyone actually reads it. Everything beyond the stored
-- columns is derived here, so no page can show a figure that disagrees.
create or replace view v_drawing_register as
select
  r.id, r.project_id, r.document_number, r.title, r.revision, r.workflow_status,
  r.cde_url, r.programme_task_uid, r.offset_days, r.anchor, r.due_date_override,
  r.added_on, r.last_synced,
  construction_status(r.project_id, r.revision) as construction_status,
  naming_error(r.project_id, r.document_number) as naming_error,
  -- The one date function, as everywhere else.
  due_date(r.project_id, r.programme_task_uid, r.offset_days, r.anchor,
           r.due_date_override) as due,
  anchor_state(r.project_id, r.programme_task_uid) as anchor_state,
  -- Planned but not arrived. A row with no revision has not been delivered.
  (r.revision is null) as awaited,
  -- Overdue means due, past, and still not here. A delivered drawing is not
  -- overdue however late it was.
  (r.revision is null
   and due_date(r.project_id, r.programme_task_uid, r.offset_days, r.anchor,
                r.due_date_override) < current_date) as overdue,
  -- The originator code is the second field of the number, matched live against
  -- the directory -- never a stored company_id, same rule as the matrix.
  (select c.id from companies c
   where c.project_id = r.project_id
     and c.originator_code = split_part(r.document_number, '-', 2)) as company_id,
  (select c.name from companies c
   where c.project_id = r.project_id
     and c.originator_code = split_part(r.document_number, '-', 2)) as company_name,
  -- A DWG of the same number in the latest import. Two source rows collapsing
  -- to one register row is the point: only PDFs are the register.
  exists (select 1 from document_rows d
          where d.project_id = r.project_id
            and d.document_number = r.document_number
            and lower(d.file_format) <> 'pdf'
            and d.import_id = (select id from document_imports
                               where project_id = r.project_id
                               order by imported_at desc limit 1)) as has_dwg,
  -- Consultants block-allocate number ranges, so the register sorts on the
  -- number field rather than the whole string.
  split_part(r.document_number, '-', 7) as sort_number
from drawing_register r;

-- A pack, as a live thing. Counts are computed from the current register, so a
-- retitled or revised drawing is reflected the moment it changes.
create or replace view v_drawing_packs as
select
  p.id, p.project_id, p.reference, p.name, p.purpose, p.owner_id, p.created_at,
  (select count(*) from drawing_pack_items i where i.pack_id = p.id) as drawing_count,
  (select count(*) from drawing_pack_items i
   join drawing_register r on r.id = i.drawing_id
   where i.pack_id = p.id and r.revision is null) as awaited_count,
  -- How many drawings in this pack have moved on since they were last issued.
  -- Per drawing rather than per whole-set issue: a pack usually contains
  -- something not yet delivered, so it may never have gone out as a complete
  -- set, and a figure that only appears in that case would never appear at all.
  -- The comparison is the register now against the revision frozen on that
  -- drawing's most recent transmittal.
  (select count(*)
   from drawing_pack_items i
   join drawing_register r on r.id = i.drawing_id
   join lateral (
     select ti.revision_at_issue
     from transmittal_items ti
     join transmittals t on t.id = ti.transmittal_id
     where ti.drawing_id = i.drawing_id and t.project_id = p.project_id
     order by t.issue_date desc, t.created_at desc
     limit 1
   ) last_issue on true
   where i.pack_id = p.id
     and r.revision is distinct from last_issue.revision_at_issue) as revised_since_issue,
  -- How many have never been issued at all, which is the other half of the
  -- same question.
  (select count(*)
   from drawing_pack_items i
   where i.pack_id = p.id
     and not exists (
       select 1 from transmittal_items ti
       join transmittals t on t.id = ti.transmittal_id
       where ti.drawing_id = i.drawing_id and t.project_id = p.project_id)) as never_issued
from drawing_packs p;

-- Now that drawings carry the anchor columns, the line inspector must reach
-- them. This replaces the empty Phase 4 stub; phase4.test.ts fails the build if
-- a table gains programme_task_uid and this is not extended with it.
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
  order by 3;
$$;

grant execute on function construction_status(uuid, text) to authenticated;
grant execute on function naming_error(uuid, text) to authenticated;
grant execute on function programme_dependents(uuid, text) to authenticated;
