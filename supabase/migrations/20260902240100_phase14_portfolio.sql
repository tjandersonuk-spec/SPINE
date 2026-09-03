-- Phase 14, part two -- the portfolio roll-ups.
--
-- All derived from the same functions the project dashboard uses. The only new
-- code here is the roll-up itself, and the only new data is the snapshot table.
-- Nothing below computes a figure a project page does not already compute --
-- that is what keeps the portfolio view and the project view from ever
-- disagreeing in front of somebody who has both open.

-- ------------------------------------------------------------ host home
--
-- Every project the signed-in person can reach, one row each, worst first.
--
-- WHICH PROJECTS is my_projects(): account staff see every project in their
-- account, everybody else sees the ones they are a member of. The rule is not
-- restated here, because a second copy of it would eventually disagree with the
-- first.
--
-- Invoker, so the counts are what this caller can actually see. A consultant on
-- one job of six sees that one row, with figures matching the project page they
-- would land on if they clicked it.
create or replace function portfolio_projects()
returns table (
  project_id uuid,
  code text,
  name text,
  organisation_id uuid,
  account_name text,
  stage text,
  hrb boolean,
  percent_elapsed int,
  percent_complete int,
  overdue_documents int,
  drm_gaps int,
  decisions_waiting int,
  stop_works int,
  client_done int,
  client_total int,
  open_tasks int,
  -- The sort key, and it is a sort key rather than a score: the columns are the
  -- evidence, the order is the judgement. Same reasoning as consultant health.
  concern int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with mine as (select * from my_projects()),
  fig as (
    select
      p.id, p.code, p.name, p.organisation_id, p.riba_stage, p.hrb,
      (select o.name from organisations o where o.id = p.organisation_id) as account_name,
      programme_timeline(p.id) as tl,
      (select count(*)::int from v_drawing_register r
        where r.project_id = p.id and r.overdue) as overdue_documents,
      (select count(*)::int from drm_items d
        where d.project_id = p.id and d.applicable
          and (d.lead_discipline is null
               or not exists (select 1 from company_disciplines cd
                              join companies c on c.id = cd.company_id
                               and c.project_id = p.id
                              where cd.discipline_code = d.lead_discipline)))
        as drm_gaps,
      -- Waiting on somebody: a change request submitted or under review, and an
      -- RFI nobody has answered.
      ((select count(*)::int from v_change_requests cr
         where cr.project_id = p.id and cr.status in ('Submitted','Under review'))
       + (select count(*)::int from v_issues i
          where i.project_id = p.id and i.source_kind = 'rfi'
            and i.rfi_status = 'Open' and i.status = 'Open')) as decisions_waiting,
      -- The one figure on this page that is not merely late. A higher-risk
      -- building where work must stop is a different kind of row.
      (select count(*)::int from v_change_requests cr
        where cr.project_id = p.id and cr.bsa_controlled and cr.bsa_verdict = 'stop')
        as stop_works,
      (select count(*) filter (where t.is_done)::int from v_tracked_items t
        where t.project_id = p.id and t.kind = 'checklist:client' and t.required)
        as client_done,
      (select count(*)::int from v_tracked_items t
        where t.project_id = p.id and t.kind = 'checklist:client' and t.required)
        as client_total,
      (select count(*)::int from v_issues i
        where i.project_id = p.id and i.status = 'Open') as open_tasks
    from mine p
  )
  select
    f.id, f.code, f.name, f.organisation_id, f.account_name, f.riba_stage, f.hrb,
    coalesce((f.tl->>'percent_elapsed')::int, 0),
    coalesce((f.tl->>'percent_complete')::int, 0),
    f.overdue_documents, f.drm_gaps, f.decisions_waiting, f.stop_works,
    f.client_done, f.client_total, f.open_tasks,
    -- A stop-work outranks everything: it is the only entry here that means
    -- somebody must put their tools down.
    (f.stop_works * 100 + f.overdue_documents * 3 + f.drm_gaps * 2
     + f.decisions_waiting)
  from fig f
  order by 17 desc, f.code;
$$;

grant execute on function portfolio_projects() to authenticated;

-- ------------------------------------------- consultant health, summed
--
-- The per-project row, added up across every project that company is appointed
-- on. A consultant who is fine on one job and behind on three is a conversation
-- the per-project view cannot start.
--
-- Companies are per-project rows, so the same firm on four jobs is four rows in
-- `companies`; they are gathered here by their CATALOGUE entry, which is the
-- account's one record of that firm. Matching on name would merge two genuinely
-- different firms that happen to share one, and split one that was typed twice.
create or replace function portfolio_consultant_health(p_org uuid default null)
returns table (
  catalogue_company_id uuid,
  company_name text,
  projects int,
  appointment_gaps int,
  overdue_drawings int,
  open_issues int,
  quiet_issues int,
  concern_score int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with mine as (
    select * from my_projects() p
    where p_org is null or p.organisation_id = p_org
  ),
  rows as (
    select c.catalogue_company_id, h.*
    from mine p
    -- consultant_health() is internal-only by its own definition, so a
    -- consultant calling this gets nothing rather than a rival's position.
    cross join lateral consultant_health(p.id) h
    join companies c on c.id = h.company_id
    where c.catalogue_company_id is not null
  )
  select
    r.catalogue_company_id,
    max(r.company_name),
    count(*)::int,
    sum(r.appointment_gaps)::int,
    sum(r.overdue_drawings)::int,
    sum(r.open_issues)::int,
    sum(r.quiet_issues)::int,
    sum(r.concern_score)::int
  from rows r
  group by r.catalogue_company_id
  order by 8 desc, 2;
$$;

grant execute on function portfolio_consultant_health(uuid) to authenticated;

-- ------------------------------------------- the decision queue, everywhere
--
-- What a design manager running four jobs opens on a Monday: everything waiting
-- on THIS PERSON across every project they are on.
--
-- This is the personal queue, keyed on auth.uid() through decision_queue()
-- itself — the opposite of report_attention(), and correctly so. A dashboard is
-- read by the person looking at it; a report is read by somebody else.
create or replace function my_decisions()
returns table (
  project_id uuid,
  project_code text,
  project_name text,
  kind text,
  record_id uuid,
  reference text,
  title text,
  due date,
  urgency int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select p.id, p.code, p.name, q.*
  from my_projects() p
  cross join lateral decision_queue(p.id) q
  order by q.urgency desc, q.due nulls last, p.code;
$$;

grant execute on function my_decisions() to authenticated;

-- --------------------------------------------------------------- trends
--
-- THE ONLY READER OF `snapshots`, alongside its portfolio sibling below. Both
-- exist for charts; no live figure is ever taken from here, and the Phase 14
-- test scans pg_proc to keep it that way.
create or replace function project_trend(p_project uuid, p_days int default 90)
returns table (
  date date, issued int, anticipated int, overdue int, open_tasks int,
  drm_gaps int, risk_expected numeric, certified numeric,
  client_done int, client_total int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select s.date, s.issued, s.anticipated, s.overdue, s.open_tasks, s.drm_gaps,
         s.risk_expected, s.certified, s.client_done, s.client_total
  from snapshots s
  where s.project_id = p_project
    and s.date >= current_date - p_days
  order by s.date;
$$;

grant execute on function project_trend(uuid, int) to authenticated;

-- The same thing across the portfolio: one row per date, summed over every
-- project the caller can reach.
create or replace function portfolio_trend(p_org uuid default null, p_days int default 90)
returns table (
  date date, projects int, issued int, anticipated int, overdue int,
  open_tasks int, drm_gaps int, risk_expected numeric, certified numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select s.date, count(*)::int,
         sum(s.issued)::int, sum(s.anticipated)::int, sum(s.overdue)::int,
         sum(s.open_tasks)::int, sum(s.drm_gaps)::int,
         sum(s.risk_expected), sum(s.certified)
  from snapshots s
  join my_projects() p on p.id = s.project_id
  where s.date >= current_date - p_days
    and (p_org is null or p.organisation_id = p_org)
  group by s.date
  order by s.date;
$$;

grant execute on function portfolio_trend(uuid, int) to authenticated;

-- The headline above the portfolio list. Live figures, computed on read like
-- everything else -- deliberately NOT from the snapshot table, even though
-- today's row would usually agree: "usually" is how a dashboard starts being
-- a day behind without anybody noticing.
create or replace function portfolio_summary(p_org uuid default null)
returns table (
  projects int, hrb_projects int, stop_works int,
  overdue_documents int, drm_gaps int, decisions_waiting int, open_tasks int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    count(*)::int,
    count(*) filter (where p.hrb)::int,
    coalesce(sum(p.stop_works), 0)::int,
    coalesce(sum(p.overdue_documents), 0)::int,
    coalesce(sum(p.drm_gaps), 0)::int,
    coalesce(sum(p.decisions_waiting), 0)::int,
    coalesce(sum(p.open_tasks), 0)::int
  from portfolio_projects() p
  where p_org is null or p.organisation_id = p_org;
$$;

grant execute on function portfolio_summary(uuid) to authenticated;
