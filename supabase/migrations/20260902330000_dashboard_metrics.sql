-- The dashboard stops computing its own figures.
--
-- The prototype's dashboard leads with a strip of headline numbers and the
-- product's did not have one at all -- but the fix is not to write a second
-- function that counts overdue drawings. `report_metrics()` already answers
-- "where is this project", audience by audience, and two functions producing
-- the same number is how a dashboard and a report end up disagreeing in front
-- of somebody who has both open. This is the portfolio rule applied one level
-- down: the only new code is which audience to ask for.
--
-- Which audience is not a choice the client makes either. Account staff get
-- the internal figures, the `client` role gets the client ones, and everybody
-- else gets their own company's -- resolved here, so the page cannot ask for
-- an audience it should not have and `report_scope()` cannot be reached with a
-- company somebody guessed.
create or replace function dashboard_metrics(p_project uuid)
returns table (sort_order int, value text, label text, alert boolean, tail text)
language plpgsql stable set search_path = public as $$
declare v_audience text; v_company uuid;
begin
  if not can_see_project(p_project) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  -- my_report_audiences() is already the statement of who may see what. Read
  -- in the order it returns them, the first is the widest this person holds.
  v_audience := (my_report_audiences(p_project))[1];
  if v_audience is null then
    return;
  end if;

  if v_audience = 'consultant' then
    v_company := my_company_on_project(p_project);
    -- A person on the project who is at no company on it -- an account member
    -- with a project_members row and no directory entry. There is no company
    -- front to show them, and report_metrics would refuse.
    if v_company is null then
      return;
    end if;
  end if;

  return query select * from report_metrics(p_project, v_audience, v_company);
end;
$$;

grant execute on function dashboard_metrics(uuid) to authenticated;

-- ------------------------------------------------------- the missing three
-- The prototype's internal strip carries planning, building control and the
-- checklists; ours stopped at fees. The compliance table on sheet one breaks
-- the same figures down by type, but a breakdown is not a headline, and the
-- three are what somebody scanning a dashboard is looking for.
--
-- Everything else in this function is unchanged. It is restated in full
-- because that is what `create or replace` requires, not because it moved.
create or replace function report_metrics(
  p_project uuid, p_audience text, p_company uuid default null)
returns table (sort_order int, value text, label text, alert boolean, tail text)
language plpgsql stable set search_path = public as $$
declare v_co uuid;
begin
  v_co := report_scope(p_project, p_audience, p_company);

  return query
  select 1, (t.tl->>'percent_elapsed') || '%', 'Through the programme'::text, false, null::text
  from (select programme_timeline(p_project) as tl) t
  where t.tl->>'percent_elapsed' is not null;

  return query
  with r as (
    select * from v_drawing_register d
    where d.project_id = p_project
      and (v_co is null or d.company_id in (select company_id from company_tree(p_project, v_co)))
  )
  select 2,
         (count(*) filter (where not awaited))::text || '/' || count(*)::text,
         'Documents issued of anticipated', count(*) filter (where overdue) > 0,
         nullif(count(*) filter (where overdue)::text || ' overdue', '0 overdue')
  from r having count(*) > 0;

  -- ------------------------------------------------------------- internal
  if p_audience = 'internal' then
    return query
    select 3, count(*)::text, 'Responsibility matrix gaps — falling to the contractor',
           true, null::text
    from drm_items d
    where d.project_id = p_project and d.applicable
      and (d.lead_discipline is null
           or not exists (select 1 from company_disciplines cd
                          join companies c on c.id = cd.company_id
                           and c.project_id = p_project
                          where cd.discipline_code = d.lead_discipline))
    having count(*) > 0;

    return query
    select 4, count(*)::text, 'Open tasks and RFIs',
           count(*) filter (where i.overdue) > 0,
           nullif(count(*) filter (where i.overdue)::text || ' overdue', '0 overdue')
    from v_issues i where i.project_id = p_project and i.status = 'Open';

    return query
    select 5, count(*) filter (where cr.status not in ('Closed','Rejected','Withdrawn',
                                                        'Implemented'))::text,
           'Change requests open',
           count(*) filter (where cr.bsa_controlled and cr.bsa_verdict = 'stop') > 0
             or count(*) filter (where cr.status = 'Approved'
                                   and cr.amendments_outstanding > 0) > 0,
           coalesce(
             nullif(count(*) filter (where cr.bsa_controlled and cr.bsa_verdict = 'stop')::text
                    || ' work must stop', '0 work must stop'),
             nullif(count(*) filter (where cr.status = 'Approved'
                                       and cr.amendments_outstanding > 0)::text
                    || ' not yet amended', '0 not yet amended'))
    from v_change_requests cr where cr.project_id = p_project having count(*) > 0;

    -- EXPECTED VALUE, never the gross total.
    return query
    select 6, '£' || to_char(t.expected, 'FM999,999,999'),
           'Expected risk value, ' || t.live::text || ' live',
           t.unowned > 0, nullif(t.unowned::text || ' unowned', '0 unowned')
    from risk_totals(p_project, 'risk') t where t.live > 0;

    return query
    select 7, round(b.score_achieved)::text || '%',
           'BREEAM verified — ' || coalesce(b.rating_achieved, 'unclassified'),
           false, null::text
    from breeam_totals(p_project) b where b.available > 0;

    return query
    select 8, p.done::text || '/' || p.total::text, 'Planning conditions discharged',
           p.overdue > 0, nullif(p.overdue::text || ' overdue', '0 overdue')
    from tracked_progress(p_project) p where p.kind = 'planning' and p.total > 0;

    return query
    select 9, p.done::text || '/' || p.total::text, 'Building control items closed',
           p.overdue > 0, nullif(p.overdue::text || ' overdue', '0 overdue')
    from tracked_progress(p_project) p where p.kind = 'bc' and p.total > 0;

    -- Every checklist kind at once. The breakdown is on the compliance table;
    -- this is the one number somebody scanning wants.
    return query
    select 10, sum(p.done)::text || '/' || sum(p.total)::text,
           'Checklist items complete — see the breakdown',
           sum(p.overdue) > 0, nullif(sum(p.overdue)::text || ' overdue', '0 overdue')
    from tracked_progress(p_project) p
    where p.kind like 'checklist:%' having sum(p.total) > 0;

    return query
    select 11, '£' || to_char(f.approved, 'FM999,999,999'),
           'Approved fees — £' || to_char(f.paid, 'FM999,999,999') || ' paid to date',
           false, null::text
    from (select coalesce(sum(approved_total), 0) as approved,
                 coalesce(sum(paid), 0) as paid
          from fee_position(p_project)) f
    where f.approved > 0;
  end if;

  -- --------------------------------------------------------------- client
  --
  -- No fees. No risk register. No consultant health. No change-control
  -- classification. No occurrence content. The matrix appears as a count of
  -- gaps and never as a list naming a company.
  if p_audience = 'client' then
    return query
    select 3, (p.done)::text || '/' || (p.total)::text, 'Client requirements confirmed',
           p.overdue > 0, nullif(p.overdue::text || ' overdue', '0 overdue')
    from tracked_progress(p_project) p
    where p.kind = 'checklist:client' and p.total > 0;

    return query
    select 4, sum(p.done)::text || '/' || sum(p.total)::text, 'Statutory conditions closed',
           sum(p.overdue) > 0,
           nullif(sum(p.overdue)::text || ' overdue', '0 overdue')
    from tracked_progress(p_project) p
    where p.kind in ('planning','bc') having sum(p.total) > 0;

    -- The TARGET rating, not the verified one: a client report is about where
    -- the project is heading.
    return query
    select 5, round(b.score_targeted)::text || '%',
           'BREEAM on course for ' || coalesce(b.rating_targeted, 'a rating to be confirmed'),
           false, null::text
    from breeam_totals(p_project) b where b.available > 0;

    return query
    select 6,
           case when count(*) = 0 then 'Fully allocated' else count(*)::text end,
           'Design responsibility matrix', count(*) > 0, null::text
    from drm_gaps(p_project);
  end if;

  -- ----------------------------------------------------------- consultant
  if p_audience = 'consultant' then
    return query
    select 3, case when count(*) filter (where s.state = 'missing') = 0 then 'Complete'
                   else count(*) filter (where s.state = 'missing')::text || ' missing' end,
           'Our appointment documents',
           count(*) filter (where s.state = 'missing') > 0, null::text
    from company_appointment_status(v_co) s;

    return query
    select 4, count(*)::text, 'Open tasks and RFIs against us',
           count(*) filter (where i.overdue) > 0,
           nullif(count(*) filter (where i.overdue)::text || ' overdue', '0 overdue')
    from v_issues i
    join project_people pp on pp.id = i.person_id
    where i.project_id = p_project and i.status = 'Open'
      and pp.company_id in (select company_id from company_tree(p_project, v_co));

    return query
    select 5, '£' || to_char(sum(f.approved_total), 'FM999,999,999'),
           'Our approved fee — £' || to_char(sum(f.invoiced), 'FM999,999,999') || ' invoiced',
           false, null::text
    from fee_position(p_project) f
    where f.company_id in (select company_id from company_tree(p_project, v_co))
    having sum(f.approved_total) > 0;

    -- `is_done` and `overdue` off the view rather than a status list retyped
    -- here: the view is where "done" is decided, and a second list of statuses
    -- is a second definition of it.
    return query
    select 6, count(*) filter (where t.is_done)::text || '/' || count(*)::text,
           'Our scope of service complete',
           count(*) filter (where t.overdue) > 0,
           nullif(count(*) filter (where t.overdue)::text || ' overdue', '0 overdue')
    from v_tracked_items t
    where t.project_id = p_project and t.kind = 'scope' and t.required
      and t.company_id in (select company_id from company_tree(p_project, v_co))
    having count(*) > 0;

    return query
    select 7, count(*)::text, 'Items we lead on the responsibility matrix',
           false, null::text
    from drm_items d
    join company_disciplines cd on cd.discipline_code = d.lead_discipline
    join companies c on c.id = cd.company_id and c.project_id = p_project
    where d.project_id = p_project and d.applicable
      and c.id in (select company_id from company_tree(p_project, v_co));
  end if;
end;
$$;

-- --------------------------------------------------------- appointments
/** The appointments bar, bucketed from the same per-slot function the
 *  directory reads. One aggregation over an existing derivation, which is what
 *  stops the bar and the page it links to disagreeing. */
create or replace function appointment_summary(p_project uuid)
returns table (state text, companies int)
language sql stable set search_path = public as $$
  with per_company as (
    select c.id,
           count(*) filter (where s.state = 'missing') as missing,
           count(*) as slots
    from companies c
    cross join lateral company_appointment_status(c.id) s
    where c.project_id = p_project and c.company_type <> 'client'
    group by c.id
  )
  select x.state, count(*)::int
  from (
    select case when missing = 0 then 'complete'
                when missing >= slots then 'none'
                else 'partial' end as state
    from per_company
  ) x
  group by x.state;
$$;

grant execute on function appointment_summary(uuid) to authenticated;
