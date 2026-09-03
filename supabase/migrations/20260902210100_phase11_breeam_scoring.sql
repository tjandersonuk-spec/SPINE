-- Phase 11, part two -- the score, derived from end to end.
--
-- Every number here is computed on read. In particular the credits available
-- for a section are SUMMED FROM THE CREDIT ROWS and never taken from a stated
-- total: a tracker that states a section total in one place and lists the
-- credits in another will eventually disagree with itself, and then the score
-- has a denominator nobody can reconcile. A stated total is still recorded --
-- as a cross-check that is reported when it differs.

-- Which scheme is live. Falls back to the project's earliest, so a framework
-- becomes visible the moment it is loaded rather than after a second step.
create or replace function breeam_active_scheme(p_project uuid)
returns uuid
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.breeam_scheme_id from projects p
     where p.id = p_project
       and exists (select 1 from breeam_schemes s where s.id = p.breeam_scheme_id)),
    (select s.id from breeam_schemes s
     where s.project_id = p_project
     order by s.created_at, s.version limit 1));
$$;

grant execute on function breeam_active_scheme(uuid) to authenticated;

-- The weighting set in force. A scheme whose building_type names nothing falls
-- back to the first type it holds; a scheme with no types at all weights
-- everything zero, which is the honest answer to "what does an unweighted
-- framework score".
create or replace function breeam_active_type(p_scheme uuid)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when s.building_type is not null then s.building_type
    else s.building_types[1]
  end
  from breeam_schemes s where s.id = p_scheme;
$$;

grant execute on function breeam_active_type(uuid) to authenticated;

create or replace function breeam_weighting(p_scheme uuid, p_section text)
returns numeric
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    (s.weightings -> breeam_active_type(p_scheme) ->> p_section)::numeric, 0)
  from breeam_schemes s where s.id = p_scheme;
$$;

grant execute on function breeam_weighting(uuid, text) to authenticated;

-- The state a credit is shown in, in the prototype's own order of precedence:
-- not targeted, then verified, then an outstanding prerequisite, then
-- unassigned, then no date, then overdue, then due.
--
-- Unassigned is a gap and reads as one. It is the only place in this module
-- that hi-vis appears, and it appears for the same reason it does on the DRM
-- matrix: nobody has been given the work.
create or replace function breeam_credit_state(
  p_status text, p_is_prerequisite boolean, p_met boolean,
  p_company uuid, p_person uuid, p_due date
) returns table (state text, kind text)
language sql
stable
as $$
  select * from (values
    (case
       when p_status = 'Not targeted'              then 'Not targeted'
       when p_met                                  then 'Verified'
       when p_is_prerequisite and not p_met        then 'Outstanding'
       when p_company is null and p_person is null then 'Unassigned'
       when p_due is null                          then 'No date'
       when p_due < current_date                   then 'Overdue'
       when p_due - current_date <= 28             then 'Due in ' || (p_due - current_date) || 'd'
       else 'Due ' || to_char(p_due, 'DD Mon YYYY')
     end,
     case
       when p_status = 'Not targeted'              then 'neutral'
       when p_met                                  then 'ok'
       when p_is_prerequisite and not p_met        then 'stop'
       when p_company is null and p_person is null then 'gap'
       when p_due is null                          then 'warn'
       when p_due < current_date                   then 'stop'
       when p_due - current_date <= 28             then 'warn'
       else 'neutral'
     end)) as v(state, kind);
$$;

grant execute on function breeam_credit_state(text, boolean, boolean, uuid, uuid, date)
  to authenticated;

-- ------------------------------------------------------------ credit rows
--
-- One row per credit, with its state derived. A prerequisite carries no
-- credits by definition -- it is pass or fail -- so its available, targeted and
-- achieved are forced to zero here rather than trusted to be zero in the data.
create or replace view v_breeam_credits as
select
  t.id,
  t.project_id,
  t.breeam_issue_id                                     as issue_id,
  i.scheme_id,
  i.code                                                as issue_code,
  i.title                                               as issue_title,
  i.section,
  t.reference,
  t.title,
  t.prompt,
  t.status,
  t.required,
  t.company_id,
  t.person_id,
  t.discipline,
  coalesce((t.ext->>'is_prerequisite')::boolean, false)  as is_prerequisite,
  -- Verified is the one status that awards. Everything else, including
  -- "Evidence submitted", is work in progress: evidence the assessor has not
  -- accepted is not a credit.
  (t.status = 'Verified')                                as met,
  case when coalesce((t.ext->>'is_prerequisite')::boolean, false) then 0
       else coalesce((t.ext->>'credits_available')::numeric, 0) end as available,
  case when coalesce((t.ext->>'is_prerequisite')::boolean, false) then 0
       else coalesce((t.ext->>'credits_targeted')::numeric, 0) end  as targeted,
  case when coalesce((t.ext->>'is_prerequisite')::boolean, false) then 0
       else coalesce((t.ext->>'credits_achieved')::numeric, 0) end  as achieved,
  due_date(t.project_id, t.programme_task_uid, t.offset_days, t.anchor,
           t.due_date_override)                          as due,
  anchor_state(t.project_id, t.programme_task_uid)       as anchor_state,
  t.programme_task_uid,
  t.offset_days,
  t.anchor,
  t.due_date_override,
  t.ext,
  t.visibility,
  t.created_by,
  -- The state ladder, from the one function that knows it.
  st.state,
  st.kind                                               as state_kind
from tracked_items t
join breeam_issues i on i.id = t.breeam_issue_id
cross join lateral breeam_credit_state(
  t.status,
  coalesce((t.ext->>'is_prerequisite')::boolean, false),
  t.status = 'Verified',
  t.company_id, t.person_id,
  due_date(t.project_id, t.programme_task_uid, t.offset_days, t.anchor,
           t.due_date_override)) st
where t.kind = 'breeam';

-- ------------------------------------------------------------- issue rolls
--
-- An issue's totals come from its credit rows, and a prerequisite that is not
-- Verified BLOCKS THE WHOLE ISSUE. That is BREEAM's rule, and it is built into
-- the roll-up so the score cannot quietly count credits that would not be
-- awarded. `raw_achieved` and `at_risk` exist so the report can say which
-- prerequisite is costing what, rather than silently subtracting.
create or replace view v_breeam_issues as
select
  i.id,
  i.project_id,
  i.scheme_id,
  i.code,
  i.title,
  i.section,
  i.note,
  i.min_standards,
  coalesce(sum(c.available), 0)                                   as available,
  coalesce(sum(c.targeted), 0)                                    as targeted,
  coalesce(sum(c.achieved), 0)                                    as raw_achieved,
  count(*) filter (where c.is_prerequisite)::int                  as prerequisites,
  count(*) filter (where c.is_prerequisite and not c.met)::int     as blocking,
  case when count(*) filter (where c.is_prerequisite and not c.met) > 0
       then 0 else coalesce(sum(c.achieved), 0) end               as achieved,
  case when count(*) filter (where c.is_prerequisite and not c.met) > 0
       then coalesce(sum(c.achieved), 0) else 0 end               as at_risk,
  -- Named, not counted: "Ene 01 is blocked by the metering strategy" is a
  -- different sentence from "one prerequisite outstanding".
  coalesce(array_agg(c.title order by c.title)
           filter (where c.is_prerequisite and not c.met), '{}')  as blocked_by
from breeam_issues i
left join v_breeam_credits c on c.issue_id = i.id
group by i.id, i.project_id, i.scheme_id, i.code, i.title, i.section, i.note,
         i.min_standards;

-- ----------------------------------------------------------- section rolls
--
-- One row per section the scheme declares, with the credits summed from its
-- issues and the stated figure alongside as a cross-check. stated_gap is
-- non-zero exactly when the tracker disagrees with itself.
create or replace view v_breeam_sections as
select
  s.id                                             as scheme_id,
  s.project_id,
  sec->>'code'                                     as code,
  sec->>'name'                                     as name,
  (sec->>'stated')::numeric                        as stated,
  breeam_weighting(s.id, sec->>'code')             as weighting,
  coalesce(r.available, 0)                         as available,
  coalesce(r.targeted, 0)                          as targeted,
  coalesce(r.achieved, 0)                          as achieved,
  coalesce(r.at_risk, 0)                           as at_risk,
  case when (sec->>'stated') is null then null
       else coalesce(r.available, 0) - (sec->>'stated')::numeric end as stated_gap,
  case when coalesce(r.available, 0) = 0 then 0
       else r.targeted / r.available end           as pct_targeted,
  case when coalesce(r.available, 0) = 0 then 0
       else r.achieved / r.available end           as pct_achieved,
  case when coalesce(r.available, 0) = 0 then 0
       else (r.targeted / r.available) * breeam_weighting(s.id, sec->>'code') end
                                                   as score_targeted,
  case when coalesce(r.available, 0) = 0 then 0
       else (r.achieved / r.available) * breeam_weighting(s.id, sec->>'code') end
                                                   as score_achieved
from breeam_schemes s
cross join lateral jsonb_array_elements(s.sections) sec
left join lateral (
  select sum(v.available) as available, sum(v.targeted) as targeted,
         sum(v.achieved) as achieved, sum(v.at_risk) as at_risk
  from v_breeam_issues v
  where v.scheme_id = s.id and v.section = sec->>'code') r on true;

-- --------------------------------------------------------- minimum standards
--
-- For a rating, every issue that names a credit requirement must have that
-- many credits. Returns the issues that FAIL, so the report can say why a
-- rating is out of reach rather than printing FAIL in a column.
--
-- p_basis is 'targeted' or 'achieved': the same check run against what the
-- team is going for and against what the assessor has verified.
--
-- A minimum standard of ZERO credits with a note is a criterion, not a count,
-- and there is nothing in the data that decides it. The prototype failed such
-- a row unconditionally -- it tested a `met` flag nothing ever set -- which
-- made the achieved rating permanently unreachable on any scheme carrying one.
-- Here it fails only when the issue is blocked by an unmet prerequisite, which
-- is the part of it the data can answer; otherwise it is advisory and is
-- listed by breeam_advisory_standards() rather than capping a rating. A cap the
-- software cannot justify is worse than no cap, because it makes the number
-- stop meaning anything.
create or replace function breeam_min_standard_fails(
  p_scheme uuid, p_rating text, p_basis text default 'achieved'
) returns table (
  issue_id uuid, code text, title text, needed numeric, have numeric, note text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select v.id, v.code, v.title,
         coalesce((v.min_standards -> p_rating ->> 'credits')::numeric, 0),
         case when p_basis = 'targeted' then v.targeted else v.achieved end,
         coalesce(v.min_standards -> p_rating ->> 'note', '')
  from v_breeam_issues v
  where v.scheme_id = p_scheme
    and v.min_standards ? p_rating
    and (
      -- A credit requirement the issue does not meet.
      (coalesce((v.min_standards -> p_rating ->> 'credits')::numeric, 0) > 0
       and (case when p_basis = 'targeted' then v.targeted else v.achieved end)
             < coalesce((v.min_standards -> p_rating ->> 'credits')::numeric, 0))
      -- Or a zero-credit criterion on an issue a prerequisite is blocking.
      or (coalesce((v.min_standards -> p_rating ->> 'credits')::numeric, 0) = 0
          and v.blocking > 0))
  order by v.code;
$$;

grant execute on function breeam_min_standard_fails(uuid, text, text) to authenticated;

-- The zero-credit criteria that no figure can settle. Reported against the
-- rating so an assessor sees them, and deliberately not counted as failures.
create or replace function breeam_advisory_standards(p_scheme uuid, p_rating text)
returns table (issue_id uuid, code text, title text, note text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select v.id, v.code, v.title, coalesce(v.min_standards -> p_rating ->> 'note', '')
  from v_breeam_issues v
  where v.scheme_id = p_scheme
    and v.min_standards ? p_rating
    and coalesce((v.min_standards -> p_rating ->> 'credits')::numeric, 0) = 0
    and v.blocking = 0
  order by v.code;
$$;

grant execute on function breeam_advisory_standards(uuid, text) to authenticated;

-- ------------------------------------------------------------ the totals
--
-- The rating on score and the rating after minimum standards, side by side.
-- Showing both is the point: "82%, capped at Very Good by Ene 01" is a
-- different conversation from "Very Good".
create or replace function breeam_totals(p_project uuid, p_scheme uuid default null)
returns table (
  scheme_id uuid,
  building_type text,
  available numeric,
  targeted numeric,
  achieved numeric,
  at_risk numeric,
  score_targeted numeric,
  score_achieved numeric,
  weighting_total numeric,
  rating_targeted_on_score text,
  rating_achieved_on_score text,
  rating_targeted text,
  rating_achieved text,
  capped_targeted boolean,
  capped_achieved boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with sc as (
    select coalesce(p_scheme, breeam_active_scheme(p_project)) as id
  ),
  agg as (
    select sc.id,
           coalesce(sum(v.available), 0)      as available,
           coalesce(sum(v.targeted), 0)       as targeted,
           coalesce(sum(v.achieved), 0)       as achieved,
           coalesce(sum(v.at_risk), 0)        as at_risk,
           coalesce(sum(v.score_targeted), 0) as score_targeted,
           coalesce(sum(v.score_achieved), 0) as score_achieved,
           coalesce(sum(v.weighting), 0)      as weighting_total
    from sc left join v_breeam_sections v on v.scheme_id = sc.id
    group by sc.id
  ),
  -- Best first, so the first rating a project clears is the one it gets.
  r as (
    select e->>'name' as name, (e->>'min')::numeric as min
    from sc join breeam_schemes s on s.id = sc.id
    cross join lateral jsonb_array_elements(s.ratings) e
    order by (e->>'min')::numeric desc
  )
  select
    agg.id,
    breeam_active_type(agg.id),
    agg.available, agg.targeted, agg.achieved, agg.at_risk,
    agg.score_targeted, agg.score_achieved, agg.weighting_total,
    (select r.name from r where agg.score_targeted >= r.min limit 1),
    (select r.name from r where agg.score_achieved >= r.min limit 1),
    (select r.name from r
      where agg.score_targeted >= r.min
        and not exists (select 1 from breeam_min_standard_fails(agg.id, r.name, 'targeted'))
      limit 1),
    (select r.name from r
      where agg.score_achieved >= r.min
        and not exists (select 1 from breeam_min_standard_fails(agg.id, r.name, 'achieved'))
      limit 1),
    (select r.name from r where agg.score_targeted >= r.min limit 1) is distinct from
      (select r.name from r
        where agg.score_targeted >= r.min
          and not exists (select 1 from breeam_min_standard_fails(agg.id, r.name, 'targeted'))
        limit 1),
    (select r.name from r where agg.score_achieved >= r.min limit 1) is distinct from
      (select r.name from r
        where agg.score_achieved >= r.min
          and not exists (select 1 from breeam_min_standard_fails(agg.id, r.name, 'achieved'))
        limit 1)
  from agg
  where agg.id is not null;
$$;

grant execute on function breeam_totals(uuid, uuid) to authenticated;

-- ------------------------------------------------- Phase 9's view, extended
--
-- v_tracked_items decides "is this done" and "is this overdue" for every kind,
-- and BREEAM brings two statuses it did not know about. Verified is done.
-- Not targeted is not done, but it is not late either: nobody is going for it,
-- so chasing it as overdue would put a permanent red row on a tracker for a
-- credit the team has correctly decided to skip.
--
-- Dropped rather than replaced: the view selects t.*, and part one gave
-- tracked_items a new column, so CREATE OR REPLACE refuses to reorder what it
-- already returns. Only tracked_progress() reads it, and a function carries no
-- view dependency -- so the drop is safe and the grants are restated below.
drop view if exists v_tracked_items;
create view v_tracked_items as
select
  t.*,
  due_date(t.project_id, t.programme_task_uid, t.offset_days, t.anchor,
           t.due_date_override) as due,
  anchor_state(t.project_id, t.programme_task_uid) as anchor_state,
  (select c.name from companies c where c.id = t.company_id) as company_name,
  (select count(*)::int
   from companies c
   join company_disciplines cd on cd.company_id = c.id
   where c.project_id = t.project_id and cd.discipline_code = t.discipline) as holders,
  (t.status in ('Complete','Discharged','Approved','Approved with conditions',
                'Not required','Verified')) as is_done,
  (t.required
   and t.status not in ('Complete','Discharged','Approved','Approved with conditions',
                        'Not required','Verified','Not targeted')
   and due_date(t.project_id, t.programme_task_uid, t.offset_days, t.anchor,
                t.due_date_override) < current_date) as overdue,
  (t.response is not null and t.response_source = 'suggested') as awaiting_acceptance
from tracked_items t;

-- CREATE OR REPLACE VIEW keeps its options and its grants, but the three new
-- views need theirs stated. security_invoker on every one: a view that read
-- past RLS would hand a consultant a rival's credits through the score.
alter view v_tracked_items  set (security_invoker = on);
alter view v_breeam_credits set (security_invoker = on);
alter view v_breeam_issues  set (security_invoker = on);
alter view v_breeam_sections set (security_invoker = on);
grant select on v_tracked_items  to authenticated;
grant select on v_breeam_credits to authenticated;
grant select on v_breeam_issues  to authenticated;
grant select on v_breeam_sections to authenticated;
