-- Phase 12, part four -- the risk and opportunity register.
--
-- Two things here break rules that hold everywhere else, both deliberately.

-- The likelihood bands. Stated rather than typed, so that two people in a
-- workshop mean the same thing by "likely".
create or replace function risk_likelihood_pct(p_likelihood int)
returns numeric
language sql
immutable
as $$
  select case p_likelihood
    when 1 then 0.10 when 2 then 0.25 when 3 then 0.50
    when 4 then 0.75 when 5 then 0.90 else 0 end::numeric;
$$;

create or replace function risk_likelihood_name(p_likelihood int)
returns text
language sql
immutable
as $$
  select case p_likelihood
    when 1 then 'Rare' when 2 then 'Unlikely' when 3 then 'Possible'
    when 4 then 'Likely' when 5 then 'Almost certain' else '—' end;
$$;

-- The impact band is DERIVED FROM THE COST, never chosen.
--
-- This removes the commonest argument in a risk workshop, where two people
-- score the same eighty-thousand-pound item differently and the register loses
-- its ordering. Absolute value, because an opportunity's impact is a saving
-- and a saving of eighty thousand is just as significant.
create or replace function risk_impact_band(p_cost numeric)
returns int
language sql
immutable
as $$
  select case
    when abs(coalesce(p_cost, 0)) >= 500000 then 5
    when abs(coalesce(p_cost, 0)) >= 150000 then 4
    when abs(coalesce(p_cost, 0)) >= 50000  then 3
    when abs(coalesce(p_cost, 0)) >= 10000  then 2
    else 1 end;
$$;

create or replace function risk_impact_name(p_band int)
returns text
language sql
immutable
as $$
  select case p_band
    when 1 then 'Minor' when 2 then 'Moderate' when 3 then 'Significant'
    when 4 then 'Major' when 5 then 'Severe' else '—' end;
$$;

-- The status lists, and which of each means the item is finished. A risk and
-- an opportunity are the same record with different vocabulary; naming the
-- lists in the database is what stops the browser and the report disagreeing
-- about whether "Avoided" still counts.
create or replace function risk_statuses(p_kind text)
returns text[]
language sql
immutable
as $$
  select case p_kind
    when 'opportunity'
      then array['Identified','Under review','Accepted','Implemented','Rejected']
    else array['Open','Mitigating','Realised','Avoided','Closed'] end;
$$;

create or replace function risk_done_statuses(p_kind text)
returns text[]
language sql
immutable
as $$
  select case p_kind
    when 'opportunity' then array['Implemented','Rejected']
    else array['Avoided','Closed'] end;
$$;

grant execute on function risk_likelihood_pct(int) to authenticated;
grant execute on function risk_likelihood_name(int) to authenticated;
grant execute on function risk_impact_band(numeric) to authenticated;
grant execute on function risk_impact_name(int) to authenticated;
grant execute on function risk_statuses(text) to authenticated;
grant execute on function risk_done_statuses(text) to authenticated;

create table risks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,
  kind text not null check (kind in ('risk','opportunity')),
  title text not null check (btrim(title) <> ''),
  description text,
  mitigation text,
  category text,
  -- THE OWNER IS A PERSON, NOT A DISCIPLINE, and this is the one place in the
  -- product where that is right. Everywhere else the app assigns to a
  -- discipline, because responsibility for producing information is a matter
  -- of appointment. A live risk is not: it is somebody personally chasing
  -- something down, and a risk owned by "structures" is a risk nobody is
  -- holding. Do not "fix" this for consistency.
  --
  -- profiles, not project_people: can_see() compares the owner against
  -- auth.uid(), so a directory row with no login behind it cannot own a risk
  -- and be able to see it.
  person_id uuid references profiles(id) on delete set null,
  likelihood int not null default 3 check (likelihood between 1 and 5),
  -- Excluding VAT, GBP. On an opportunity this is a saving.
  impact_cost numeric(12,2) not null default 0,
  impact_weeks int not null default 0,
  status text not null default 'Open',
  -- The review date, off the programme like every other date.
  programme_task_uid text,
  offset_days int not null default 0,
  anchor text not null default 'finish' check (anchor in ('start','finish')),
  due_date_override date,
  -- Set when the risk is realised: it points at the task it became, and does
  -- not get an action list of its own.
  issue_id uuid references issues(id) on delete set null,
  -- CLOSED BY DEFAULT, and this is the inverse of the task list. On a task an
  -- empty audience means the whole project; on a risk it means nobody but the
  -- raiser, the owner and whoever is named -- because a costed risk is a
  -- commercial position long before it is a shared one.
  visibility jsonb not null default '{"mode":"named","people":[]}'::jsonb
    check (visibility_is_valid(visibility)),
  template_id uuid,
  raised_by uuid references profiles(id) on delete set null,
  raised_at timestamptz not null default now(),
  closed_at date,
  unique (project_id, reference),
  constraint risk_status_is_known check (status = any(risk_statuses(kind))),
  -- Realised means there is a task carrying it.
  constraint risk_realised_has_a_task
    check (status <> 'Realised' or issue_id is not null)
);
create index on risks (project_id, kind, status);
create index on risks (project_id, person_id);
create index on risks (project_id, programme_task_uid);

-- The template library. Same fork-on-creation pattern as every other
-- template: a null organisation_id is the published default.
create table risk_templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) on delete cascade,
  reference text not null,
  kind text not null check (kind in ('risk','opportunity')),
  title text not null check (btrim(title) <> ''),
  description text,
  category text,
  likelihood int not null default 3 check (likelihood between 1 and 5),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (organisation_id, reference)
);
create index on risk_templates (organisation_id, kind);

-- --------------------------------------------------------- the derivations
--
-- NOTHING ABOUT EXPOSURE IS STORED. The percentage, the band, the score and
-- the expected value are all computed here, and a finished item's expected
-- value is zero because it is no longer exposure.
create or replace view v_risks as
select
  r.*,
  risk_likelihood_pct(r.likelihood)                   as likelihood_pct,
  risk_likelihood_name(r.likelihood)                  as likelihood_name,
  risk_impact_band(r.impact_cost)                     as band,
  risk_impact_name(risk_impact_band(r.impact_cost))   as band_name,
  r.likelihood * risk_impact_band(r.impact_cost)      as score,
  (r.status = any(risk_done_statuses(r.kind)))        as done,
  case when r.status = any(risk_done_statuses(r.kind)) then 0
       else round(r.impact_cost * risk_likelihood_pct(r.likelihood), 2) end
                                                      as expected_value,
  due_date(r.project_id, r.programme_task_uid, r.offset_days, r.anchor,
           r.due_date_override)                       as review_due,
  anchor_state(r.project_id, r.programme_task_uid)    as anchor_state,
  (select p.name from profiles p where p.id = r.person_id) as owner_name,
  (select i.reference from issues i where i.id = r.issue_id) as issue_reference,
  -- The state ladder, in the prototype's own order of precedence. Unowned is
  -- a gap and reads as one: a costed risk nobody is holding is the finding.
  case
    when r.status = any(risk_done_statuses(r.kind))  then r.status
    when r.status = 'Realised'                        then 'Realised'
    when r.person_id is null                          then 'Unowned'
    when due_date(r.project_id, r.programme_task_uid, r.offset_days, r.anchor,
                  r.due_date_override) is null        then 'No review date'
    when due_date(r.project_id, r.programme_task_uid, r.offset_days, r.anchor,
                  r.due_date_override) < current_date then 'Review overdue'
    else 'Review ' || to_char(due_date(r.project_id, r.programme_task_uid,
            r.offset_days, r.anchor, r.due_date_override), 'DD Mon YYYY')
  end                                                 as state,
  case
    when r.status = 'Rejected'                        then 'neutral'
    when r.status = any(risk_done_statuses(r.kind))   then 'ok'
    when r.status = 'Realised'                        then 'stop'
    when r.person_id is null                          then 'gap'
    when due_date(r.project_id, r.programme_task_uid, r.offset_days, r.anchor,
                  r.due_date_override) is null        then 'warn'
    when due_date(r.project_id, r.programme_task_uid, r.offset_days, r.anchor,
                  r.due_date_override) < current_date then 'stop'
    when due_date(r.project_id, r.programme_task_uid, r.offset_days, r.anchor,
                  r.due_date_override) - current_date <= 28 then 'warn'
    else 'neutral'
  end                                                 as state_kind
from risks r;

-- The summary. EXPECTED VALUE, always.
--
-- `gross` is returned because a page that only ever shows expected value
-- invites somebody to compute the raw total themselves and get it wrong; it is
-- returned so it can be labelled as what it is -- what everything would cost
-- if it all happened -- and never as exposure. Adding up raw impacts and
-- calling that exposure is how a risk report stops being believed.
create or replace function risk_totals(p_project uuid, p_kind text default 'risk')
returns table (
  live int,
  finished int,
  gross numeric,
  expected numeric,
  unowned int,
  review_overdue int,
  realised int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    count(*) filter (where not done)::int,
    count(*) filter (where done)::int,
    coalesce(sum(impact_cost) filter (where not done), 0),
    coalesce(sum(expected_value) filter (where not done), 0),
    count(*) filter (where not done and person_id is null)::int,
    count(*) filter (where not done and state = 'Review overdue')::int,
    count(*) filter (where status = 'Realised')::int
  from v_risks
  where project_id = p_project and kind = p_kind;
$$;

grant execute on function risk_totals(uuid, text) to authenticated;

-- The five-by-five grid of live items.
--
-- The one view that makes a register argue with itself: a cluster in the top
-- right that nobody owns is the report. Returns every cell, including the
-- empty ones, because a grid with holes in it cannot be read as a grid.
create or replace function risk_matrix(p_project uuid, p_kind text default 'risk')
returns table (likelihood int, band int, items int, unowned int, expected numeric)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select l.n, b.n,
         count(r.id)::int,
         count(r.id) filter (where r.person_id is null)::int,
         coalesce(sum(r.expected_value), 0)
  from generate_series(1,5) l(n)
  cross join generate_series(1,5) b(n)
  left join v_risks r
    on r.project_id = p_project and r.kind = p_kind and not r.done
   and r.likelihood = l.n and r.band = b.n
  group by l.n, b.n
  order by l.n desc, b.n;
$$;

grant execute on function risk_matrix(uuid, text) to authenticated;

-- ------------------------------------------------------------ realisation
--
-- A REALISED RISK BECOMES A TASK, not a second thing to chase. One row in
-- issues, the risk's audience copied across, a priority derived from the
-- score, and the risk keeps its own record and points at the task. It does not
-- get an action list of its own -- that is the parallel-table problem this
-- product exists to remove.
create or replace function realise_risk(p_risk uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_issue uuid;
  v_person uuid;
begin
  select * into r from risks where id = p_risk;
  if r.id is null or not can_see(r.project_id, r.visibility, r.raised_by, r.person_id) then
    raise exception 'No such risk' using errcode = 'P0002';
  end if;
  if r.issue_id is not null then
    -- Already realised. Idempotent rather than an error: two people pressing
    -- the same button must not produce two tasks for one risk.
    return r.issue_id;
  end if;
  if r.kind <> 'risk' then
    raise exception 'An opportunity is implemented, not realised'
      using errcode = '22023';
  end if;

  -- The owner is a profile; a task names a directory row. Where the owner has
  -- a directory entry on this project the task inherits it, and where they do
  -- not the task starts unassigned rather than pointing at nobody.
  select pp.id into v_person from project_people pp
   where pp.project_id = r.project_id and pp.profile_id = r.person_id;

  insert into issues (
    project_id, reference, title, description, category, person_id,
    programme_task_uid, offset_days, anchor, due_date_override,
    -- Score is 1..25; priority is 0..100. A five-by-five item arrives at the
    -- top of the queue, which is the point of realising it.
    priority, source_kind, origin_entity, origin_id, visibility, raised_by)
  values (
    r.project_id,
    next_reference(r.project_id, 'TSK', 'TSK'),
    r.title,
    coalesce(r.description, '') ||
      case when coalesce(r.mitigation, '') = '' then ''
           else E'\n\nMitigation as recorded on the risk: ' || r.mitigation end,
    r.category, v_person,
    r.programme_task_uid, r.offset_days, r.anchor, r.due_date_override,
    least(100, greatest(0, (r.likelihood * risk_impact_band(r.impact_cost)) * 4)),
    'irs', 'risk', r.id, r.visibility, auth.uid())
  returning id into v_issue;

  update risks set status = 'Realised', issue_id = v_issue where id = p_risk;
  return v_issue;
end;
$$;

grant execute on function realise_risk(uuid) to authenticated;

-- Loading the library.
--
-- It never sets an owner, a review date, or a likelihood beyond the template's
-- own -- those are project-specific judgements, and a loader that guessed them
-- would be inventing a decision somebody has to be accountable for. It only
-- saves retyping a recognisable risk from a blank page. Skip on title match,
-- like every other template loader here.
create or replace function load_risk_library(p_project uuid, p_kind text default null)
returns table (added int, skipped int)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_added int := 0;
  v_skipped int := 0;
  t record;
begin
  select organisation_id into v_org from projects where id = p_project;
  if v_org is null or not can_write_project_setup(p_project) then
    raise exception 'Not permitted to load the risk library on this project'
      using errcode = '42501';
  end if;

  for t in
    select * from risk_templates
     where (organisation_id = v_org
            or (organisation_id is null
                and not exists (select 1 from risk_templates f
                                 where f.organisation_id = v_org)))
       and (p_kind is null or kind = p_kind)
     order by sort_order, reference
  loop
    if exists (select 1 from risks x
                where x.project_id = p_project
                  and lower(x.title) = lower(t.title)) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into risks (
      project_id, reference, kind, title, description, category, likelihood,
      status, template_id, raised_by)
    values (
      p_project,
      next_reference(p_project, case when t.kind = 'opportunity' then 'OPP' else 'RSK' end,
                     case when t.kind = 'opportunity' then 'OPP' else 'RSK' end),
      t.kind, t.title, t.description, t.category, t.likelihood,
      case when t.kind = 'opportunity' then 'Identified' else 'Open' end,
      t.id, auth.uid());
    v_added := v_added + 1;
  end loop;

  return query select v_added, v_skipped;
end;
$$;

grant execute on function load_risk_library(uuid, text) to authenticated;
