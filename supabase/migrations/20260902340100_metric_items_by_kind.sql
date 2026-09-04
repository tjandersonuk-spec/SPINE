-- A bar opens even when nothing on it is late.
--
-- `metric_items()` answered for the scorecards, which are all "how many are
-- wrong" questions, so every branch returned only the overdue rows. The
-- checklist bars are a different question -- "where has this got to" -- and a
-- checklist with nothing overdue still has twenty items somebody wants to
-- read. So a bar asks for its whole kind, and gets it ordered with the late
-- ones first.
--
-- The key carries the kind rather than one branch per checklist type, because
-- checklist kinds are added by loading a template and a function that had to
-- gain a branch each time would be a function nobody remembers to edit.
create or replace function metric_items(p_project uuid, p_key text)
returns table (
  reference text, title text, detail text, due date, overdue boolean, link text)
language sql stable security invoker set search_path = public as $$
  select * from (
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

    -- The overdue-only keys, which is what a scorecard is claiming.
    union all
    select t.reference, t.title, t.status, t.due, t.overdue,
           case t.kind when 'planning' then 'planning' when 'bc' then 'bc'
                       else replace(t.kind, 'checklist:', '') end
    from v_tracked_items t
    where t.project_id = p_project and t.required and t.overdue
      and ((p_key = 'planning' and t.kind = 'planning')
        or (p_key = 'bc' and t.kind = 'bc')
        or (p_key = 'checklists' and t.kind like 'checklist:%'))

    -- And the whole kind, which is what a bar is showing. `items:planning`,
    -- `items:bc`, `items:checklist:handover`, `items:scope`, and so on.
    union all
    select t.reference, t.title,
           t.status || case when t.company_name is not null
                            then ', ' || t.company_name else '' end,
           t.due, t.overdue,
           case t.kind when 'planning' then 'planning' when 'bc' then 'bc'
                       when 'scope' then 'scope' when 'breeam' then 'breeam'
                       else replace(t.kind, 'checklist:', '') end
    from v_tracked_items t
    where p_key like 'items:%' and t.project_id = p_project and t.required
      and t.kind = substring(p_key from 7)
  ) x(reference, title, detail, due, overdue, link)
  order by x.overdue desc, x.due nulls last, x.reference;
$$;

grant execute on function metric_items(uuid, text) to authenticated;
