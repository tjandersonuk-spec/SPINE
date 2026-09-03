-- Phase 8 -- the consultant front and the project dashboard.
--
-- No new tables. Everything here is a question asked of records that already
-- exist, which is why a consultant's front cannot drift out of step with what
-- the pages show: it is the same rows, filtered by the same policies.

-- The caller's own company on this project, plus its sub-consultants.
--
-- A consultant who has appointed a specialist under them is answerable for that
-- specialist's work, so their front shows it. The recursion is why this is not
-- just my_company_on_project(): a two-level appointment is normal and a
-- three-level one is not unheard of.
create or replace function my_company_tree(p_project uuid)
returns table (company_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive mine as (
    select c.id
    from companies c
    where c.id = my_company_on_project(p_project)
    union all
    select c.id
    from companies c
    join mine m on c.parent_id = m.id
    where c.project_id = p_project
  )
  select id from mine;
$$;

grant execute on function my_company_tree(uuid) to authenticated;

-- ------------------------------------------------------------ decision queue
-- What is waiting on the signed-in person, right now.
--
-- Deliberately keyed on auth.uid(). Phase 13's report answers the different
-- question "what is waiting on this audience" and will be its own function --
-- a report addressed to a client that referenced whoever generated it would
-- leak whose account produced it.
create or replace function decision_queue(p_project uuid)
returns table (
  kind text, record_id uuid, reference text, title text, due date, urgency int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  -- RFIs waiting on an answer, where the caller is on the contractor's team.
  select 'RFI to answer'::text, i.id, i.reference, i.title, i.due, i.urgency
  from v_issues i
  where i.project_id = p_project
    and i.source_kind = 'rfi' and i.rfi_status = 'Open' and i.status = 'Open'
    and can_write_project_setup(p_project)
  union all
  -- Tasks assigned to the caller through their directory row.
  select 'Task assigned to you', i.id, i.reference, i.title, i.due, i.urgency
  from v_issues i
  join project_people pp on pp.id = i.person_id
  where i.project_id = p_project and i.status = 'Open' and pp.profile_id = auth.uid()
  union all
  -- Evidence the caller may review and nobody has.
  select 'Evidence to review', e.id, coalesce(e.document_number, e.name, 'Evidence'),
         coalesce(e.entity_type, ''), null::date, 40
  from v_evidence e
  where e.project_id = p_project and e.reviewed_at is null
    and can_write_project_setup(p_project)
  order by 6 desc, 5 nulls last;
$$;

grant execute on function decision_queue(uuid) to authenticated;

-- ------------------------------------------------------------- gone quiet
-- Open, and untouched for three weeks.
--
-- "Touched" means a comment or a change-log entry, not the raised date: an item
-- being old is not the finding. An item nobody has said anything about since
-- the last time it mattered is.
create or replace function gone_quiet(p_project uuid, p_weeks int default 3)
returns table (
  reference text, title text, raised_at timestamptz, last_touched timestamptz, days_quiet int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with last_touch as (
    select i.id, i.reference, i.title, i.raised_at,
           greatest(
             i.raised_at,
             coalesce((select max(c.created_at) from comments c
                       where c.entity_type = 'issue' and c.entity_id = i.id), i.raised_at),
             coalesce((select max(l.created_at) from change_log l
                       where l.entity_type = 'issues' and l.entity_id = i.id), i.raised_at)
           ) as touched
    from issues i
    where i.project_id = p_project and i.status = 'Open'
  )
  select reference, title, raised_at, touched,
         extract(day from (now() - touched))::int
  from last_touch
  where touched < now() - make_interval(weeks => p_weeks)
  order by touched;
$$;

grant execute on function gone_quiet(uuid, int) to authenticated;

-- -------------------------------------------------------- consultant health
-- One row per company, worst first.
--
-- Deliberately a sort order and not a grade. A letter or a percentage invites
-- an argument about the mark rather than about the four facts under it, and the
-- facts are what someone can act on. The order is the judgement; the columns
-- are the evidence for it.
create or replace function consultant_health(p_project uuid)
returns table (
  company_id uuid, company_name text,
  appointment_gaps int, overdue_drawings int, open_issues int, quiet_issues int,
  concern_score int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id, c.name,
    -- Mandatory appointment slots with nothing in them.
    (select count(*)::int from company_appointment_status(c.id) s where s.state = 'missing'),
    -- Drawings from this originator that are due and have not arrived.
    (select count(*)::int from v_drawing_register r
     where r.project_id = p_project and r.company_id = c.id and r.overdue),
    -- Open items carried by anyone at this firm.
    (select count(*)::int from issues i
     join project_people pp on pp.id = i.person_id
     where i.project_id = p_project and i.status = 'Open' and pp.company_id = c.id),
    -- Of those, the ones nobody has said anything about for three weeks.
    (select count(*)::int from gone_quiet(p_project) q
     join issues i on i.reference = q.reference and i.project_id = p_project
     join project_people pp on pp.id = i.person_id
     where pp.company_id = c.id),
    -- The sort key. Not a grade: a letter or a percentage invites an argument
    -- about the mark rather than about the facts under it, and the facts are
    -- what someone can act on. Open items are not counted -- a busy consultant
    -- is not a worrying one; a silent or late one is.
    ((select count(*)::int from company_appointment_status(c.id) s where s.state = 'missing')
     + (select count(*)::int from v_drawing_register r
        where r.project_id = p_project and r.company_id = c.id and r.overdue)
     + (select count(*)::int from gone_quiet(p_project) q
        join issues i on i.reference = q.reference and i.project_id = p_project
        join project_people pp on pp.id = i.person_id
        where pp.company_id = c.id))
  from companies c
  where c.project_id = p_project
    -- Only the contractor's own staff see this at all. It names firms and
    -- ranks them; a consultant reading their own position against a rival's is
    -- not what it is for.
    and exists (select 1 from projects p where p.id = p_project
                and is_account_staff(p.organisation_id))
  order by 7 desc, 2;
$$;

grant execute on function consultant_health(uuid) to authenticated;

-- --------------------------------------------------------------- timeline
-- The programme bar. ONE function, called from the dashboard now and from
-- Phase 13's period report later -- the notes are explicit that there should
-- not be two, because two would eventually draw different pictures.
create or replace function programme_timeline(p_project uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'start', min(coalesce(r.rolled_start, t.start_date)),
    'finish', max(coalesce(r.rolled_finish, t.finish_date)),
    'today', current_date,
    'percent_elapsed', case
      when max(coalesce(r.rolled_finish, t.finish_date))
         > min(coalesce(r.rolled_start, t.start_date))
      then round(
        100.0 * (current_date - min(coalesce(r.rolled_start, t.start_date)))
        / (max(coalesce(r.rolled_finish, t.finish_date))
           - min(coalesce(r.rolled_start, t.start_date))))
      else 0 end,
    -- Weighted by duration, the same way v_programme_rollup does it, so the
    -- headline figure and any summary bar agree.
    'percent_complete', round(
      sum((t.finish_date - t.start_date + 1) * t.percent_complete)::numeric
      / nullif(sum(t.finish_date - t.start_date + 1), 0)),
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'uid', m.task_uid, 'description', m.description,
               'date', m.finish_date, 'complete', m.percent_complete >= 100)
             order by m.finish_date)
      from programme_tasks m
      where m.project_id = p_project and m.task_type = 'Milestone' and not m.removed
    ), '[]'::jsonb))
  from programme_tasks t
  left join v_programme_rollup r
    on r.project_id = t.project_id and r.root_uid = t.task_uid
  where t.project_id = p_project and not t.removed;
$$;

grant execute on function programme_timeline(uuid) to authenticated;

-- ------------------------------------------------------- the consultant front
-- Everything a consultant is answerable for on this project, and nothing else.
--
-- Every figure filters through my_company_tree, so a consultant sees their own
-- firm and anyone they have appointed under them -- never a rival on the same
-- project.
create or replace function my_front(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when can_see_project(p_project) then jsonb_build_object(
    'company_ids', coalesce((select jsonb_agg(company_id) from my_company_tree(p_project)),
                            '[]'::jsonb),
    -- Due from us: drawings this originator owes that have not arrived.
    'due_from_us', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'number', r.document_number, 'title', r.title,
        'due', r.due, 'overdue', r.overdue) order by r.due nulls last)
      from v_drawing_register r
      where r.project_id = p_project and r.awaited
        and r.company_id in (select company_id from my_company_tree(p_project))
    ), '[]'::jsonb),
    -- Asked of us: open items carried by someone at our firm.
    'asked_of_us', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'reference', i.reference, 'title', i.title,
        'kind', i.source_kind, 'due', i.due, 'urgency', i.urgency)
        order by i.urgency desc)
      from v_issues i
      join project_people pp on pp.id = i.person_id
      where i.project_id = p_project and i.status = 'Open'
        and pp.company_id in (select company_id from my_company_tree(p_project))
    ), '[]'::jsonb),
    -- What we lead on the matrix, resolved through the discipline as always.
    'we_lead', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'ref', d.ref, 'item', d.item, 'discipline', d.lead_discipline)
        order by d.ref)
      from drm_items d
      join drm_leads(p_project) l on l.drm_item_id = d.id
      where d.project_id = p_project and d.applicable
        and l.company_id in (select company_id from my_company_tree(p_project))
    ), '[]'::jsonb),
    -- Our own appointment documents, and which are missing.
    'appointment_gaps', coalesce((
      select jsonb_agg(jsonb_build_object('company', c.name, 'slot', s.slot))
      from companies c, company_appointment_status(c.id) s
      where c.id in (select company_id from my_company_tree(p_project))
        and s.state = 'missing'
    ), '[]'::jsonb),
    -- Programme lines this person tracks. Personal, not per company.
    'tracked_lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'uid', t.task_uid, 'description', t.description,
        'start', t.start_date, 'finish', t.finish_date,
        'percent', t.percent_complete, 'removed', t.removed)
        order by t.finish_date)
      from programme_watch w
      join programme_tasks t
        on t.project_id = w.project_id and t.task_uid = w.task_uid
      where w.project_id = p_project and w.profile_id = auth.uid()
    ), '[]'::jsonb),
    -- Decisions waiting on this person specifically.
    'waiting_on_you', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', q.kind, 'reference', q.reference, 'title', q.title,
        'due', q.due, 'urgency', q.urgency))
      from decision_queue(p_project) q
    ), '[]'::jsonb))
  end;
$$;

grant execute on function my_front(uuid) to authenticated;
