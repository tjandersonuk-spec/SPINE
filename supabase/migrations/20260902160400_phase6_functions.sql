-- Phase 6, part five -- the derivations.

-- Issues as anyone reads them. The due date resolves through due_date() like
-- every other date in the product; the notes write the calculation out inline
-- here, which would make this the second implementation and the first place the
-- two could disagree.
create or replace view v_issues as
with resolved as (
  select i.*,
         due_date(i.project_id, i.programme_task_uid, i.offset_days, i.anchor,
                  i.due_date_override) as due
  from issues i
)
select
  r.*,
  anchor_state(r.project_id, r.programme_task_uid) as anchor_state,
  (r.status = 'Open' and r.due is not null and r.due < current_date) as overdue,
  -- Urgency is priority plus time pressure, capped at 100, and stated plainly
  -- so that a ranked list is arguable rather than mysterious. It is shown in
  -- the UI as the sum it is: a ranking people cannot audit is one they stop
  -- trusting the first time they disagree with the order.
  case when r.status = 'Closed' then 0
       else least(100, r.priority + case
         when r.due is null then 0
         when r.due < current_date then 30
         when r.due < current_date + 7 then 15
         when r.due < current_date + 21 then 7
         else 0 end)
  end as urgency
from resolved r;

-- Evidence state, derived and never stored. A drawing revised after review
-- reopens that review with no write to anything -- which is the whole reason the
-- revision is recorded at both moments rather than a status being set.
create or replace view v_evidence as
select
  e.*,
  r.document_number,
  r.revision as revision_now,
  case
    when e.reviewed_at is null then 'Awaiting review'
    when e.drawing_id is null then 'Reviewed'
    when r.revision is distinct from e.revision_at_review then 'Revised since review'
    else 'Reviewed'
  end as state
from evidence e
left join drawing_register r on r.id = e.drawing_id;

-- Comments with their attachments resolved to live register rows, so a drawing
-- referenced in a discussion shows the revision it is at now rather than the
-- one it was at when somebody typed its name.
create or replace view v_comment_attachments as
select
  a.*,
  r.document_number,
  r.revision as revision_now,
  r.cde_url
from comment_attachments a
left join drawing_register r on r.id = a.drawing_id;

-- Issues now carry the anchor columns, so the line inspector must reach them.
-- Replaces the Phase 5 version; phase4.test.ts fails the build if a table gains
-- programme_task_uid and offset_days without appearing here.
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
  order by 1, 3;
$$;

grant execute on function programme_dependents(uuid, text) to authenticated;

-- Answering an RFI. Separate from a general update because the response, who
-- gave it and when are one act, and a partial one is not an answer.
create or replace function answer_rfi(p_issue uuid, p_response text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_project uuid;
begin
  select project_id into v_project from issues
  where id = p_issue and source_kind = 'rfi';
  if v_project is null then
    raise exception 'No such RFI' using errcode = 'P0002';
  end if;
  if not can_see_project(v_project) then
    raise exception 'No such RFI' using errcode = 'P0002';
  end if;
  if btrim(coalesce(p_response,'')) = '' then
    raise exception 'An answer cannot be empty' using errcode = '22023';
  end if;

  update issues set
    rfi_response = btrim(p_response),
    rfi_status = 'Answered',
    rfi_responded_by = auth.uid(),
    rfi_responded_at = now()
  where id = p_issue;
end;
$$;

revoke all on function answer_rfi(uuid, text) from public;
grant execute on function answer_rfi(uuid, text) to authenticated;

-- Closing an issue. Status and the closing record move together or not at all.
create or replace function close_issue(p_issue uuid, p_open boolean default false)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_project uuid;
begin
  select project_id into v_project from issues where id = p_issue;
  if v_project is null or not can_see_project(v_project) then
    raise exception 'No such issue' using errcode = 'P0002';
  end if;
  if p_open then
    update issues set status = 'Open', closed_by = null, closed_at = null where id = p_issue;
  else
    update issues set status = 'Closed', closed_by = auth.uid(), closed_at = now()
    where id = p_issue;
  end if;
end;
$$;

revoke all on function close_issue(uuid, boolean) from public;
grant execute on function close_issue(uuid, boolean) to authenticated;

-- Marking evidence reviewed. The revision at review is stamped by trigger from
-- the register, never passed in -- the reviewer states that they reviewed it;
-- which revision that was is a fact, not their opinion.
create or replace function review_evidence(p_evidence uuid, p_reviewed boolean default true)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_project uuid;
begin
  select project_id into v_project from evidence where id = p_evidence;
  if v_project is null or not can_write_project_setup(v_project) then
    raise exception 'Only the contractor''s team may review evidence' using errcode = '42501';
  end if;
  if p_reviewed then
    update evidence set reviewed_by = auth.uid(), reviewed_at = now() where id = p_evidence;
  else
    update evidence set reviewed_by = null, reviewed_at = null where id = p_evidence;
  end if;
end;
$$;

revoke all on function review_evidence(uuid, boolean) from public;
grant execute on function review_evidence(uuid, boolean) to authenticated;
