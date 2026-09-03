-- Phase 4 — programme import, as one transaction.
--
-- A partially applied programme revision is worse than a rejected one: half the
-- project reschedules and nobody can tell which half. The whole file is
-- validated, the diff is built, and the write happens in a single statement
-- from the caller's point of view -- a function body is one transaction, so a
-- bad row anywhere leaves the previous revision entirely intact.
--
-- The handover notes call for an Edge Function. A definer function is the
-- stronger form of the same requirement: it is equally server-side, it cannot
-- be bypassed by posting to the table (no role holds insert on programme_tasks),
-- and it is atomic by construction rather than by remembering to be.
--
-- The browser's job is only to parse CSV and map columns. It sends rows as
-- jsonb; nothing it sends is trusted.

create or replace function import_programme(
  p_project uuid,
  p_label text,
  p_rows jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_import_id uuid;
  v_row jsonb;
  v_i int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_uids text[] := '{}';
  v_added int := 0;
  v_updated int := 0;
  v_moved jsonb := '[]'::jsonb;
  v_removed int := 0;
  v_restored int := 0;
  v_uid text;
  v_start date;
  v_finish date;
  v_type text;
  v_level int;
  v_pct int;
  v_existing programme_tasks%rowtype;
begin
  select organisation_id into v_org from projects where id = p_project;
  if v_org is null then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  -- Only the host's own staff reschedule a project. A consultant reads the
  -- programme; they do not get to move it.
  if not (is_account_staff(v_org) or is_platform_owner()) then
    raise exception 'Only account admin or internal staff may import a programme'
      using errcode = '42501';
  end if;
  if not account_is_live(v_org) then
    raise exception 'Account is not live' using errcode = '42501';
  end if;

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The file contained no rows' using errcode = '22023';
  end if;

  -- Pass one: validate everything before writing anything. Rows are reported
  -- by their position in the file so the importer can hand back a rejects CSV
  -- that lines up with what the user submitted.
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_uid := nullif(btrim(coalesce(v_row->>'task_uid', '')), '');

    if v_uid is null then
      v_errors := v_errors || jsonb_build_object('row', v_i, 'field', 'task_uid',
        'message', 'Missing ID');
      continue;
    end if;
    if v_uid = any(v_uids) then
      v_errors := v_errors || jsonb_build_object('row', v_i, 'field', 'task_uid',
        'message', format('Duplicate ID %s -- it appears more than once in this file', v_uid));
      continue;
    end if;
    v_uids := v_uids || v_uid;

    if nullif(btrim(coalesce(v_row->>'description', '')), '') is null then
      v_errors := v_errors || jsonb_build_object('row', v_i, 'field', 'description',
        'message', 'Missing description');
    end if;

    begin
      v_start  := (v_row->>'start_date')::date;
      v_finish := (v_row->>'finish_date')::date;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', v_i, 'field', 'dates',
        'message', 'Start or finish is not a date the importer understands');
      continue;
    end;
    if v_start is null or v_finish is null then
      v_errors := v_errors || jsonb_build_object('row', v_i, 'field', 'dates',
        'message', 'Start and finish are both required');
      continue;
    end if;
    if v_finish < v_start then
      v_errors := v_errors || jsonb_build_object('row', v_i, 'field', 'dates',
        'message', 'Finish is before start');
    end if;

    v_type := coalesce(nullif(btrim(coalesce(v_row->>'task_type', '')), ''), 'Task');
    if v_type not in ('Task','Summary','Milestone') then
      v_errors := v_errors || jsonb_build_object('row', v_i, 'field', 'task_type',
        'message', format('Type must be Task, Summary or Milestone, not "%s"', v_type));
    elsif v_type = 'Milestone' and v_start <> v_finish then
      v_errors := v_errors || jsonb_build_object('row', v_i, 'field', 'task_type',
        'message', 'A milestone must start and finish on the same day');
    end if;

    v_level := coalesce((v_row->>'level')::int, 1);
    if v_level < 1 or v_level > 9 then
      v_errors := v_errors || jsonb_build_object('row', v_i, 'field', 'level',
        'message', 'Level must be between 1 and 9');
    end if;

    v_pct := coalesce((v_row->>'percent_complete')::int, 0);
    if v_pct < 0 or v_pct > 100 then
      v_errors := v_errors || jsonb_build_object('row', v_i, 'field', 'percent_complete',
        'message', 'Percent complete must be between 0 and 100');
    end if;
  end loop;

  -- Nothing is written if anything is wrong. The caller gets every problem at
  -- once rather than discovering them one re-upload at a time.
  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object(
      'ok', false,
      'row_count', v_i,
      'errors', v_errors);
  end if;

  insert into programme_imports (project_id, label, imported_by, row_count)
  values (p_project, coalesce(nullif(btrim(p_label), ''), 'Programme import'),
          auth.uid(), jsonb_array_length(p_rows))
  returning id into v_import_id;

  -- Pass two: apply. Matching is by task_uid, which is why the planner's ID
  -- must be stable across revisions -- it is the only thing tying a line to
  -- everything anchored to it.
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_uid    := btrim(v_row->>'task_uid');
    v_start  := (v_row->>'start_date')::date;
    v_finish := (v_row->>'finish_date')::date;
    v_type   := coalesce(nullif(btrim(coalesce(v_row->>'task_type', '')), ''), 'Task');
    v_level  := coalesce((v_row->>'level')::int, 1);
    v_pct    := coalesce((v_row->>'percent_complete')::int, 0);

    select * into v_existing from programme_tasks
    where project_id = p_project and task_uid = v_uid;

    if not found then
      insert into programme_tasks (project_id, task_uid, description, start_date,
        finish_date, percent_complete, level, parent_uid, task_type, last_import_id)
      values (p_project, v_uid, btrim(v_row->>'description'), v_start, v_finish,
        v_pct, v_level, nullif(btrim(coalesce(v_row->>'parent_uid', '')), ''),
        v_type, v_import_id);
      v_added := v_added + 1;
    else
      -- What moved is reported per line, because "the programme has been
      -- updated" is not something anyone can act on.
      if v_existing.start_date <> v_start or v_existing.finish_date <> v_finish then
        v_moved := v_moved || jsonb_build_object(
          'task_uid', v_uid,
          'description', btrim(v_row->>'description'),
          'was_start', v_existing.start_date, 'now_start', v_start,
          'was_finish', v_existing.finish_date, 'now_finish', v_finish,
          'finish_slip_days', v_finish - v_existing.finish_date);
      end if;
      if v_existing.removed then v_restored := v_restored + 1; end if;

      update programme_tasks set
        description = btrim(v_row->>'description'),
        start_date = v_start,
        finish_date = v_finish,
        percent_complete = v_pct,
        level = v_level,
        parent_uid = nullif(btrim(coalesce(v_row->>'parent_uid', '')), ''),
        task_type = v_type,
        last_import_id = v_import_id,
        removed = false,
        removed_at = null
      where id = v_existing.id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  -- A line absent from this revision is marked removed, never deleted. Deleting
  -- it would orphan everything anchored to it without trace; this way the
  -- dependants keep their date and gain a flag.
  update programme_tasks
  set removed = true, removed_at = now()
  where project_id = p_project and not removed and not (task_uid = any(v_uids));
  get diagnostics v_removed = row_count;

  update programme_imports set summary = jsonb_build_object(
    'added', v_added, 'updated', v_updated, 'removed', v_removed,
    'restored', v_restored, 'moved', v_moved)
  where id = v_import_id;

  return jsonb_build_object(
    'ok', true,
    'import_id', v_import_id,
    'row_count', jsonb_array_length(p_rows),
    'added', v_added,
    'updated', v_updated,
    'removed', v_removed,
    'restored', v_restored,
    'moved', v_moved);
end;
$$;

comment on function import_programme(uuid, text, jsonb) is
  'Validate, diff and apply a programme revision atomically. Returns the diff.';

-- Tracking a line. Both are scoped to the caller: a person may only ever add or
-- drop their own watch, whatever they post.
create or replace function watch_programme_line(p_project uuid, p_task_uid text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not can_see_project(p_project) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from programme_tasks
                 where project_id = p_project and task_uid = p_task_uid) then
    raise exception 'No such programme line' using errcode = 'P0002';
  end if;
  insert into programme_watch (project_id, profile_id, task_uid)
  values (p_project, auth.uid(), p_task_uid)
  on conflict do nothing;
end;
$$;

create or replace function unwatch_programme_line(p_project uuid, p_task_uid text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  delete from programme_watch
  where project_id = p_project and profile_id = auth.uid() and task_uid = p_task_uid;
end;
$$;
