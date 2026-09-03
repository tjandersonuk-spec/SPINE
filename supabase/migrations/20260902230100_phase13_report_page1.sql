-- Phase 13, part two -- page one: the state of play.
--
-- The audience decides content HERE, in one place, and not at render time per
-- field. There is no `if audience = 'client'` sprinkled through a template:
-- every exclusion the client report makes is made in this file, where it can be
-- read as a list and reviewed as one.

-- The headline tiles. One row per tile, in the order they are shown.
create or replace function report_metrics(
  p_project uuid, p_audience text, p_company uuid default null
) returns table (
  sort_order int, value text, label text, alert boolean, tail text
)
language plpgsql
stable
-- INVOKER, deliberately. The audience rules below decide what a report
-- CONTAINS; RLS still decides what the caller may read underneath them. Two
-- independent filters, so a mistake in the audience list is not on its own
-- enough to leak a figure.
security invoker
set search_path = public, pg_temp
as $$
declare v_co uuid;
begin
  v_co := report_scope(p_project, p_audience, p_company);

  -- Shared by all three: how far through the programme, and what has been
  -- issued of what was anticipated. A date is not commercially sensitive and
  -- neither is a document count against a plan.
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
    select 7, round(b.score_achieved * 100)::text || '%',
           'BREEAM verified — ' || coalesce(b.rating_achieved, 'unclassified'),
           false, null::text
    from breeam_totals(p_project) b where b.available > 0;

    return query
    select 8, '£' || to_char(f.approved, 'FM999,999,999'),
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

    -- Planning and building control together: a client asks whether the
    -- statutory position is clear, not which register it sits in.
    return query
    select 4, sum(p.done)::text || '/' || sum(p.total)::text, 'Statutory conditions closed',
           sum(p.overdue) > 0,
           nullif(sum(p.overdue)::text || ' overdue', '0 overdue')
    from tracked_progress(p_project) p
    where p.kind in ('planning','bc') having sum(p.total) > 0;

    -- The TARGET rating, not the verified one: a client report is about where
    -- the project is heading.
    return query
    select 5, round(b.score_targeted * 100)::text || '%',
           'BREEAM on course for ' || coalesce(b.rating_targeted, 'a rating to be confirmed'),
           false, null::text
    from breeam_totals(p_project) b where b.available > 0;

    return query
    select 6,
           case when count(*) = 0 then 'Fully allocated' else count(*)::text end,
           'Design responsibility matrix', count(*) > 0, null::text
    from drm_items d
    where d.project_id = p_project and d.applicable
      and (d.lead_discipline is null
           or not exists (select 1 from company_disciplines cd
                          join companies c on c.id = cd.company_id
                           and c.project_id = p_project
                          where cd.discipline_code = d.lead_discipline));
  end if;

  -- ----------------------------------------------------------- consultant
  --
  -- Every figure filters through the company tree, so a consultant's own report
  -- never reveals another company's position.
  if p_audience = 'consultant' and v_co is not null then
    return query
    select 3, count(*)::text, 'Open tasks and RFIs against us',
           count(*) filter (where i.overdue) > 0,
           nullif(count(*) filter (where i.overdue)::text || ' overdue', '0 overdue')
    from v_issues i
    join project_people pp on pp.id = i.person_id
    where i.project_id = p_project and i.status = 'Open'
      and pp.company_id in (select company_id from company_tree(p_project, v_co));

    return query
    select 4, '£' || to_char(f.approved_total, 'FM999,999,999'),
           'Our approved fee — £' || to_char(f.invoiced, 'FM999,999,999') || ' invoiced',
           false, null::text
    from fee_position(p_project) f
    where f.company_id = v_co and f.approved_total > 0;

    return query
    select 5, (count(*) filter (where t.is_done))::text || '/' || count(*)::text,
           'Our scope of service complete',
           count(*) filter (where t.overdue) > 0,
           nullif(count(*) filter (where t.overdue)::text || ' overdue', '0 overdue')
    from v_tracked_items t
    where t.project_id = p_project and t.kind = 'scope' and t.required
      and t.company_id in (select company_id from company_tree(p_project, v_co))
    having count(*) > 0;

    return query
    select 6, count(*)::text, 'Items we lead on the responsibility matrix', false, null::text
    from drm_items d
    where d.project_id = p_project and d.applicable and d.lead_discipline is not null
      and exists (select 1 from company_disciplines cd
                  where cd.discipline_code = d.lead_discipline
                    and cd.company_id in
                        (select company_id from company_tree(p_project, v_co)));
  end if;
end;
$$;

grant execute on function report_metrics(uuid, text, uuid) to authenticated;

-- ------------------------------------------------- the itemised breakdown
--
-- EVERY TRACKED-ITEM TYPE GETS ITS OWN ROW, never a merged total. A rollup
-- cannot answer "which one is behind?", which is the first question anybody
-- reading a compliance section asks -- and that is exactly why the first cut of
-- this, which folded planning, building control and six checklists into one
-- tile, was wrong.
--
-- Client excludes the pre-construction pre-assessment: it is a design manager's
-- own tender review, on the same reasoning as the change-control exclusion.
-- Consultant scopes every row by company and EMITS NOTHING for a type they hold
-- no items on -- an empty row for six types they have nothing on is noise, not
-- a finding.
create or replace function report_compliance_rows(
  p_project uuid, p_audience text, p_company uuid default null
) returns table (kind text, label text, total int, done int, overdue int)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare v_co uuid; v_exclude text[] := '{}';
begin
  v_co := report_scope(p_project, p_audience, p_company);
  if p_audience = 'client' then
    v_exclude := array['checklist:precon', 'scope'];
  end if;

  return query
  select t.kind,
         case t.kind
           when 'planning' then 'Planning conditions'
           when 'bc' then 'Building control'
           when 'scope' then 'Scope of service'
           when 'checklist:precon' then 'Pre-construction pre-assessment'
           when 'checklist:client' then 'Client requirements'
           when 'checklist:handover' then 'Handover'
           when 'checklist:highways' then 'Highways'
           when 'checklist:utilities' then 'Utilities'
           else initcap(replace(t.kind, ':', ' — '))
         end,
         count(*) filter (where t.required)::int,
         count(*) filter (where t.required and t.is_done)::int,
         count(*) filter (where t.overdue)::int
  from v_tracked_items t
  where t.project_id = p_project
    and t.kind <> 'breeam'
    and not (t.kind = any(v_exclude))
    and (v_co is null
         or t.company_id in (select company_id from company_tree(p_project, v_co)))
  group by t.kind
  -- A type with nothing required on it produces no row at all.
  having count(*) filter (where t.required) > 0
  order by
    case t.kind when 'planning' then 1 when 'bc' then 2 when 'scope' then 3 else 4 end,
    t.kind;
end;
$$;

grant execute on function report_compliance_rows(uuid, text, uuid) to authenticated;
