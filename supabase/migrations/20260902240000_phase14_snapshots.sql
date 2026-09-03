-- Phase 14, part one -- snapshots: the one stored derived table.
--
-- Every other derived value in this product is computed on read. This one is
-- stored, and it is not really an exception: a snapshot is a fact ABOUT A DATE,
-- which is what a trend needs and what nothing else keeps. Yesterday's overdue
-- count cannot be recomputed, because the register has moved since.
--
-- NEVER READ A LIVE FIGURE FROM IT. It exists for burn-up and trend charts
-- only, and supabase/tests/phase14.test.ts scans pg_proc and fails the build if
-- any function other than the writer and the trend readers touches this table.

create table snapshots (
  project_id uuid not null references projects(id) on delete cascade,
  date date not null,
  -- The register: what has arrived, of what was anticipated, and what is late.
  issued int not null default 0,
  anticipated int not null default 0,
  overdue int not null default 0,
  open_tasks int not null default 0,
  -- Matrix items nobody holds the lead discipline for.
  drm_gaps int not null default 0,
  -- Expected value, never the gross total -- the same figure the register
  -- reports, so a trend line and the live page cannot disagree about what the
  -- word means.
  risk_expected numeric(14,2) not null default 0,
  certified numeric(14,2) not null default 0,
  client_done int not null default 0,
  client_total int not null default 0,
  taken_at timestamptz not null default now(),
  primary key (project_id, date)
);
create index on snapshots (date);

-- Taking one.
--
-- Every figure is read from the SAME view the live page reads. The whole point
-- of the snapshot is that it is the live number, kept; a second calculation
-- here would make the trend and the dashboard drift apart, and the drift would
-- only be visible months later on a chart nobody could reconcile.
--
-- Definer because the nightly job runs with no session: it must see the whole
-- project regardless of who last signed in.
create or replace function take_snapshot(p_project uuid, p_date date default null)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare d date := coalesce(p_date, current_date);
begin
  insert into snapshots (
    project_id, date, issued, anticipated, overdue, open_tasks, drm_gaps,
    risk_expected, certified, client_done, client_total, taken_at)
  select
    p_project, d,
    (select count(*)::int from v_drawing_register r
      where r.project_id = p_project and not r.awaited),
    (select count(*)::int from v_drawing_register r where r.project_id = p_project),
    (select count(*)::int from v_drawing_register r
      where r.project_id = p_project and r.overdue),
    (select count(*)::int from issues i
      where i.project_id = p_project and i.status = 'Open'),
    (select count(*)::int from drm_items dd
      where dd.project_id = p_project and dd.applicable
        and (dd.lead_discipline is null
             or not exists (select 1 from company_disciplines cd
                            join companies c on c.id = cd.company_id
                             and c.project_id = p_project
                            where cd.discipline_code = dd.lead_discipline))),
    (select coalesce(sum(v.expected_value), 0) from v_risks v
      where v.project_id = p_project and v.kind = 'risk' and not v.done),
    (select coalesce(sum(iv.value), 0) from invoices iv
      where iv.project_id = p_project and iv.status in ('Certified','Paid')),
    (select coalesce(count(*) filter (where t.is_done), 0)::int from v_tracked_items t
      where t.project_id = p_project and t.kind = 'checklist:client' and t.required),
    (select coalesce(count(*), 0)::int from v_tracked_items t
      where t.project_id = p_project and t.kind = 'checklist:client' and t.required),
    now()
  -- Re-running for a date it already holds replaces it rather than failing:
  -- a job that cannot be safely retried is a job that eventually leaves a hole.
  on conflict (project_id, date) do update set
    issued = excluded.issued, anticipated = excluded.anticipated,
    overdue = excluded.overdue, open_tasks = excluded.open_tasks,
    drm_gaps = excluded.drm_gaps, risk_expected = excluded.risk_expected,
    certified = excluded.certified, client_done = excluded.client_done,
    client_total = excluded.client_total, taken_at = excluded.taken_at;
end;
$$;

-- The nightly job. One row per live project, in one transaction.
--
-- An archived account's projects still get a row: the trend on a finished job
-- is exactly what somebody looks at afterwards. A suspended account's do not --
-- nothing is happening on them, and a flat line through a suspension reads as
-- a project that stalled rather than one that was switched off.
create or replace function take_daily_snapshots(p_date date default null)
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_n int := 0; p record;
begin
  for p in
    select pr.id from projects pr
    join organisations o on o.id = pr.organisation_id
    where o.status in ('active','archived')
  loop
    perform take_snapshot(p.id, p_date);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Neither is granted to `authenticated`. The job runs as the service role from
-- a scheduled Edge Function, and a snapshot somebody could take by hand is a
-- snapshot somebody could take twice on a good day and never on a bad one.
revoke execute on function take_snapshot(uuid, date) from public;
revoke execute on function take_daily_snapshots(date) from public;

alter table snapshots enable row level security;

-- Read only, and only for a project the caller can already see. There is no
-- insert, update or delete policy at all: the definer job is the only writer,
-- so a stored figure cannot be edited into agreeing with an argument.
create policy snapshots_select on snapshots for select to authenticated
using (can_see_project(project_id));

grant select on snapshots to authenticated;
