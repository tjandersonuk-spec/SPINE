-- Phase 10, part one -- change requests.
--
-- These belong to Phase 12 in the build order, but the Building Safety Act
-- classification hangs off them and cannot be built without them. So the record
-- lands here in the shape the notes give it, minus the money: `variation_id`
-- references fees(id), and fees is Phase 12's to create.
--
-- A change request holds no money of its own. It links to a variation, and the
-- money lives there -- so approving a change and agreeing its cost stay two
-- decisions, which is what stops one being read as the other.

create table change_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,
  title text not null check (btrim(title) <> ''),
  description text,
  reason text,
  category text,
  -- Party to party, in any direction: a consultant may raise one against the
  -- contractor as readily as the other way round.
  from_company_id uuid references companies(id) on delete set null,
  to_company_id uuid references companies(id) on delete set null,
  to_person_id uuid references project_people(id) on delete set null,
  raised_by uuid references profiles(id) on delete set null,
  status text not null default 'Draft'
    check (status in ('Draft','Submitted','Under review','Approved','Rejected',
                      'Withdrawn','Implemented','Closed')),
  origin_entity text,
  origin_id uuid,
  -- An EXPECTATION of impact, never a value. The figure lives on the variation.
  impact_scope text,
  impact_weeks int not null default 0,
  impact_cost text,
  impact_other text,
  -- Two dates, both off the programme: when a decision is due, and when the
  -- change takes effect. Both resolve through due_date() like everything else.
  decision_task_uid text,
  decision_offset_days int not null default 0,
  decision_anchor text not null default 'finish'
    check (decision_anchor in ('start','finish')),
  decision_date_override date,
  effective_task_uid text,
  effective_offset_days int not null default 0,
  effective_anchor text not null default 'finish'
    check (effective_anchor in ('start','finish')),
  effective_date_override date,
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  -- Both parties plus anyone named. The default for a change request, per the
  -- one visibility primitive.
  visibility jsonb not null default '{"mode":"project"}'::jsonb
    check (visibility_is_valid(visibility)),
  raised_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (project_id, reference),
  constraint change_request_decision_is_whole
    check ((decided_at is null) = (decided_by is null))
);
create index on change_requests (project_id, status);
create index on change_requests (project_id, decision_task_uid);

-- What an approval obliges somebody to amend.
--
-- Approval is not implementation. An approved request stays open until every
-- amendment it named is ticked off by name -- and an approval that named
-- nothing is flagged, because "approved, nothing to do" is almost always
-- somebody forgetting to list the consequences.
create table change_request_items (
  id uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references change_requests(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  description text not null check (btrim(description) <> ''),
  done_by uuid references profiles(id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  constraint change_request_item_done_is_whole
    check ((done_at is null) = (done_by is null))
);
create index on change_request_items (change_request_id);

create or replace function next_change_reference(p_project uuid)
returns text
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select next_reference(p_project, 'change', 'CHG');
$$;

revoke all on function next_change_reference(uuid) from public;
grant execute on function next_change_reference(uuid) to authenticated;
