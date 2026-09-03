-- Phase 12, part three -- the pre-construction fee budget.
--
-- Held apart from the appointed-fee tables on purpose. During pre-construction
-- nothing is appointed, so there is no company to hang a fee on and no
-- programme to date it from -- the two spines the rest of the app runs on do
-- not exist yet. Forcing it into `fees` would mean inventing company records
-- for consultants who may never be appointed.
--
-- It reads the discipline list and the directory rather than keeping copies of
-- them, and reaches into the live app exactly once, through
-- fees.budget_line_ids.

-- Who may see the pre-construction budget: the account's own staff, and
-- nobody else. Named once because three tables and two functions ask it.
--
-- Deliberately NOT can_write_project_setup(): that admits a project_admin,
-- and a project admin may be the very consultant who quoted into this. The
-- notes are explicit -- host only, and that includes the consultant who
-- submitted into it. A `client` role is excluded too: what the contractor
-- forecast for its own consultants is not the client's business.
create or replace function can_see_precon(p_project uuid)
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
      and is_account_staff(p.organisation_id));
$$;

grant execute on function can_see_precon(uuid) to authenticated;

create table precon_budget (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,
  category text not null check (category in ('consultant','survey','statutory')),
  -- Nullable, and meant to be: a survey maps to no discipline.
  discipline text,
  title text not null check (btrim(title) <> ''),
  -- Struck out, never deleted. Deleting a line loses the decision that it was
  -- not needed, which is precisely the thing somebody asks about at the cost
  -- report.
  required boolean not null default true,
  budget numeric(12,2) not null default 0,
  notes text,
  preferred_quote_id uuid,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, reference)
);
create index on precon_budget (project_id, category);

create table precon_quotes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  budget_line_id uuid not null references precon_budget(id) on delete cascade,
  -- Either a firm already in the directory, or a name typed in because they
  -- are not. Both are normal at this stage; one of the two must be there,
  -- because a quote from nobody is not a quote.
  company_id uuid references companies(id) on delete set null,
  supplier text,
  reference text,
  date_received date,
  base_value numeric(12,2) not null default 0,
  status text not null default 'Received'
    check (status in ('Received','Shortlisted','Rejected','Withdrawn')),
  notes text,
  created_at timestamptz not null default now(),
  constraint precon_quote_has_a_source
    check (company_id is not null or btrim(coalesce(supplier, '')) <> '')
);
create index on precon_quotes (budget_line_id);
create index on precon_quotes (project_id);

-- The adjustments are the point of the module.
--
-- Submissions are never like for like: one ground investigation prices twelve
-- boreholes against fourteen and excludes the interpretative report. The
-- adjustment records what is being levelled AND WHY, in words, so the
-- comparison can be defended six months later. The submitted figure is kept
-- alongside, because "what did they actually quote" is a different question
-- from "what is comparable".
--
-- The label is required by constraint. A plugged number with no explanation is
-- worse than no adjustment: it makes the comparison look considered while
-- destroying the ability to check it.
create table precon_quote_adjustments (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references precon_quotes(id) on delete cascade,
  label text not null check (btrim(label) <> ''),
  -- Signed: a negative deducts.
  value numeric(12,2) not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on precon_quote_adjustments (quote_id);

-- Circular, so it lands after both tables exist. The preferred quote must be
-- one of this line's own -- pointing at a quote against a different budget
-- line would make the forecast read from the wrong number.
create unique index precon_quotes_line_key on precon_quotes (id, budget_line_id);
alter table precon_budget
  add constraint precon_preferred_quote_is_on_this_line
    foreign key (preferred_quote_id, id) references precon_quotes (id, budget_line_id);

-- ---------------------------------------------------------- the derivations
--
-- The levelled figure is base + adjustments, summed on read. Never a column:
-- an adjustment added later must move the comparison, and a stored total is
-- how it silently does not.
create or replace view v_precon_quotes as
select
  q.*,
  coalesce((select c.name from companies c where c.id = q.company_id), q.supplier)
                                                        as source_name,
  coalesce((select sum(a.value) from precon_quote_adjustments a where a.quote_id = q.id), 0)
                                                        as adjustments,
  q.base_value
    + coalesce((select sum(a.value) from precon_quote_adjustments a where a.quote_id = q.id), 0)
                                                        as levelled_value,
  (select count(*)::int from precon_quote_adjustments a where a.quote_id = q.id)
                                                        as adjustment_count,
  exists (select 1 from precon_budget b where b.preferred_quote_id = q.id) as preferred
from precon_quotes q;

create or replace view v_precon_budget as
select
  b.*,
  (select count(*)::int from precon_quotes q where q.budget_line_id = b.id) as quotes,
  (select v.levelled_value from v_precon_quotes v where v.id = b.preferred_quote_id)
                                                        as preferred_value,
  (select v.source_name from v_precon_quotes v where v.id = b.preferred_quote_id)
                                                        as preferred_source,
  (select min(v.levelled_value) from v_precon_quotes v
    where v.budget_line_id = b.id and v.status <> 'Withdrawn') as lowest_levelled,
  -- The forecast for this line: the preferred quote where one has been chosen,
  -- otherwise the budget. Not the lowest quote -- choosing the cheapest by
  -- default is a decision, and this module exists so that decision is made by
  -- a person and recorded.
  coalesce(
    (select v.levelled_value from v_precon_quotes v where v.id = b.preferred_quote_id),
    b.budget)                                           as forecast,
  coalesce(
    (select v.levelled_value from v_precon_quotes v where v.id = b.preferred_quote_id),
    b.budget) - b.budget                                as variance,
  -- Which appointed fees name this line. The one thread outwards, read from
  -- the fee side so the budget keeps no copy of it.
  (select count(*)::int from fees f
    where f.project_id = b.project_id and b.id = any(f.budget_line_ids)) as appointed_fees,
  (select coalesce(sum(f.value), 0) from fees f
    where f.project_id = b.project_id and b.id = any(f.budget_line_ids)
      and f.status = 'Approved')                        as appointed_approved
from precon_budget b;

-- The totals. required = false drops a line from every one of them, which is
-- what a strike-out means.
create or replace function precon_totals(p_project uuid)
returns table (
  lines int,
  struck_out int,
  budget numeric,
  forecast numeric,
  variance numeric,
  quoted_lines int,
  awaiting_quotes int,
  undecided int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    count(*) filter (where required)::int,
    count(*) filter (where not required)::int,
    coalesce(sum(budget) filter (where required), 0),
    coalesce(sum(forecast) filter (where required), 0),
    coalesce(sum(forecast) filter (where required), 0)
      - coalesce(sum(budget) filter (where required), 0),
    count(*) filter (where required and quotes > 0)::int,
    count(*) filter (where required and quotes = 0)::int,
    -- Quotes in, nobody has picked one. The state the comparison exists for.
    count(*) filter (where required and quotes > 0 and preferred_quote_id is null)::int
  from v_precon_budget
  where project_id = p_project;
$$;

grant execute on function precon_totals(uuid) to authenticated;

-- Choosing the preferred quote. A definer function rather than a column write
-- so the choice is checked against the caller's role and against the quote
-- belonging to the line, with a sentence rather than a constraint name.
create or replace function set_preferred_quote(p_line uuid, p_quote uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_project uuid;
begin
  select project_id into v_project from precon_budget where id = p_line;
  if v_project is null then
    raise exception 'No such budget line' using errcode = 'P0002';
  end if;
  -- The whole module is the host's own, so this is the host's own decision.
  if not can_see_precon(v_project) then
    raise exception 'Not permitted to work the pre-construction budget on this project'
      using errcode = '42501';
  end if;
  if p_quote is not null and not exists (
    select 1 from precon_quotes q where q.id = p_quote and q.budget_line_id = p_line)
  then
    raise exception 'That quote is against a different budget line'
      using errcode = '22023';
  end if;
  update precon_budget set preferred_quote_id = p_quote where id = p_line;
end;
$$;

grant execute on function set_preferred_quote(uuid, uuid) to authenticated;
