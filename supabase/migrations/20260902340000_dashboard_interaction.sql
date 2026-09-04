-- A figure is a question, and this is where it gets answered.
--
-- Two changes, and the first is not cosmetic.
--
-- ONE: no presentation characters in SQL. `report_metrics()` was building
-- labels with em dashes and values with a pound sign, and those arrive in the
-- database already corrupted -- PowerShell's Get-Content reads a UTF-8 file
-- with no BOM as ANSI, so a migration pasted into the SQL editor stores
-- "Approved fees a-euro-quot" and a dashboard prints it. The transport is
-- fixable (scripts/copy-sql.ps1 forces UTF-8) but the deeper point is that a
-- currency symbol is a rendering decision and has no business in a query.
-- Values are now plain numbers, `unit` says how to render one, and the client
-- formats it -- which also means a tenant in another currency is a client
-- change rather than a migration.
--
-- TWO: every figure carries a `detail_key`, and `metric_items()` returns the
-- rows it counted. A number nobody can open is a number somebody has to go and
-- reconstruct by hand, which is what the pages under it were already for.
-- The list and the count come from the same predicates, and a test asserts
-- they agree -- two queries counting the same thing is exactly what the rest
-- of this product refuses to do.

drop function if exists dashboard_metrics(uuid);
drop function if exists report_metrics(uuid, text, uuid);

create or replace function report_metrics(
  p_project uuid, p_audience text, p_company uuid default null)
returns table (
  sort_order int, value text, label text, alert boolean, tail text,
  -- 'money' renders through the client's currency formatter; null is a plain
  -- string already fit to print.
  unit text,
  -- What metric_items() will answer for. Null means there is nothing to open.
  detail_key text)
language plpgsql stable set search_path = public as $$
declare v_co uuid;
begin
  v_co := report_scope(p_project, p_audience, p_company);

  return query
  select 1, (t.tl->>'percent_elapsed') || '%', 'Through the programme'::text,
         false, null::text, null::text, null::text
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
         nullif(count(*) filter (where overdue)::text || ' overdue', '0 overdue'),
         null::text,
         case when count(*) filter (where overdue) > 0 then 'documents' end
  from r having count(*) > 0;

  -- ------------------------------------------------------------- internal
  if p_audience = 'internal' then
    return query
    select 3, count(*)::text, 'Responsibility matrix gaps, falling to the contractor',
           true, null::text, null::text, 'gaps'::text
    from drm_gaps(p_project) having count(*) > 0;

    return query
    select 4, count(*)::text, 'Open tasks and RFIs',
           count(*) filter (where i.overdue) > 0,
           nullif(count(*) filter (where i.overdue)::text || ' overdue', '0 overdue'),
           null::text, 'issues'::text
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
                    || ' not yet amended', '0 not yet amended')),
           null::text, 'changes'::text
    from v_change_requests cr where cr.project_id = p_project having count(*) > 0;

    -- EXPECTED VALUE, never the gross total.
    return query
    select 6, round(t.expected)::text,
           'Expected risk value, ' || t.live::text || ' live',
           t.unowned > 0, nullif(t.unowned::text || ' unowned', '0 unowned'),
           'money'::text, 'risks'::text
    from risk_totals(p_project, 'risk') t where t.live > 0;

    return query
    select 7, round(b.score_achieved)::text || '%', 'BREEAM verified'::text,
           false, coalesce(b.rating_achieved, 'unclassified'), null::text, null::text
    from breeam_totals(p_project) b where b.available > 0;

    return query
    select 8, p.done::text || '/' || p.total::text, 'Planning conditions discharged',
           p.overdue > 0, nullif(p.overdue::text || ' overdue', '0 overdue'),
           null::text, case when p.overdue > 0 then 'planning' end
    from tracked_progress(p_project) p where p.kind = 'planning' and p.total > 0;

    return query
    select 9, p.done::text || '/' || p.total::text, 'Building control items closed',
           p.overdue > 0, nullif(p.overdue::text || ' overdue', '0 overdue'),
           null::text, case when p.overdue > 0 then 'bc' end
    from tracked_progress(p_project) p where p.kind = 'bc' and p.total > 0;

    return query
    select 10, sum(p.done)::text || '/' || sum(p.total)::text,
           'Checklist items complete'::text,
           sum(p.overdue) > 0, nullif(sum(p.overdue)::text || ' overdue', '0 overdue'),
           null::text, case when sum(p.overdue) > 0 then 'checklists' end
    from tracked_progress(p_project) p
    where p.kind like 'checklist:%' having sum(p.total) > 0;

    return query
    select 11, round(f.approved)::text, 'Approved fees'::text, false,
           'of which ' || to_char(f.paid, 'FM999,999,999') || ' paid to date',
           'money'::text, null::text
    from (select coalesce(sum(approved_total), 0) as approved,
                 coalesce(sum(paid), 0) as paid
          from fee_position(p_project)) f
    where f.approved > 0;
  end if;

  -- --------------------------------------------------------------- client
  --
  -- No fees. No risk register. No consultant health. No change-control
  -- classification. No occurrence content. The matrix appears as a count of
  -- gaps and never as a list naming a company -- so it carries no detail key
  -- either: opening it is the thing a client must not be able to do.
  if p_audience = 'client' then
    return query
    select 3, (p.done)::text || '/' || (p.total)::text, 'Client requirements confirmed',
           p.overdue > 0, nullif(p.overdue::text || ' overdue', '0 overdue'),
           null::text, null::text
    from tracked_progress(p_project) p
    where p.kind = 'checklist:client' and p.total > 0;

    return query
    select 4, sum(p.done)::text || '/' || sum(p.total)::text, 'Statutory conditions closed',
           sum(p.overdue) > 0,
           nullif(sum(p.overdue)::text || ' overdue', '0 overdue'),
           null::text, null::text
    from tracked_progress(p_project) p
    where p.kind in ('planning','bc') having sum(p.total) > 0;

    -- The TARGET rating, not the verified one: a client report is about where
    -- the project is heading.
    return query
    select 5, round(b.score_targeted)::text || '%', 'BREEAM on course for'::text,
           false, coalesce(b.rating_targeted, 'a rating to be confirmed'),
           null::text, null::text
    from breeam_totals(p_project) b where b.available > 0;

    return query
    select 6,
           case when count(*) = 0 then 'Fully allocated' else count(*)::text end,
           'Design responsibility matrix', count(*) > 0, null::text, null::text, null::text
    from drm_gaps(p_project);
  end if;

  -- ----------------------------------------------------------- consultant
  if p_audience = 'consultant' then
    return query
    select 3, case when count(*) filter (where s.state = 'missing') = 0 then 'Complete'
                   else count(*) filter (where s.state = 'missing')::text || ' missing' end,
           'Our appointment documents',
           count(*) filter (where s.state = 'missing') > 0, null::text, null::text, null::text
    from company_appointment_status(v_co) s;

    return query
    select 4, count(*)::text, 'Open tasks and RFIs against us',
           count(*) filter (where i.overdue) > 0,
           nullif(count(*) filter (where i.overdue)::text || ' overdue', '0 overdue'),
           null::text, 'issues'::text
    from v_issues i
    join project_people pp on pp.id = i.person_id
    where i.project_id = p_project and i.status = 'Open'
      and pp.company_id in (select company_id from company_tree(p_project, v_co));

    return query
    select 5, round(sum(f.approved_total))::text, 'Our approved fee'::text, false,
           'of which ' || to_char(sum(f.invoiced), 'FM999,999,999') || ' invoiced',
           'money'::text, null::text
    from fee_position(p_project) f
    where f.company_id in (select company_id from company_tree(p_project, v_co))
    having sum(f.approved_total) > 0;

    return query
    select 6, count(*) filter (where t.is_done)::text || '/' || count(*)::text,
           'Our scope of service complete',
           count(*) filter (where t.overdue) > 0,
           nullif(count(*) filter (where t.overdue)::text || ' overdue', '0 overdue'),
           null::text, null::text
    from v_tracked_items t
    where t.project_id = p_project and t.kind = 'scope' and t.required
      and t.company_id in (select company_id from company_tree(p_project, v_co))
    having count(*) > 0;

    return query
    select 7, count(*)::text, 'Items we lead on the responsibility matrix',
           false, null::text, null::text, null::text
    from drm_items d
    join company_disciplines cd on cd.discipline_code = d.lead_discipline
    join companies c on c.id = cd.company_id and c.project_id = p_project
    where d.project_id = p_project and d.applicable
      and c.id in (select company_id from company_tree(p_project, v_co));
  end if;
end;
$$;

create or replace function dashboard_metrics(p_project uuid)
returns table (
  sort_order int, value text, label text, alert boolean, tail text,
  unit text, detail_key text)
language plpgsql stable set search_path = public as $$
declare v_audience text; v_company uuid;
begin
  if not can_see_project(p_project) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  v_audience := (my_report_audiences(p_project))[1];
  if v_audience is null then return; end if;

  if v_audience = 'consultant' then
    v_company := my_company_on_project(p_project);
    if v_company is null then return; end if;
  end if;

  return query select * from report_metrics(p_project, v_audience, v_company);
end;
$$;

grant execute on function dashboard_metrics(uuid) to authenticated;

-- ------------------------------------------------------- what is behind it
/**
 * The rows a figure counted.
 *
 * Written from the same predicates as the metric above -- deliberately beside
 * it in one file, because the failure mode is the two drifting apart and
 * `supabase/tests/dashboard.test.ts` asserts for every key that the list
 * length is the number on the tile.
 *
 * `link` is the route under /project/:id that the row lives on, so the client
 * builds a working link rather than keeping a map of kinds to pages that
 * nobody updates when a page moves.
 *
 * Invoker, not definer. Every view it reads is already row-level secured, and
 * a definer here would be a second place where a consultant could be handed a
 * rival's overdue drawings.
 */
create or replace function metric_items(p_project uuid, p_key text)
returns table (
  reference text, title text, detail text, due date, overdue boolean, link text)
language sql stable security invoker set search_path = public as $$
  select * from (
    -- Only the overdue ones: the tile reads "41/58, 7 overdue", and the seven
    -- are what somebody clicking it is asking about.
    select d.document_number, coalesce(d.title, ''), coalesce(d.company_name, ''),
           d.due, true, 'register'
    from v_drawing_register d
    where p_key = 'documents' and d.project_id = p_project and d.overdue

    union all
    select i.reference, i.title, coalesce(i.category, ''), i.due, i.overdue, 'issues'
    from v_issues i
    where p_key = 'issues' and i.project_id = p_project and i.status = 'Open'

    union all
    select cr.reference, cr.title, cr.headline_status, cr.decision_due,
           cr.bsa_verdict = 'stop', 'changes-requests'
    from v_change_requests cr
    where p_key = 'changes' and cr.project_id = p_project
      and cr.status not in ('Closed','Rejected','Withdrawn','Implemented')

    union all
    -- Ranked by expected value, which is the only figure the register calls
    -- exposure -- never the gross.
    select r.reference, r.title,
           coalesce(r.owner_name, 'Nobody owns this'), r.review_due,
           r.person_id is null, 'risk'
    from v_risks r
    where p_key = 'risks' and r.project_id = p_project and r.kind = 'risk'
      and not r.done

    union all
    select g.ref, g.item, g.gap_reason, null::date, true, 'matrix'
    from drm_gaps(p_project) g
    where p_key = 'gaps'

    union all
    select t.reference, t.title, t.status, t.due, t.overdue,
           case t.kind when 'planning' then 'planning' when 'bc' then 'bc'
                       else replace(t.kind, 'checklist:', '') end
    from v_tracked_items t
    where t.project_id = p_project and t.required and t.overdue
      and ((p_key = 'planning' and t.kind = 'planning')
        or (p_key = 'bc' and t.kind = 'bc')
        or (p_key = 'checklists' and t.kind like 'checklist:%'))
  ) x(reference, title, detail, due, overdue, link)
  order by x.overdue desc, x.due nulls last, x.reference;
$$;

grant execute on function metric_items(uuid, text) to authenticated;

/**
 * The same question for one company, which is what a cell on the consultant
 * health table is: a number that somebody wants the names behind.
 *
 * Account staff only, like the table it hangs off. Consultant health names
 * firms and ranks them, and a consultant reading their own position against a
 * rival's is not what it is for -- so this refuses rather than returning an
 * empty list, which would read as "that firm has nothing outstanding".
 */
create or replace function company_items(p_project uuid, p_company uuid, p_kind text)
returns table (
  reference text, title text, detail text, due date, overdue boolean, link text)
language plpgsql stable security invoker set search_path = public as $$
begin
  if not exists (select 1 from projects p
                 where p.id = p_project and is_account_staff(p.organisation_id)) then
    raise exception 'Consultant health is internal to the contractor'
      using errcode = '42501';
  end if;

  return query
  select * from (
    select d.document_number, coalesce(d.title, ''), coalesce(d.revision, ''),
           d.due, true, 'register'
    from v_drawing_register d
    where p_kind = 'overdue' and d.project_id = p_project
      and d.company_id = p_company and d.overdue

    union all
    select i.reference, i.title, coalesce(pp.name, ''), i.due, i.overdue, 'issues'
    from v_issues i
    join project_people pp on pp.id = i.person_id
    where p_kind = 'open' and i.project_id = p_project and i.status = 'Open'
      and pp.company_id = p_company

    union all
    select i.reference, i.title,
           q.days_quiet::text || ' days since anybody said anything',
           i.due, true, 'issues'
    from gone_quiet(p_project) q
    join v_issues i on i.reference = q.reference and i.project_id = p_project
    join project_people pp on pp.id = i.person_id
    where p_kind = 'quiet' and pp.company_id = p_company

    union all
    -- An appointment slot with nothing in it. The reference is the slot, which
    -- is what the directory page names it too.
    select s.slot, 'Nothing uploaded', '', null::date, true, 'directory'
    from company_appointment_status(p_company) s
    where p_kind = 'appointment' and s.state = 'missing'
  ) x(reference, title, detail, due, overdue, link)
  order by x.due nulls last, x.reference;
end;
$$;

grant execute on function company_items(uuid, uuid, text) to authenticated;

/** The companies in one bucket of the appointments bar. */
create or replace function appointment_companies(p_project uuid, p_state text)
returns table (
  reference text, title text, detail text, due date, overdue boolean, link text)
language sql stable security invoker set search_path = public as $$
  with per_company as (
    select c.id, c.name,
           count(*) filter (where s.state = 'missing') as missing,
           count(*) as slots
    from companies c
    cross join lateral company_appointment_status(c.id) s
    where c.project_id = p_project and c.company_type <> 'client'
    group by c.id, c.name
  )
  select '', p.name,
         case when p.missing = 0 then 'All documents in'
              else p.missing::text || ' of ' || p.slots::text || ' still missing' end,
         null::date, p.missing > 0, 'directory'
  from per_company p
  where case when p.missing = 0 then 'complete'
             when p.missing >= p.slots then 'none'
             else 'partial' end = p_state
  order by p.name;
$$;

grant execute on function appointment_companies(uuid, text) to authenticated;
