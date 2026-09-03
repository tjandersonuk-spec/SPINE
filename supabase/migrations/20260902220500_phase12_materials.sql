-- Phase 12, part six -- material samples.
--
-- A submission HISTORY, not a single decision. Every round is a row and no row
-- is ever overwritten once decided, which is what makes "was this rejected
-- before?" answerable months later without anybody having deliberately kept a
-- paper trail. The trail is just what the table already is.

create table materials (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,
  title text not null check (btrim(title) <> ''),
  spec text,
  location text,
  company_id uuid references companies(id) on delete set null,
  -- The directory row, matching how issues and tracked items name a person.
  person_id uuid references project_people(id) on delete set null,
  programme_task_uid text,
  offset_days int not null default 0,
  anchor text not null default 'finish' check (anchor in ('start','finish')),
  due_date_override date,
  required boolean not null default true,
  custom boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, reference)
);
create index on materials (project_id, company_id);
create index on materials (project_id, programme_task_uid);

create table material_submissions (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials(id) on delete cascade,
  round int not null check (round > 0),
  submitted_at date not null default current_date,
  sample_reference text,
  decision text not null default 'Pending'
    check (decision in ('Pending','Approved','Approved as noted','Rejected','Withdrawn')),
  -- Who decided, and when. Outside the update grant: a decision somebody else
  -- can rewrite is not a record of a decision.
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  comments text,
  submitted_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (material_id, round),
  constraint submission_decision_is_whole
    check ((decision = 'Pending') = (decided_at is null)),
  constraint submission_decider_is_whole
    check ((decided_at is null) = (decided_by is null))
);
create index on material_submissions (material_id, round);

-- A DECIDED ROUND IS FROZEN. A new round is a new row; a correction is a new
-- round too, because a rejection that can be edited away after a later
-- approval is exactly the record this table exists to keep.
create or replace function material_submission_is_frozen()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.decision <> 'Pending' then
    raise exception
      'Round % has already been decided (%). A new round is a new row.',
      old.round, old.decision
      using errcode = '42501';
  end if;
  -- Even while pending, the round number and what was submitted are facts.
  if new.round <> old.round or new.material_id <> old.material_id then
    raise exception 'A submission cannot be moved to another round or material'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger material_submissions_frozen
  before update on material_submissions
  for each row execute function material_submission_is_frozen();

-- Deletion is closed off by the GRANT rather than by a trigger, following the
-- transmittal precedent: no role holds delete on this table, so a round cannot
-- be removed to tidy away a rejection. See part eight.

-- Who may decide a sample: the design manager.
--
-- Same shape as the Building Safety Act classification guard -- enforced at
-- the policy and function level, never by hiding the control, because a
-- synthetic POST from a consultant approving their own sample must be refused
-- by the database.
create or replace function can_decide_material(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from projects p
    where p.id = p_project
      and account_is_live(p.organisation_id)
      and (is_account_admin(p.organisation_id) or is_project_admin(p.id)));
$$;

grant execute on function can_decide_material(uuid) to authenticated;

-- Submitting a round. The round number is the database's to allocate: two
-- people submitting at once must not both become round 3.
create or replace function submit_material_round(
  p_material uuid, p_sample_reference text default null, p_comments text default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_project uuid; v_round int; v_id uuid;
begin
  select project_id into v_project from materials where id = p_material;
  if v_project is null or not can_see_project(v_project) then
    raise exception 'No such material' using errcode = 'P0002';
  end if;
  -- Lock the parent so the round number is allocated once.
  perform 1 from materials where id = p_material for update;
  if exists (select 1 from material_submissions
              where material_id = p_material and decision = 'Pending') then
    raise exception 'A round is already awaiting a decision on this sample'
      using errcode = '22023';
  end if;
  select coalesce(max(round), 0) + 1 into v_round
    from material_submissions where material_id = p_material;
  insert into material_submissions (
    material_id, round, sample_reference, comments, submitted_by)
  values (p_material, v_round, p_sample_reference, p_comments, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function submit_material_round(uuid, text, text) to authenticated;

create or replace function decide_material_round(
  p_submission uuid, p_decision text, p_comments text default null
) returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_project uuid; v_current text;
begin
  select m.project_id, s.decision into v_project, v_current
    from material_submissions s
    join materials m on m.id = s.material_id
   where s.id = p_submission;
  if v_project is null then
    raise exception 'No such submission' using errcode = 'P0002';
  end if;
  if not can_decide_material(v_project) then
    raise exception 'Only the design manager may decide a material sample'
      using errcode = '42501';
  end if;
  if v_current <> 'Pending' then
    raise exception 'That round was already decided (%). A new round is a new row.',
      v_current using errcode = '42501';
  end if;
  if p_decision not in ('Approved','Approved as noted','Rejected','Withdrawn') then
    raise exception 'Unknown decision: %', p_decision using errcode = '22023';
  end if;
  update material_submissions
     set decision = p_decision, decided_by = auth.uid(), decided_at = now(),
         comments = coalesce(p_comments, comments)
   where id = p_submission;
end;
$$;

grant execute on function decide_material_round(uuid, text, text) to authenticated;

-- --------------------------------------------------------- the derivations
--
-- The current position is the latest round; the HISTORY is every round, and
-- `was_rejected` is what a later approval must not be allowed to hide.
create or replace view v_materials as
select
  m.*,
  due_date(m.project_id, m.programme_task_uid, m.offset_days, m.anchor,
           m.due_date_override)                       as due,
  anchor_state(m.project_id, m.programme_task_uid)    as anchor_state,
  (select c.name from companies c where c.id = m.company_id) as company_name,
  (select count(*)::int from material_submissions s where s.material_id = m.id)
                                                      as rounds,
  (select s.decision from material_submissions s
    where s.material_id = m.id order by s.round desc limit 1) as decision,
  (select s.round from material_submissions s
    where s.material_id = m.id order by s.round desc limit 1) as latest_round,
  (select s.submitted_at from material_submissions s
    where s.material_id = m.id order by s.round desc limit 1) as latest_submitted_at,
  exists (select 1 from material_submissions s
           where s.material_id = m.id and s.decision = 'Pending') as awaiting_decision,
  -- A rejection stays on the record after a later approval. This is the whole
  -- reason the table is a history: "has this ever come back?" is the question
  -- somebody asks at handover.
  exists (select 1 from material_submissions s
           where s.material_id = m.id and s.decision = 'Rejected') as was_rejected,
  (select count(*)::int from material_submissions s
    where s.material_id = m.id and s.decision = 'Rejected')  as rejections,
  ((select s.decision from material_submissions s
     where s.material_id = m.id order by s.round desc limit 1)
    in ('Approved','Approved as noted'))              as is_done,
  (m.required
   and coalesce((select s.decision from material_submissions s
                  where s.material_id = m.id order by s.round desc limit 1), 'Pending')
       not in ('Approved','Approved as noted')
   and due_date(m.project_id, m.programme_task_uid, m.offset_days, m.anchor,
                m.due_date_override) < current_date)   as overdue
from materials m;

create or replace function material_totals(p_project uuid)
returns table (
  total int, approved int, awaiting int, overdue int,
  ever_rejected int, struck_out int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    count(*) filter (where required)::int,
    count(*) filter (where required and is_done)::int,
    count(*) filter (where required and awaiting_decision)::int,
    count(*) filter (where overdue)::int,
    count(*) filter (where required and was_rejected)::int,
    count(*) filter (where not required)::int
  from v_materials where project_id = p_project;
$$;

grant execute on function material_totals(uuid) to authenticated;
