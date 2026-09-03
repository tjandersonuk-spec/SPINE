-- Phase 12, part two -- the commercial derivations.
--
-- Nothing here is a stored column. The instalment dates come off the
-- programme, the invoiced position is summed on read, and both silent checks
-- -- an instalment past due with nothing claimed against it, and a schedule
-- that does not add up to the approved fee -- are views, because neither
-- announces itself.

-- The instalment, dated. `invoiced` is what has been claimed against it in
-- total, so a part-claim is visible as a part-claim rather than as done.
create or replace view v_payment_schedule as
select
  s.*,
  due_date(s.project_id, s.programme_task_uid, s.offset_days, s.anchor,
           s.due_date_override)                       as due,
  anchor_state(s.project_id, s.programme_task_uid)    as anchor_state,
  (select c.name from companies c where c.id = s.company_id) as company_name,
  coalesce((select sum(i.value) from invoices i where i.schedule_id = s.id), 0)
                                                      as invoiced,
  exists (select 1 from invoices i where i.schedule_id = s.id) as has_invoice,
  -- The first silent check: the date has passed and nobody has claimed it.
  -- A consultant who has not invoiced is not necessarily owed nothing, but it
  -- is always worth asking, and nothing else on the page would ever say so.
  (not exists (select 1 from invoices i where i.schedule_id = s.id)
   and due_date(s.project_id, s.programme_task_uid, s.offset_days, s.anchor,
                s.due_date_override) < current_date)  as due_uninvoiced
from payment_schedule s;

-- The invoice, with what it is claiming against and whether anybody can
-- produce the application later.
--
-- That last flag is close to load-bearing: certifying against an application
-- nobody can find afterwards is how payment disputes are lost, so an invoice
-- with no document held is flagged rather than merely lacking one.
create or replace view v_invoices as
select
  i.*,
  (select c.name from companies c where c.id = i.company_id) as company_name,
  (select s.reference from payment_schedule s where s.id = i.schedule_id)
                                                      as schedule_reference,
  exists (select 1 from evidence e
          where e.entity_type = 'invoice' and e.entity_id = i.id) as has_document,
  (i.status <> 'Paid' and i.date_submitted < current_date - 30) as outstanding_30d,
  (current_date - i.date_submitted)                   as days_submitted
from invoices i;

-- The position per company.
--
-- Proposed and approved are NEVER added together. A fee report that mixes them
-- looks overspent and stops being believed, so every figure here is one or the
-- other and the page shows both.
create or replace function fee_position(p_project uuid)
returns table (
  company_id uuid,
  company_name text,
  fee_proposed numeric,
  fee_approved numeric,
  variations_proposed numeric,
  variations_approved numeric,
  approved_total numeric,
  scheduled numeric,
  scheduled_agreed numeric,
  scheduled_proposed numeric,
  invoiced numeric,
  certified numeric,
  paid numeric,
  -- The second silent check: the schedule does not add up to the approved
  -- fee. Almost always an approved variation nobody added to the schedule.
  schedule_gap numeric,
  instalments int,
  instalments_unagreed int,
  due_uninvoiced int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with co as (
    select c.id, c.name from companies c where c.project_id = p_project
  ),
  f as (
    select company_id,
           sum(value) filter (where kind = 'fee' and status = 'Proposed')       as fee_p,
           sum(value) filter (where kind = 'fee' and status = 'Approved')       as fee_a,
           sum(value) filter (where kind = 'variation' and status = 'Proposed') as var_p,
           sum(value) filter (where kind = 'variation' and status = 'Approved') as var_a
    from fees where project_id = p_project group by company_id
  ),
  s as (
    select company_id,
           sum(value)                                        as total,
           sum(value) filter (where status = 'Agreed')        as agreed,
           sum(value) filter (where status = 'Proposed')      as proposed,
           count(*)::int                                      as n,
           count(*) filter (where status = 'Proposed')::int    as n_unagreed
    from payment_schedule where project_id = p_project group by company_id
  ),
  u as (
    select company_id, count(*)::int as n
    from v_payment_schedule where project_id = p_project and due_uninvoiced
    group by company_id
  ),
  v as (
    select company_id,
           sum(value)                                                   as invoiced,
           sum(value) filter (where status in ('Certified','Paid'))      as certified,
           sum(value) filter (where status = 'Paid')                     as paid
    from invoices where project_id = p_project group by company_id
  )
  select
    co.id, co.name,
    coalesce(f.fee_p, 0), coalesce(f.fee_a, 0),
    coalesce(f.var_p, 0), coalesce(f.var_a, 0),
    coalesce(f.fee_a, 0) + coalesce(f.var_a, 0),
    coalesce(s.total, 0), coalesce(s.agreed, 0), coalesce(s.proposed, 0),
    coalesce(v.invoiced, 0), coalesce(v.certified, 0), coalesce(v.paid, 0),
    coalesce(s.total, 0) - (coalesce(f.fee_a, 0) + coalesce(f.var_a, 0)),
    coalesce(s.n, 0), coalesce(s.n_unagreed, 0), coalesce(u.n, 0)
  from co
  left join f on f.company_id = co.id
  left join s on s.company_id = co.id
  left join u on u.company_id = co.id
  left join v on v.company_id = co.id
  -- A company with no commercial rows at all is not part of the fee report.
  where f.company_id is not null or s.company_id is not null or v.company_id is not null
  order by co.name;
$$;

grant execute on function fee_position(uuid) to authenticated;

-- The cashflow curve.
--
-- One row per month that has anything in it, planned against actual, both
-- cumulative. The planned side is the payment schedule resolved through the
-- programme, so re-importing a revision redraws the curve with no writes at
-- all -- which is the whole point of never storing an instalment date.
--
-- A PROPOSED instalment still counts in the planned curve: it is the
-- consultant's stated expectation, and leaving it out makes the curve
-- optimistic. The header carries the un-agreed count and value separately so
-- the optimism is visible rather than assumed.
create or replace function cashflow_curve(p_project uuid, p_company uuid default null)
returns table (
  month date,
  planned numeric,
  planned_agreed numeric,
  invoiced numeric,
  paid numeric,
  planned_cumulative numeric,
  planned_agreed_cumulative numeric,
  invoiced_cumulative numeric,
  paid_cumulative numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with plan as (
    select date_trunc('month', s.due)::date as m,
           sum(s.value)                                       as planned,
           sum(s.value) filter (where s.status = 'Agreed')      as agreed
    from v_payment_schedule s
    where s.project_id = p_project
      and (p_company is null or s.company_id = p_company)
      and s.due is not null
    group by 1
  ),
  act as (
    select date_trunc('month', i.date_submitted)::date as m,
           sum(i.value)                                   as invoiced,
           sum(i.value) filter (where i.status = 'Paid')    as paid
    from invoices i
    where i.project_id = p_project
      and (p_company is null or i.company_id = p_company)
    group by 1
  ),
  months as (
    select m from plan union select m from act
  )
  select
    months.m,
    coalesce(plan.planned, 0), coalesce(plan.agreed, 0),
    coalesce(act.invoiced, 0), coalesce(act.paid, 0),
    sum(coalesce(plan.planned, 0)) over w,
    sum(coalesce(plan.agreed, 0)) over w,
    sum(coalesce(act.invoiced, 0)) over w,
    sum(coalesce(act.paid, 0)) over w
  from months
  left join plan on plan.m = months.m
  left join act  on act.m  = months.m
  window w as (order by months.m rows between unbounded preceding and current row)
  order by months.m;
$$;

grant execute on function cashflow_curve(uuid, uuid) to authenticated;

-- ------------------------------------------------------------- the decisions
--
-- Approving a fee, agreeing a schedule and certifying an invoice are all
-- records of who did what, so none of their columns is in the update grant
-- and each is written only by the function that performs the act.

create or replace function approve_fee(p_fee uuid, p_approved boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_project uuid;
begin
  select project_id into v_project from fees where id = p_fee;
  if v_project is null then
    raise exception 'No such fee' using errcode = 'P0002';
  end if;
  -- Approving somebody's money is the host's decision, not the claimant's.
  if not can_write_project_setup(v_project) then
    raise exception 'Not permitted to approve a fee on this project'
      using errcode = '42501';
  end if;
  update fees
     set status = case when p_approved then 'Approved' else 'Rejected' end,
         date_approved = case when p_approved then current_date else null end
   where id = p_fee;
end;
$$;

grant execute on function approve_fee(uuid, boolean) to authenticated;

-- Agreeing the schedule. One instalment or the whole company's worth, because
-- a schedule is agreed as a document rather than line by line -- but the row
-- is what carries the fact, so the loop is here and not in the browser.
create or replace function agree_payment_schedule(
  p_project uuid, p_company uuid, p_ids uuid[] default null
) returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_n int;
begin
  if not can_write_project_setup(p_project) then
    raise exception 'Not permitted to agree a payment schedule on this project'
      using errcode = '42501';
  end if;
  update payment_schedule
     set status = 'Agreed', agreed_by = auth.uid(), agreed_at = current_date
   where project_id = p_project
     and company_id = p_company
     and status = 'Proposed'
     and (p_ids is null or id = any(p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

grant execute on function agree_payment_schedule(uuid, uuid, uuid[]) to authenticated;

create or replace function certify_invoice(p_invoice uuid, p_status text, p_note text default null)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_project uuid;
begin
  select project_id into v_project from invoices where id = p_invoice;
  if v_project is null then
    raise exception 'No such invoice' using errcode = 'P0002';
  end if;
  if not can_write_project_setup(v_project) then
    raise exception 'Not permitted to certify an invoice on this project'
      using errcode = '42501';
  end if;
  if p_status not in ('Submitted','Certified','Paid','Disputed') then
    raise exception 'Unknown invoice status: %', p_status using errcode = '22023';
  end if;
  update invoices
     set status = p_status,
         date_paid = case when p_status = 'Paid'
                          then coalesce(date_paid, current_date) else null end,
         certified_by = case when p_status = 'Submitted' then null else auth.uid() end,
         certified_at = case when p_status = 'Submitted' then null else now() end,
         note = coalesce(p_note, note)
   where id = p_invoice;
end;
$$;

grant execute on function certify_invoice(uuid, text, text) to authenticated;
