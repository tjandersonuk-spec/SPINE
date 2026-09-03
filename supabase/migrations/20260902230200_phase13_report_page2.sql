-- Phase 13, part three -- page two: what needs attention.
--
-- The live dashboard's decision_queue() is keyed on auth.uid() and answers
-- "what is waiting on ME". A report is read by somebody who may not be whoever
-- generated it, so this answers "what is waiting on THIS AUDIENCE" -- and it is
-- a SEPARATE FUNCTION rather than the personal one with the uid filter bypassed.
--
-- Two reasons, and the second is the one that matters. They answer different
-- questions. And a report addressed to a client that referenced whoever
-- happened to generate it would leak whose account produced it -- nobody reads
-- "waiting on you" in a document somebody else ran.
create or replace function report_attention(
  p_project uuid, p_audience text, p_company uuid default null
) returns table (
  kind text, reference text, title text, due date, tone text
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare v_co uuid;
begin
  v_co := report_scope(p_project, p_audience, p_company);

  if p_audience = 'internal' then
    -- Every open decision on the project.
    return query
    select 'Change request awaiting decision'::text, cr.reference, cr.title, cr.decision_due,
           case when cr.decision_due < current_date then 'stop' else 'warn' end
    from v_change_requests cr
    where cr.project_id = p_project and cr.status in ('Submitted','Under review');

    -- A higher-risk-building change nobody has classified. The one thing on
    -- this page that stops work rather than merely being late.
    return query
    select 'Change awaiting classification', cr.reference, cr.title, null::date, 'stop'
    from v_change_requests cr
    where cr.project_id = p_project and cr.bsa_controlled and cr.bsa_class is null
      and cr.status not in ('Rejected','Withdrawn','Closed');

    return query
    select 'Instalment awaiting agreement', s.reference,
           coalesce(s.company_name || ' — ', '') || coalesce(s.description, ''), s.due, 'warn'
    from v_payment_schedule s
    where s.project_id = p_project and s.status = 'Proposed';

    return query
    select 'Invoice awaiting certification', v.reference,
           coalesce(v.company_name, ''), null::date, 'warn'
    from v_invoices v
    where v.project_id = p_project and v.status = 'Submitted';

    return query
    select 'RFI outstanding', i.reference, i.title, i.due,
           case when i.overdue then 'stop' else 'neutral' end
    from v_issues i
    where i.project_id = p_project and i.source_kind = 'rfi'
      and i.rfi_status = 'Open' and i.status = 'Open';
  end if;

  if p_audience = 'client' then
    -- Only what is waiting on the client's own company. A client report that
    -- listed every open decision on the project would be a list of other
    -- people's homework.
    return query
    select 'Awaiting your decision', cr.reference, cr.title, cr.decision_due, 'warn'
    from v_change_requests cr
    join companies c on c.id = cr.to_company_id
    where cr.project_id = p_project and cr.status in ('Submitted','Under review')
      and c.company_type = 'client';
  end if;

  if p_audience = 'consultant' and v_co is not null then
    return query
    select 'RFI to answer', i.reference, i.title, i.due,
           case when i.overdue then 'stop' else 'warn' end
    from v_issues i
    join project_people pp on pp.id = i.person_id
    where i.project_id = p_project and i.source_kind = 'rfi'
      and i.rfi_status = 'Open' and i.status = 'Open'
      and pp.company_id in (select company_id from company_tree(p_project, v_co));

    return query
    select 'Change request awaiting our decision', cr.reference, cr.title, cr.decision_due, 'warn'
    from v_change_requests cr
    where cr.project_id = p_project and cr.status in ('Submitted','Under review')
      and cr.to_company_id in (select company_id from company_tree(p_project, v_co));

    return query
    select 'Instalment awaiting agreement', s.reference, coalesce(s.description, ''),
           s.due, 'warn'
    from v_payment_schedule s
    where s.project_id = p_project and s.status = 'Proposed'
      and s.company_id in (select company_id from company_tree(p_project, v_co));
  end if;
end;
$$;

grant execute on function report_attention(uuid, text, uuid) to authenticated;

-- ------------------------------------------------------------- gone quiet
--
-- Audience-gated INDEPENDENTLY of everything else, and withheld from the client
-- entirely. Flagging that something has stalled is a tone judgement for a
-- person to make in conversation, not a fact for an automated document to
-- assert about somebody's firm.
--
-- Internal sees everything; a consultant sees only their own items, so it reads
-- as self-accountability rather than as a callout of somebody else.
create or replace function report_gone_quiet(
  p_project uuid, p_audience text, p_company uuid default null, p_weeks int default 3
) returns table (
  reference text, title text, raised_at timestamptz, last_touched timestamptz, days_quiet int
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare v_co uuid;
begin
  v_co := report_scope(p_project, p_audience, p_company);
  if p_audience = 'client' then
    return;   -- withheld, and the exclusions line on the document says so
  end if;

  return query
  select q.* from gone_quiet(p_project, p_weeks) q
  where v_co is null
     or exists (
       select 1 from issues i
       join project_people pp on pp.id = i.person_id
       where i.project_id = p_project and i.reference = q.reference
         and pp.company_id in (select company_id from company_tree(p_project, v_co)));
end;
$$;

grant execute on function report_gone_quiet(uuid, text, uuid, int) to authenticated;

-- ------------------------------------------------------- consultant health
--
-- Internal only, matching the live dashboard exactly. It names firms and ranks
-- them; a consultant reading their own position against a rival's is not what
-- it is for, and a client reading it at all is worse.
create or replace function report_health(
  p_project uuid, p_audience text, p_company uuid default null
) returns table (
  company_id uuid, company_name text,
  appointment_gaps int, overdue_drawings int, open_issues int, quiet_issues int,
  concern_score int
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  -- The company is passed through rather than ignored, so a consultant asking
  -- for this gets the same refusal as anywhere else if the id is not theirs --
  -- and an empty result if it is.
  perform report_scope(p_project, p_audience, p_company);
  if p_audience <> 'internal' then
    return;
  end if;
  return query select * from consultant_health(p_project);
end;
$$;

grant execute on function report_health(uuid, text, uuid) to authenticated;

-- ----------------------------------------------------------- coming up
--
-- The one section identical for all three audiences. A date is not
-- commercially sensitive, and knowing what is coming is exactly what a report
-- like this is for.
--
-- The horizon is one more period beyond the one being reported: a weekly report
-- looks a week ahead, a monthly one a month.
create or replace function report_coming_up(
  p_project uuid, p_audience text, p_company uuid default null,
  p_kind text default 'week', p_end date default null
) returns table (
  task_uid text, description text, finish_date date, is_milestone boolean, percent_complete int
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare v_period record;
begin
  perform report_scope(p_project, p_audience, p_company);
  select * into v_period from report_period(p_kind, p_end);

  return query
  select t.task_uid, t.description, t.finish_date,
         (t.task_type = 'Milestone'), t.percent_complete
  from programme_tasks t
  where t.project_id = p_project and not t.removed
    and t.percent_complete < 100
    and t.finish_date > v_period.end_date
    and t.finish_date <= v_period.end_date
        + case when v_period.kind = 'month' then 31 else 7 end
  order by t.finish_date, t.task_uid;
end;
$$;

grant execute on function report_coming_up(uuid, text, uuid, text, date) to authenticated;
