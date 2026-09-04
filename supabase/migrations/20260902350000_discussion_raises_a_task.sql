-- Talk about the item on the item, and turn the remark into a task.
--
-- A discussion that can only be read is a discussion that ends in somebody's
-- inbox. The point of putting one on every record is that the thing said there
-- becomes the thing done: a remark on a planning condition becomes a task
-- carrying that remark, still pointing at the condition it came from.
--
-- Two things that were missing.
--
-- The task did not record where it was raised. `issues` has carried
-- `origin_entity` and `origin_id` since phase 8 and `raise_issue()` never
-- wrote them, so a task raised from a building control item and one typed into
-- the issues tab were indistinguishable -- and the list could not be filtered
-- by the register a task came out of, which is the whole reason to raise it
-- there rather than here.
--
-- And the two writes were separate. Posting the comment and raising the task
-- through two calls leaves a comment with no task when the second fails, which
-- is the state nobody notices: the remark is there, so it looks handled.

-- ------------------------------------------------------------- categories
/**
 * What sort of register a discussion is attached to, as a filter value.
 *
 * One statement of it, because the category is written by the raise and read
 * by the filter, and two lists would disagree the first time a checklist kind
 * was added. A kind this does not know keeps its raw name rather than becoming
 * null: an unlabelled category is still a filter, an absent one is a task
 * nobody can find.
 */
create or replace function discussion_category(p_entity_type text)
returns text language sql immutable as $$
  select case p_entity_type
    when 'planning'    then 'Planning condition'
    when 'bc'          then 'Building control'
    when 'scope'       then 'Scope of service'
    when 'breeam'      then 'BREEAM'
    when 'drawing'     then 'Drawing'
    when 'drm_item'    then 'Responsibility matrix'
    when 'issue'       then 'Task or RFI'
    when 'meeting'     then 'Meeting'
    when 'risk'        then 'Risk'
    when 'changereq'   then 'Change request'
    when 'material'    then 'Material sample'
    when 'warranty'    then 'Warranty'
    when 'company'     then 'Company'
    when 'fee'         then 'Fee'
    when 'invoice'     then 'Invoice'
    when 'instalment'  then 'Payment schedule'
    when 'pack'        then 'Drawing pack'
    when 'transmittal' then 'Transmittal'
    when 'bep'         then 'BEP'
    when 'occurrence'  then 'Occurrence report'
    when 'room'        then 'Project room'
    else
      -- A checklist carries which checklist: "checklist:handover" is a more
      -- useful filter than "checklist".
      case when p_entity_type like 'checklist:%'
           then initcap(replace(substring(p_entity_type from 11), '_', ' '))
                || ' checklist'
           else initcap(replace(p_entity_type, '_', ' ')) end
  end;
$$;

grant execute on function discussion_category(text) to authenticated;

-- --------------------------------------------------------- raise, widened
-- Three parameters, all defaulted, all at the end: every existing caller is
-- untouched and keeps producing a task with no origin, which is correct for
-- one typed straight into the issues tab.
--
-- Dropped first, not replaced. `create or replace` with a different argument
-- list makes an overload rather than a replacement, and a call that matched
-- both then fails with "is not unique" -- at run time, from a page, on a
-- database that migrated without complaint.
drop function if exists raise_issue(
  uuid, text, text, text, uuid, text, integer, text, integer, text, uuid,
  uuid, uuid, jsonb);

create or replace function raise_issue(
  p_project uuid, p_title text, p_kind text default 'irs',
  p_description text default null, p_person uuid default null,
  p_task_uid text default null, p_offset integer default 0,
  p_anchor text default 'finish', p_priority integer default 50,
  p_rfi_question text default null, p_origin_comment uuid default null,
  p_meeting uuid default null, p_agenda_item uuid default null,
  p_visibility jsonb default null,
  p_category text default null,
  p_origin_entity text default null, p_origin_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ref text; v_prefix text; v_id uuid;
begin
  if not can_see_project(p_project) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if btrim(coalesce(p_title,'')) = '' then
    raise exception 'An issue needs a title' using errcode = '22023';
  end if;
  if p_kind = 'rfi' and btrim(coalesce(p_rfi_question,'')) = '' then
    raise exception 'An RFI needs a question' using errcode = '22023';
  end if;

  -- The sequence is keyed on the PREFIX, not the kind.
  v_prefix := case p_kind when 'rfi' then 'RFI' else 'TSK' end;
  v_ref := next_reference(p_project, 'issue_' || v_prefix, v_prefix);

  insert into issues (
    project_id, reference, title, description, person_id,
    programme_task_uid, offset_days, anchor, priority, source_kind,
    rfi_question, rfi_status, origin_comment_id, raised_meeting_id,
    raised_agenda_item_id, visibility, raised_by,
    category, origin_entity, origin_id)
  values (
    p_project, v_ref, btrim(p_title), nullif(btrim(coalesce(p_description,'')),''), p_person,
    nullif(btrim(coalesce(p_task_uid,'')),''), coalesce(p_offset,0),
    coalesce(p_anchor,'finish'), coalesce(p_priority,50), p_kind,
    nullif(btrim(coalesce(p_rfi_question,'')),''),
    case when p_kind = 'rfi' then 'Open' end,
    p_origin_comment, p_meeting, p_agenda_item,
    coalesce(p_visibility, '{"mode":"project"}'::jsonb), auth.uid(),
    -- Derived where the caller named an origin and did not name a category,
    -- so a page cannot raise a task from a register and forget to say which.
    coalesce(nullif(btrim(coalesce(p_category,'')),''),
             discussion_category(p_origin_entity)),
    p_origin_entity, p_origin_id)
  returning id into v_id;

  if p_meeting is not null then
    insert into issue_agenda_refs (issue_id, meeting_id, agenda_item_id)
    values (v_id, p_meeting, p_agenda_item)
    on conflict do nothing;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'reference', v_ref);
end;
$$;

grant execute on function raise_issue(
  uuid, text, text, text, uuid, text, integer, text, integer, text, uuid,
  uuid, uuid, jsonb, text, text, uuid) to authenticated;

-- ----------------------------------------------------- say it and raise it
/**
 * Post a remark and raise the task it becomes, in one statement.
 *
 * Separate calls leave the state nobody notices: the comment posted, the task
 * refused, and the remark sitting there looking handled. Both happen or
 * neither does.
 *
 * The task carries the comment (`origin_comment_id`), the record the comment
 * was on (`origin_entity`/`origin_id`) and the category derived from it -- so
 * from the task you can reach the conversation, and from the task list you can
 * ask for everything that came out of building control.
 */
create or replace function discuss_and_raise(
  p_project uuid, p_entity_type text, p_entity_id uuid, p_body text,
  p_title text, p_kind text default 'comment', p_person uuid default null,
  p_task_uid text default null, p_offset integer default 0,
  p_anchor text default 'finish', p_priority integer default 50,
  p_rfi_question text default null, p_visibility jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_comment uuid; v_out jsonb;
begin
  if not can_see_project(p_project) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if btrim(coalesce(p_body,'')) = '' then
    raise exception 'A discussion post needs something in it' using errcode = '22023';
  end if;

  insert into comments (project_id, entity_type, entity_id, author_id, body)
  values (p_project, p_entity_type, p_entity_id, auth.uid(), btrim(p_body))
  returning id into v_comment;

  v_out := raise_issue(
    p_project := p_project, p_title := p_title, p_kind := p_kind,
    -- The remark is the description. Retyping it into the task would give the
    -- two different words for the same thing within a minute of each other.
    p_description := btrim(p_body),
    p_person := p_person, p_task_uid := p_task_uid, p_offset := p_offset,
    p_anchor := p_anchor, p_priority := p_priority,
    p_rfi_question := p_rfi_question, p_origin_comment := v_comment,
    p_visibility := p_visibility,
    p_origin_entity := p_entity_type, p_origin_id := p_entity_id);

  return v_out || jsonb_build_object('comment_id', v_comment);
end;
$$;

grant execute on function discuss_and_raise(
  uuid, text, uuid, text, text, text, uuid, text, integer, text, integer,
  text, jsonb) to authenticated;

-- --------------------------------------------------------------- the filter
/**
 * The categories actually present on this project, for the task list's filter.
 *
 * Read off the rows rather than from a fixed list: a filter offering a category
 * with nothing behind it is a filter that returns an empty page, and one
 * missing a category that exists hides work.
 */
create or replace function issue_categories(p_project uuid)
returns table (category text, open_items int, total int)
language sql stable security invoker set search_path = public as $$
  select i.category,
         count(*) filter (where i.status = 'Open')::int,
         count(*)::int
  from v_issues i
  where i.project_id = p_project and i.category is not null
  group by i.category
  order by 2 desc, 1;
$$;

grant execute on function issue_categories(uuid) to authenticated;
