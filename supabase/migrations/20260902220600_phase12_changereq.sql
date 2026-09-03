-- Phase 12, part seven -- approval is not implementation.
--
-- Phase 10 built change_requests for the Building Safety Act classification.
-- This part adds the half the commercial tier needs: the money link, and the
-- guard that keeps "approved" and "done" apart.
--
-- NO TRIGGER MAY ACT ON APPROVAL. Approving a change request must not update a
-- drawing, a scope row or anything else. The amendments are made by people.
-- An automatic edit is a second source of truth arriving with nobody reading
-- it, and it removes the review step that catches the mistake. There is
-- deliberately no such trigger anywhere in this migration.

-- The view gains the money and the two reportable errors.
--
-- Dropped rather than replaced: it selects cr.*, and part one gave
-- change_requests its variation_id, so CREATE OR REPLACE refuses to reorder
-- what it already returns. Only functions read it, and a function carries no
-- view dependency, so the drop is safe; the grants are restated below.
drop view if exists v_change_requests;
create view v_change_requests as
select
  cr.*,
  due_date(cr.project_id, cr.decision_task_uid, cr.decision_offset_days,
           cr.decision_anchor, cr.decision_date_override)      as decision_due,
  due_date(cr.project_id, cr.effective_task_uid, cr.effective_offset_days,
           cr.effective_anchor, cr.effective_date_override)    as effective_date,
  w.state    as bsa_state,
  w.verdict  as bsa_verdict,
  w.detail   as bsa_detail,
  case when cr.bsa_controlled and w.verdict <> 'proceed'
       then 'Work must stop' else cr.status end                as headline_status,
  (cr.status = 'Approved'
   and not exists (select 1 from change_request_items i
                    where i.change_request_id = cr.id))        as approved_with_nothing_listed,
  (select count(*)::int from change_request_items i
    where i.change_request_id = cr.id)                         as amendments,
  (select count(*)::int from change_request_items i
    where i.change_request_id = cr.id and i.done_at is null)   as amendments_outstanding,
  -- The money, read from the variation. This register holds no value of its
  -- own and never will: a second register carrying the same figure is how the
  -- fee report stops being believed.
  (select f.reference from fees f where f.id = cr.variation_id) as variation_reference,
  (select f.value     from fees f where f.id = cr.variation_id) as variation_value,
  (select f.status    from fees f where f.id = cr.variation_id) as variation_status,
  -- Approved, with a figure nobody has raised. Not an error -- plenty of
  -- changes cost nothing -- but the commonest way a variation goes unbilled.
  (cr.status in ('Approved','Implemented','Closed')
   and cr.variation_id is null
   and coalesce(cr.impact_cost, 'None') not in ('None', ''))    as approved_without_a_variation,
  -- A decision due after the change takes effect. REPORTED, NEVER BLOCKED:
  -- sometimes that is genuinely the situation, and refusing the save would
  -- only mean the dates get fudged into something that reads as fine.
  (due_date(cr.project_id, cr.decision_task_uid, cr.decision_offset_days,
            cr.decision_anchor, cr.decision_date_override)
   > due_date(cr.project_id, cr.effective_task_uid, cr.effective_offset_days,
              cr.effective_anchor, cr.effective_date_override)) as decision_after_effective
from change_requests cr
cross join lateral work_status(cr.id) w;

-- Ticking an amendment off.
--
-- By name and at a time, so "who said this was done" is answerable. done_by
-- and done_at are outside the update grant, which makes this the only way in.
create or replace function tick_change_item(p_item uuid, p_done boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_change uuid; v_project uuid; v_vis jsonb; v_raised uuid; v_status text;
begin
  select cr.id, cr.project_id, cr.visibility, cr.raised_by, cr.status
    into v_change, v_project, v_vis, v_raised, v_status
    from change_request_items i
    join change_requests cr on cr.id = i.change_request_id
   where i.id = p_item;
  if v_change is null or not can_see(v_project, v_vis, v_raised, null) then
    raise exception 'No such amendment' using errcode = 'P0002';
  end if;

  update change_request_items
     set done_by = case when p_done then auth.uid() else null end,
         done_at = case when p_done then now() else null end
   where id = p_item;

  -- UN-TICKING KNOCKS THE STATUS BACK. A change marked implemented on the
  -- strength of a tick that turns out to be wrong is not implemented, and
  -- leaving the status alone would make the register assert something nobody
  -- believes.
  if not p_done and v_status = 'Implemented' then
    update change_requests set status = 'Approved' where id = v_change;
  end if;
end;
$$;

grant execute on function tick_change_item(uuid, boolean) to authenticated;

-- Moving the status.
--
-- Implemented is refused while any amendment is outstanding, and refused
-- outright when nothing was ever listed -- an approved change with an empty
-- amendment list means either the list was never filled in or the change
-- alters nothing, and both need somebody to say which.
create or replace function set_change_status(p_change uuid, p_status text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_project uuid; v_vis jsonb; v_raised uuid;
  v_total int; v_outstanding int;
begin
  select project_id, visibility, raised_by into v_project, v_vis, v_raised
    from change_requests where id = p_change;
  if v_project is null or not can_see(v_project, v_vis, v_raised, null) then
    raise exception 'No such change request' using errcode = 'P0002';
  end if;
  if p_status not in ('Draft','Submitted','Under review','Approved','Rejected',
                      'Withdrawn','Implemented','Closed') then
    raise exception 'Unknown status: %', p_status using errcode = '22023';
  end if;
  -- Deciding a change is the host's or the receiving party's call, not the
  -- raiser's: a consultant marking their own request approved is the state
  -- this guard exists to refuse.
  if p_status in ('Approved','Rejected') and not can_write_project_setup(v_project) then
    raise exception 'Not permitted to decide a change request on this project'
      using errcode = '42501';
  end if;

  if p_status = 'Implemented' then
    select count(*)::int, count(*) filter (where done_at is null)::int
      into v_total, v_outstanding
      from change_request_items where change_request_id = p_change;
    if v_total = 0 then
      raise exception
        'Nothing is listed as needing amendment, so there is nothing to implement. List what this change obliges somebody to amend, or close it instead.'
        using errcode = '22023';
    end if;
    if v_outstanding > 0 then
      raise exception
        '% of % amendment(s) are still outstanding. Approval is not implementation.',
        v_outstanding, v_total using errcode = '22023';
    end if;
  end if;

  update change_requests
     set status = p_status,
         decided_by = case when p_status in ('Approved','Rejected')
                           then auth.uid() else decided_by end,
         decided_at = case when p_status in ('Approved','Rejected')
                           then now() else decided_at end,
         closed_at = case when p_status in ('Closed','Withdrawn','Rejected')
                          then current_date else null end
   where id = p_change;
end;
$$;

grant execute on function set_change_status(uuid, text) to authenticated;

-- What an approved change is still waiting on, across the project. The state
-- this register exists to make visible, in one query rather than by opening
-- each request in turn.
create or replace function change_implementation_gap(p_project uuid)
returns table (
  change_id uuid,
  reference text,
  title text,
  status text,
  amendments int,
  outstanding int,
  nothing_listed boolean,
  oldest_outstanding timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    v.id, v.reference, v.title, v.status, v.amendments, v.amendments_outstanding,
    v.approved_with_nothing_listed,
    (select min(i.created_at) from change_request_items i
      where i.change_request_id = v.id and i.done_at is null)
  from v_change_requests v
  where v.project_id = p_project
    and v.status = 'Approved'
    and (v.amendments_outstanding > 0 or v.approved_with_nothing_listed)
  order by v.reference;
$$;

grant execute on function change_implementation_gap(uuid) to authenticated;

alter view v_change_requests set (security_invoker = on);
grant select on v_change_requests to authenticated;
