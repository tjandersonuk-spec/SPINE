-- Phase 10, part three -- the guard and the derived work status.

-- Who may classify a change under the Building Safety Act.
--
-- The Principal Designer (BSA) discipline, or an account admin. NOT the
-- contractor's internal staff: it is a named statutory duty, not a seniority,
-- and someone senior who does not hold the duty is exactly the person this
-- should refuse.
create or replace function can_classify(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from projects p
    where p.id = p_project
      and (is_account_admin(p.organisation_id)
           or exists (
             select 1
             from companies c
             join company_disciplines cd on cd.company_id = c.id
             where c.project_id = p_project
               and cd.discipline_code = 'PDB'
               and c.id = my_company_on_project(p_project))));
$$;

grant execute on function can_classify(uuid) to authenticated;

-- Classifying a change.
--
-- The app never suggests a category. This function takes one, records who
-- decided and when, and refuses without a written basis -- a classification
-- with no reasoning is the thing somebody has to defend at an inquiry.
create or replace function classify_change(
  p_change uuid, p_class text, p_note text
) returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_project uuid; v_hrb boolean;
begin
  select cr.project_id, p.hrb into v_project, v_hrb
  from change_requests cr join projects p on p.id = cr.project_id
  where cr.id = p_change;

  if v_project is null then
    raise exception 'No such change request' using errcode = 'P0002';
  end if;
  if not v_hrb then
    raise exception 'This project is not a higher-risk building' using errcode = '22023';
  end if;
  -- Enforced here, not by hiding a button: a synthetic event from the wrong
  -- role must be refused server-side.
  if not can_classify(v_project) then
    raise exception
      'Only the Principal Designer (BSA) or an account admin may classify a change'
      using errcode = '42501';
  end if;
  if p_class is not null and p_class not in ('Recordable','Notifiable','Major') then
    raise exception 'Not a Building Safety Act class' using errcode = '22023';
  end if;
  if p_class is not null and btrim(coalesce(p_note,'')) = '' then
    raise exception 'A classification needs its written basis' using errcode = '22023';
  end if;

  update change_requests set
    bsa_controlled = (p_class is not null),
    bsa_class = p_class,
    bsa_class_by = case when p_class is null then null else auth.uid() end,
    bsa_class_at = case when p_class is null then null else now() end,
    bsa_class_note = case when p_class is null then null else btrim(p_note) end
  where id = p_change;
end;
$$;

revoke all on function classify_change(uuid, text, text) from public;
grant execute on function classify_change(uuid, text, text) to authenticated;

-- May work proceed?
--
-- A view, never a column. Storing it would let it say yes after somebody edits
-- a date -- which is precisely the failure the whole regime exists to prevent.
-- Every state below is derived from the class plus what has actually been done.
create or replace function work_status(p_change uuid)
returns table (state text, verdict text, detail text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with c as (
    select cr.*, p.hrb, p.hrb_notify_days, p.hrb_major_weeks
    from change_requests cr join projects p on p.id = cr.project_id
    where cr.id = p_change
  ),
  -- The state is decided once, in order. Everything else is looked up from it,
  -- so the verdict and the wording cannot disagree with the state or with each
  -- other.
  s as (
    select c.*, case
      when not c.hrb                              then 'not_hrb'
      when not c.bsa_controlled                   then 'not_controlled'
      when c.bsa_class is null                    then 'unclassified'
      when c.bsa_class = 'Recordable'             then 'recordable'
      when c.bsa_objected                         then 'objected'
      when c.bsa_class = 'Notifiable' and c.bsa_notified_at is null
                                                  then 'notifiable_unnotified'
      when c.bsa_class = 'Notifiable'
           and current_date < c.bsa_notified_at + c.hrb_notify_days
                                                  then 'notifiable_in_window'
      when c.bsa_class = 'Notifiable'             then 'notifiable_clear'
      when c.bsa_class = 'Major' and c.bsa_app_submitted is null
                                                  then 'major_unsubmitted'
      when c.bsa_class = 'Major' and c.bsa_app_decided is null
                                                  then 'major_awaiting'
      when c.bsa_class = 'Major' and c.bsa_app_outcome = 'Rejected'
                                                  then 'major_rejected'
      when c.bsa_class = 'Major' and c.bsa_app_outcome = 'Approved'
                                                  then 'major_approved'
      -- Marked decided with no outcome recorded. Nobody designed this state; it
      -- stops rather than guessing which way it went.
      else 'major_undetermined'
    end as state
    from c
  )
  select
    s.state,
    -- Only four states let work carry on, and one of them is "this is not a
    -- higher-risk building at all".
    case s.state
      when 'not_hrb' then 'proceed'
      when 'not_controlled' then 'proceed'
      when 'recordable' then 'proceed'
      when 'notifiable_clear' then 'proceed'
      when 'major_approved' then 'proceed'
      when 'notifiable_in_window' then 'warn'
      else 'stop'
    end,
    case s.state
      when 'not_hrb' then 'This project is not a higher-risk building.'
      when 'not_controlled' then 'Not a change control under the Building Safety Act.'
      when 'unclassified'
        then 'Controlled, but not yet classified by the Principal Designer (BSA).'
      when 'recordable' then 'Recordable. Keep the record; no notification is required.'
      when 'objected' then 'The regulator has objected.'
      when 'notifiable_unnotified' then 'Notifiable, and not yet notified.'
      when 'notifiable_in_window' then
        format('Notified on %s. The objection window closes on %s.',
               s.bsa_notified_at, s.bsa_notified_at + s.hrb_notify_days)
      when 'notifiable_clear' then
        format('Notified on %s; the objection window closed on %s.',
               s.bsa_notified_at, s.bsa_notified_at + s.hrb_notify_days)
      when 'major_unsubmitted' then 'Major. No application has been submitted.'
      when 'major_awaiting' then
        format('Application submitted on %s. Determination expected by %s.',
               s.bsa_app_submitted, s.bsa_app_submitted + (s.hrb_major_weeks * 7))
      when 'major_rejected' then 'The application was refused.'
      when 'major_approved' then format('Approved on %s.', s.bsa_app_decided)
      else 'The application is marked decided but the outcome was not recorded.'
    end
  from s;
$$;

grant execute on function work_status(uuid) to authenticated;

-- Change requests as anyone reads them.
--
-- The regulatory state OUTRANKS the commercial one when bsa_controlled is true:
-- a commercially approved change awaiting a major determination reads as work
-- must stop, because that is what it means.
create or replace view v_change_requests as
select
  cr.*,
  due_date(cr.project_id, cr.decision_task_uid, cr.decision_offset_days,
           cr.decision_anchor, cr.decision_date_override) as decision_due,
  due_date(cr.project_id, cr.effective_task_uid, cr.effective_offset_days,
           cr.effective_anchor, cr.effective_date_override) as effective_date,
  w.state as bsa_state,
  w.verdict as bsa_verdict,
  w.detail as bsa_detail,
  -- What the register shows. The regulator's answer wins whenever there is one.
  case when cr.bsa_controlled and w.verdict <> 'proceed' then 'Work must stop'
       else cr.status end as headline_status,
  -- An approval that named nothing to amend is almost always somebody
  -- forgetting to list the consequences.
  (cr.status = 'Approved'
   and not exists (select 1 from change_request_items i
                   where i.change_request_id = cr.id)) as approved_with_nothing_listed,
  (select count(*)::int from change_request_items i
   where i.change_request_id = cr.id) as amendments,
  (select count(*)::int from change_request_items i
   where i.change_request_id = cr.id and i.done_at is null) as amendments_outstanding
from change_requests cr
cross join lateral work_status(cr.id) w;

-- ------------------------------------------------------------ golden thread
-- Two reports, and they are the only two that matter.

-- Designated rows whose revision has moved since the Gateway 2 baseline.
create or replace function golden_thread_moved(p_project uuid)
returns table (
  drawing_id uuid, document_number text, title text,
  g2_revision text, revision_now text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select r.id, r.document_number, r.title, r.g2_revision, r.revision
  from drawing_register r
  where r.project_id = p_project
    and r.golden_thread
    and r.g2_revision is not null
    and r.revision is distinct from r.g2_revision
  order by r.document_number;
$$;

-- Designated rows that were never issued at all. The quieter of the two, and
-- usually the more serious: a drawing nobody produced does not appear on a list
-- of things that changed.
create or replace function golden_thread_never_issued(p_project uuid)
returns table (drawing_id uuid, document_number text, title text, due date)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select r.id, r.document_number, r.title,
         due_date(r.project_id, r.programme_task_uid, r.offset_days, r.anchor,
                  r.due_date_override)
  from drawing_register r
  where r.project_id = p_project and r.golden_thread and r.revision is null
  order by r.document_number;
$$;

-- Stamp the baseline. Once, at Gateway 2 approval -- the whole point is that it
-- does not move afterwards, so this refuses to overwrite one that exists.
create or replace function stamp_g2_baseline(p_project uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_org uuid; v_n int;
begin
  select organisation_id into v_org from projects where id = p_project;
  if v_org is null then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if not is_account_admin(v_org) then
    raise exception 'Only an account admin may stamp the Gateway 2 baseline'
      using errcode = '42501';
  end if;

  update drawing_register
  set g2_revision = revision
  where project_id = p_project
    and golden_thread
    and g2_revision is null      -- never overwrite an existing baseline
    and revision is not null;
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'baselined', v_n);
end;
$$;

revoke all on function stamp_g2_baseline(uuid) from public;
grant execute on function stamp_g2_baseline(uuid) to authenticated;
grant execute on function golden_thread_moved(uuid) to authenticated;
grant execute on function golden_thread_never_issued(uuid) to authenticated;

-- Change requests carry two anchor pairs, so the line inspector must reach
-- both. The Phase 4 guard is extended in the same commit to notice a column
-- ending in _task_uid, not only one called programme_task_uid.
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
  union all
  select 'Change (decision)', cr.id, cr.reference, cr.title,
         due_date(cr.project_id, cr.decision_task_uid, cr.decision_offset_days,
                  cr.decision_anchor, cr.decision_date_override)
  from change_requests cr
  where cr.project_id = p_project and cr.decision_task_uid = p_task_uid
    and can_see(cr.project_id, cr.visibility, cr.raised_by, null)
  union all
  select 'Change (effective)', cr.id, cr.reference, cr.title,
         due_date(cr.project_id, cr.effective_task_uid, cr.effective_offset_days,
                  cr.effective_anchor, cr.effective_date_override)
  from change_requests cr
  where cr.project_id = p_project and cr.effective_task_uid = p_task_uid
    and can_see(cr.project_id, cr.visibility, cr.raised_by, null)
  order by 1, 3;
$$;

grant execute on function programme_dependents(uuid, text) to authenticated;
