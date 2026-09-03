-- Phase 12, part one -- fees, the payment schedule and invoices.
--
-- The most commercially sensitive tables in the product, and the RLS on them
-- (part eight) is the sharpest: a consultant sees rows for their own company
-- tree and nothing else, because a CSV that bypasses the policy is how a
-- consultant learns what a competitor is charging.
--
-- Every figure here EXCLUDES VAT and is GBP. Said once, in the column comment,
-- rather than in a label somebody eventually changes.

create table fees (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  -- A fee belongs to a company, not a discipline. This is the second
  -- deliberate exception to the discipline rule (the first is a risk owner):
  -- an appointment is a contract with a firm, and the money owed under it is
  -- owed to that firm whatever disciplines it happens to hold.
  company_id uuid not null references companies(id) on delete cascade,
  reference text not null,
  kind text not null check (kind in ('fee','variation')),
  description text,
  value numeric(12,2) not null,
  date_submitted date,
  date_approved date,
  status text not null default 'Proposed'
    check (status in ('Proposed','Approved','Rejected')),
  -- The one thread outwards from the pre-construction budget: which budget
  -- line or lines this appointment came from. It answers "is the fee inside
  -- the original forecast" and nothing else.
  budget_line_ids uuid[] not null default '{}',
  raised_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, reference),
  -- An approved fee has an approval date, and only an approved fee has one.
  constraint fee_approval_is_whole
    check ((status = 'Approved') = (date_approved is not null))
);
create index on fees (project_id, company_id);
create index on fees (project_id, kind, status);

-- The negotiated payment schedule.
--
-- Not reference data: it is a document two parties argue about, so it carries
-- a status and a record of who agreed it and when. Agreement is a STORED fact
-- because it records a decision somebody made; the due date, the invoiced
-- position and the schedule-versus-fee mismatch stay derived. Store decisions,
-- derive consequences.
create table payment_schedule (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  reference text not null,
  description text,
  value numeric(12,2) not null,
  -- The four anchor columns. No instalment date is ever stored: a consultant's
  -- cashflow that does not move when the job moves is worse than no cashflow.
  programme_task_uid text,
  offset_days int not null default 0,
  anchor text not null default 'finish' check (anchor in ('start','finish')),
  due_date_override date,
  status text not null default 'Proposed' check (status in ('Proposed','Agreed')),
  agreed_by uuid references profiles(id) on delete set null,
  agreed_at date,
  created_at timestamptz not null default now(),
  unique (project_id, reference),
  -- Agreed by nobody at no time is not an agreement.
  constraint schedule_agreement_is_whole
    check ((status = 'Agreed') = (agreed_by is not null and agreed_at is not null))
);
create index on payment_schedule (project_id, company_id);
create index on payment_schedule (project_id, programme_task_uid);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  -- Which instalment this claims. Nullable, because an invoice that maps to no
  -- instalment is a real and reportable state rather than an error.
  schedule_id uuid references payment_schedule(id) on delete set null,
  reference text not null,
  value numeric(12,2) not null,
  date_submitted date not null,
  date_paid date,
  status text not null default 'Submitted'
    check (status in ('Submitted','Certified','Paid','Disputed')),
  certified_by uuid references profiles(id) on delete set null,
  certified_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  unique (project_id, reference),
  -- Paid means there is a date it was paid on.
  constraint invoice_paid_is_whole
    check ((status = 'Paid') = (date_paid is not null)),
  constraint invoice_certification_is_whole
    check ((certified_at is null) = (certified_by is null))
);
create index on invoices (project_id, company_id);
create index on invoices (schedule_id);

-- An instalment belongs to the same company as the invoice claiming it.
-- Without this a consultant's invoice could be mapped to a rival's instalment,
-- and the mismatch view would then quietly balance.
create unique index payment_schedule_company_key on payment_schedule (id, company_id);
alter table invoices
  add constraint invoice_schedule_matches_company
    foreign key (schedule_id, company_id) references payment_schedule (id, company_id);

-- ------------------------------------------------- the change request's money
--
-- Phase 10 built change_requests without this column because it references
-- fees, which is this phase's to create. A change request holds no money of
-- its own and never gains a value column: anything with a figure attaches
-- here, so approving a change and agreeing its cost stay two decisions.
alter table change_requests
  add column variation_id uuid references fees(id) on delete set null;

-- The variation named by a change request is a variation, not a base fee.
create or replace function fee_is_variation(p_fee uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_fee is null or exists (
    select 1 from fees f where f.id = p_fee and f.kind = 'variation');
$$;

alter table change_requests
  add constraint change_request_variation_is_a_variation
    check (fee_is_variation(variation_id));

grant execute on function fee_is_variation(uuid) to authenticated;
