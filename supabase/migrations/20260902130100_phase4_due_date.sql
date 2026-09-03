-- Phase 4 — the one date function, plus the derived programme reads.
--
-- The prototype computes a due date in at least four places (issueDue,
-- trackerDue, and two more inline), each an identical copy. Those copies are
-- the bug this function exists to prevent: the day one of them gains a rule the
-- others do not, two pages disagree about when something is due.
--
-- Every module from Phase 5 on stores the same four columns and calls this:
--     programme_task_uid text,
--     offset_days int not null default 0,
--     anchor text not null default 'finish' check (anchor in ('start','finish')),
--     due_date_override date

-- The signature takes the project, not just the uid. task_uid is unique only
-- per project, so a lookup by uid alone would resolve against another project's
-- programme -- the same fault drm_leads had before it was scoped.
create or replace function due_date(
  p_project uuid,
  p_task_uid text,
  p_offset_days int default 0,
  p_anchor text default 'finish',
  p_override date default null
) returns date
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  -- The override wins outright and is flagged in the UI wherever it is used:
  -- a typed date is an exception to the spine, so it must look like one.
  select case
    when p_override is not null then p_override
    when p_task_uid is null then null
    else (
      select case when p_anchor = 'start' then t.start_date else t.finish_date end
             + coalesce(p_offset_days, 0)
      -- Deliberately not filtered on `removed`: a line that has left the
      -- programme keeps resolving the date it last had, so a dependent shows a
      -- stale date and an orphan flag rather than blanking out.
      from programme_tasks t
      where t.project_id = p_project and t.task_uid = p_task_uid
    )
  end;
$$;

comment on function due_date(uuid, text, int, text, date) is
  'The only way a due date is ever computed. Never store the result.';

-- Whether an anchor still points at something. Three states, because they need
-- different fixes: the line was never there (a bad import mapping), or it has
-- left the programme (re-anchor or accept the slip).
create or replace function anchor_state(p_project uuid, p_task_uid text)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when p_task_uid is null then 'unanchored'
    when not exists (select 1 from programme_tasks t
                     where t.project_id = p_project and t.task_uid = p_task_uid)
      then 'missing'
    when exists (select 1 from programme_tasks t
                 where t.project_id = p_project and t.task_uid = p_task_uid and t.removed)
      then 'removed'
    else 'ok'
  end;
$$;

-- Roll-ups are computed, never stored. A summary line's dates are its leaf
-- descendants' extremes, and its progress is those leaves weighted by duration
-- -- so a summary cannot drift out of step with what sits under it.
create or replace view v_programme_rollup as
with recursive descendants as (
  select t.project_id, t.task_uid as root_uid, c.task_uid, c.start_date,
         c.finish_date, c.percent_complete, c.removed
  from programme_tasks t
  join programme_tasks c
    on c.project_id = t.project_id and c.parent_uid = t.task_uid
  where t.task_type = 'Summary'
  union all
  select d.project_id, d.root_uid, c.task_uid, c.start_date,
         c.finish_date, c.percent_complete, c.removed
  from descendants d
  join programme_tasks c
    on c.project_id = d.project_id and c.parent_uid = d.task_uid
)
select
  d.project_id,
  d.root_uid,
  min(d.start_date) as rolled_start,
  max(d.finish_date) as rolled_finish,
  round(sum((d.finish_date - d.start_date + 1) * d.percent_complete)::numeric
        / nullif(sum(d.finish_date - d.start_date + 1), 0)) as rolled_percent,
  count(*)::int as leaf_count
from descendants d
-- Only true leaves carry progress; counting a sub-summary as well would weigh
-- the same work twice.
where not exists (
  select 1 from programme_tasks k
  where k.project_id = d.project_id and k.parent_uid = d.task_uid)
  and not d.removed
group by d.project_id, d.root_uid;

-- Everything dated from one programme line. Each later phase adds its own
-- branch here as it gains the four anchor columns; the line inspector reads
-- this and nothing else, so a module cannot be dated from the programme
-- without appearing in the inspector.
--
-- Phase 4 has no dependents yet: no module stores an anchor until Phase 5. The
-- empty union branch is what later phases extend.
create or replace function programme_dependents(p_project uuid, p_task_uid text)
returns table (module text, record_id uuid, ref text, description text, due date)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select null::text, null::uuid, null::text, null::text, null::date
  where false;
$$;

comment on function programme_dependents(uuid, text) is
  'Everything anchored to a programme line. Each phase that adds the anchor '
  'columns to a table adds a union branch here in the same migration.';
