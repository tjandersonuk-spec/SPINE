-- Phase 6, part four -- one issues store.
--
-- A task, an RFI, an action raised from a comment and an item raised in a
-- meeting are the same record with a different origin. An earlier draft hung
-- action columns off `comments`, which works right up until someone types an
-- issue directly and there is no comment to hang it on. So the issue is its own
-- row and the comment points at it, not the other way round.

create table issues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,
  title text not null check (btrim(title) <> ''),
  description text,
  category text,
  -- Who is carrying it. A person, not a company: an action needs a name, and
  -- which firm they are at is a live lookup through the directory.
  person_id uuid references project_people(id) on delete set null,
  -- The four anchor columns. Their branch in programme_dependents() is added
  -- below, in this same migration, as the rule requires.
  programme_task_uid text,
  offset_days int not null default 0,
  anchor text not null default 'finish' check (anchor in ('start','finish')),
  due_date_override date,
  priority int not null default 50 check (priority between 0 and 100),
  status text not null default 'Open' check (status in ('Open','Closed')),
  -- Where it came from. One store, one column telling them apart -- never a
  -- parallel table per kind.
  source_kind text not null default 'irs'
    check (source_kind in ('irs','comment','rfi','meeting')),
  origin_entity text,
  origin_id uuid,
  origin_comment_id uuid references comments(id) on delete set null,
  -- RFI fields, null on everything that is not one.
  rfi_question text,
  rfi_response text,
  rfi_status text check (rfi_status in ('Open','Answered','Closed')),
  rfi_responded_by uuid references profiles(id) on delete set null,
  rfi_responded_at timestamptz,
  -- Where it was FIRST raised. Never updated when the item is carried forward
  -- to another agenda -- see issue_agenda_refs.
  raised_meeting_id uuid references meetings(id) on delete set null,
  raised_agenda_item_id uuid references meeting_agenda_items(id) on delete set null,
  visibility jsonb not null default '{"mode":"project"}'::jsonb
    check (visibility_is_valid(visibility)),
  raised_by uuid references profiles(id) on delete set null,
  raised_at timestamptz not null default now(),
  closed_by uuid references profiles(id) on delete set null,
  closed_at timestamptz,
  unique (project_id, reference),
  constraint issue_closed_is_whole
    check ((status = 'Closed') = (closed_at is not null)),
  constraint rfi_has_a_question
    check (source_kind <> 'rfi' or btrim(coalesce(rfi_question,'')) <> '')
);
create index on issues (project_id, status);
create index on issues (project_id, programme_task_uid);

-- An item is RAISED once and may APPEAR on many agendas.
--
-- An early version moved the item to the new meeting when it was carried
-- forward, which left the previous minutes empty. Minutes are a record of what
-- was discussed on the day: carrying an item forward INSERTS here and never
-- touches raised_meeting_id or removes the earlier row.
create table issue_agenda_refs (
  issue_id uuid not null references issues(id) on delete cascade,
  meeting_id uuid not null references meetings(id) on delete cascade,
  agenda_item_id uuid references meeting_agenda_items(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (issue_id, meeting_id)
);

-- Carrying an item forward. A function rather than a bare insert, so the rule
-- above is enforced rather than remembered.
create or replace function carry_issue_forward(
  p_issue uuid, p_meeting uuid, p_agenda_item uuid default null
) returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_project uuid;
begin
  select project_id into v_project from issues where id = p_issue;
  if v_project is null then
    raise exception 'No such issue' using errcode = 'P0002';
  end if;
  if not can_write_project_setup(v_project) then
    raise exception 'Only the contractor''s team may carry an item forward'
      using errcode = '42501';
  end if;
  if not exists (select 1 from meetings where id = p_meeting and project_id = v_project) then
    raise exception 'That meeting is not on this project' using errcode = 'P0002';
  end if;

  insert into issue_agenda_refs (issue_id, meeting_id, agenda_item_id)
  values (p_issue, p_meeting, p_agenda_item)
  on conflict (issue_id, meeting_id) do update set agenda_item_id = excluded.agenda_item_id;
end;
$$;

revoke all on function carry_issue_forward(uuid, uuid, uuid) from public;
grant execute on function carry_issue_forward(uuid, uuid, uuid) to authenticated;

-- References are generated, never typed. TSK for a task, RFI for a question --
-- the prefix is the one place the kind shows in the reference.
create or replace function raise_issue(
  p_project uuid, p_title text, p_kind text default 'irs',
  p_description text default null, p_person uuid default null,
  p_task_uid text default null, p_offset int default 0, p_anchor text default 'finish',
  p_priority int default 50, p_rfi_question text default null,
  p_origin_comment uuid default null, p_meeting uuid default null,
  p_agenda_item uuid default null, p_visibility jsonb default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
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

  -- The sequence is keyed on the PREFIX, not the kind. Three kinds share the
  -- TSK prefix (typed, comment-raised and meeting-raised), so keying it on the
  -- kind gives each its own counter and they collide at TSK-001.
  v_prefix := case p_kind when 'rfi' then 'RFI' else 'TSK' end;
  v_ref := next_reference(p_project, 'issue_' || v_prefix, v_prefix);

  insert into issues (
    project_id, reference, title, description, person_id,
    programme_task_uid, offset_days, anchor, priority, source_kind,
    rfi_question, rfi_status, origin_comment_id, raised_meeting_id,
    raised_agenda_item_id, visibility, raised_by)
  values (
    p_project, v_ref, btrim(p_title), nullif(btrim(coalesce(p_description,'')),''), p_person,
    nullif(btrim(coalesce(p_task_uid,'')),''), coalesce(p_offset,0),
    coalesce(p_anchor,'finish'), coalesce(p_priority,50), p_kind,
    nullif(btrim(coalesce(p_rfi_question,'')),''),
    case when p_kind = 'rfi' then 'Open' end,
    p_origin_comment, p_meeting, p_agenda_item,
    coalesce(p_visibility, '{"mode":"project"}'::jsonb), auth.uid())
  returning id into v_id;

  -- An item raised in a meeting appears on that meeting's agenda from the
  -- start; carrying it forward later adds a second row rather than moving this
  -- one.
  if p_meeting is not null then
    insert into issue_agenda_refs (issue_id, meeting_id, agenda_item_id)
    values (v_id, p_meeting, p_agenda_item)
    on conflict do nothing;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'reference', v_ref);
end;
$$;

revoke all on function raise_issue(uuid, text, text, text, uuid, text, int, text, int, text,
                                   uuid, uuid, uuid, jsonb) from public;
grant execute on function raise_issue(uuid, text, text, text, uuid, text, int, text, int, text,
                                      uuid, uuid, uuid, jsonb) to authenticated;
