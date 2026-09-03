-- Phase 12, part eight -- Row Level Security and column grants.
--
-- This is the sharpest RLS in the product. Fees, payment schedules, invoices,
-- the pre-construction budget and the risk register are the tables where a
-- policy that is one clause too wide teaches a consultant what a competitor
-- is charging.

alter table fees                     enable row level security;
alter table payment_schedule         enable row level security;
alter table invoices                 enable row level security;
alter table precon_budget            enable row level security;
alter table precon_quotes            enable row level security;
alter table precon_quote_adjustments enable row level security;
alter table risks                    enable row level security;
alter table risk_templates           enable row level security;
alter table warranty_templates       enable row level security;
alter table warranties               enable row level security;
alter table materials                enable row level security;
alter table material_submissions     enable row level security;

-- Who may see a commercial row: the account's own staff and the client see
-- everything; a consultant sees their own company tree and nothing else.
--
-- my_company_tree() recurses, so a firm sees the specialists it appointed
-- under itself -- it is answerable for their fees -- and a rival on the same
-- project is absent from every figure rather than merely unhighlighted.
create or replace function can_see_commercial(p_project uuid, p_company uuid)
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
      and (is_account_staff(p.organisation_id)
           or exists (select 1 from organisation_members m
                       where m.organisation_id = p.organisation_id
                         and m.profile_id = auth.uid()
                         and m.role = 'client')))
  or p_company in (select company_id from my_company_tree(p_project));
$$;

grant execute on function can_see_commercial(uuid, uuid) to authenticated;

-- ------------------------------------------------------------------- fees
create policy fees_select on fees for select to authenticated
using (can_see_commercial(project_id, company_id));

-- A consultant may propose their own fee and their own variation; only the
-- host approves one, and approve_fee() is the only way the status moves.
create policy fees_insert on fees for insert to authenticated
with check (can_see_commercial(project_id, company_id));

create policy fees_update on fees for update to authenticated
using (can_see_commercial(project_id, company_id))
with check (can_see_commercial(project_id, company_id));

create policy fees_delete on fees for delete to authenticated
using (can_write_project_setup(project_id));

create policy payment_schedule_select on payment_schedule for select to authenticated
using (can_see_commercial(project_id, company_id));

create policy payment_schedule_insert on payment_schedule for insert to authenticated
with check (can_see_commercial(project_id, company_id));

create policy payment_schedule_update on payment_schedule for update to authenticated
using (can_see_commercial(project_id, company_id))
with check (can_see_commercial(project_id, company_id));

create policy payment_schedule_delete on payment_schedule for delete to authenticated
using (can_write_project_setup(project_id));

create policy invoices_select on invoices for select to authenticated
using (can_see_commercial(project_id, company_id));

create policy invoices_insert on invoices for insert to authenticated
with check (can_see_commercial(project_id, company_id));

create policy invoices_update on invoices for update to authenticated
using (can_see_commercial(project_id, company_id))
with check (can_see_commercial(project_id, company_id));

create policy invoices_delete on invoices for delete to authenticated
using (can_write_project_setup(project_id));

-- ------------------------------------------------- pre-construction budget
--
-- Host staff only, and that INCLUDES THE CONSULTANT WHO SUBMITTED INTO IT.
-- can_see_precon() deliberately excludes a project_admin, who may be the very
-- firm that quoted.
create policy precon_budget_all on precon_budget for all to authenticated
using (can_see_precon(project_id)) with check (can_see_precon(project_id));

create policy precon_quotes_all on precon_quotes for all to authenticated
using (can_see_precon(project_id)) with check (can_see_precon(project_id));

create policy precon_quote_adjustments_all on precon_quote_adjustments
for all to authenticated
using (exists (select 1 from precon_quotes q
                where q.id = precon_quote_adjustments.quote_id
                  and can_see_precon(q.project_id)))
with check (exists (select 1 from precon_quotes q
                where q.id = precon_quote_adjustments.quote_id
                  and can_see_precon(q.project_id)));

-- ------------------------------------------------------------------ risks
--
-- Closed by default, through the one visibility primitive. can_see() gives the
-- raiser, the owner, anybody named, and the admin override -- and the mode on
-- a risk defaults to `named` with an empty list, which means nobody else.
--
-- Note what is NOT here: `internal` gets no risk override. Account staff who
-- are not admins see only the risks they have been named on.
create policy risks_select on risks for select to authenticated
using (can_see(project_id, visibility, raised_by, person_id));

create policy risks_insert on risks for insert to authenticated
with check (can_see_project(project_id));

create policy risks_update on risks for update to authenticated
using (can_see(project_id, visibility, raised_by, person_id))
with check (can_see(project_id, visibility, raised_by, person_id));

create policy risks_delete on risks for delete to authenticated
using (can_write_project_setup(project_id));

-- The published library is readable by everyone; a fork belongs to its
-- account's admins.
create policy risk_templates_select on risk_templates for select to authenticated
using (organisation_id is null or is_account_staff(organisation_id));

create policy risk_templates_write on risk_templates for all to authenticated
using (organisation_id is not null and is_account_admin(organisation_id))
with check (organisation_id is not null and is_account_admin(organisation_id));

create policy warranty_templates_select on warranty_templates for select to authenticated
using (organisation_id is null or is_account_staff(organisation_id));

create policy warranty_templates_write on warranty_templates for all to authenticated
using (organisation_id is not null and is_account_admin(organisation_id))
with check (organisation_id is not null and is_account_admin(organisation_id));

-- ------------------------------------------------------------- warranties
--
-- The read policy follows the RESOLVED owner, not a stored one -- the same
-- shape as every other company-scoped read here, just resolved through the
-- matrix instead of through a column. Host staff and the client see all of
-- them; a consultant sees the ones whose lead discipline their own company
-- tree holds.
create policy warranties_select on warranties for select to authenticated
using (
  can_write_project_setup(project_id)
  or exists (select 1 from projects p
              where p.id = warranties.project_id
                and account_is_live(p.organisation_id)
                and is_account_staff(p.organisation_id))
  or exists (
    select 1
    from drm_items d
    join company_disciplines cd on cd.discipline_code = d.lead_discipline
    where d.project_id = warranties.project_id
      and d.ref = warranties.drm_ref
      and d.applicable
      and cd.company_id in (select company_id from my_company_tree(warranties.project_id))));

create policy warranties_write on warranties for all to authenticated
using (can_write_project_setup(project_id))
with check (can_write_project_setup(project_id));

-- ------------------------------------------------------------- materials
--
-- A sample register is project correspondence: everybody on the project reads
-- it. What is restricted is the DECISION, and that is restricted by the
-- function that makes it plus the column grant below -- not by the read.
create policy materials_select on materials for select to authenticated
using (can_see_project(project_id));

create policy materials_insert on materials for insert to authenticated
with check (can_see_project(project_id));

create policy materials_update on materials for update to authenticated
using (can_see_project(project_id)) with check (can_see_project(project_id));

create policy materials_delete on materials for delete to authenticated
using (can_write_project_setup(project_id));

create policy material_submissions_select on material_submissions
for select to authenticated
using (exists (select 1 from materials m
                where m.id = material_submissions.material_id
                  and can_see_project(m.project_id)));

create policy material_submissions_insert on material_submissions
for insert to authenticated
with check (exists (select 1 from materials m
                where m.id = material_submissions.material_id
                  and can_see_project(m.project_id)));

create policy material_submissions_update on material_submissions
for update to authenticated
using (exists (select 1 from materials m
                where m.id = material_submissions.material_id
                  and can_see_project(m.project_id)))
with check (exists (select 1 from materials m
                where m.id = material_submissions.material_id
                  and can_see_project(m.project_id)));

-- ------------------------------------------------------------------ grants
-- Each table states its own; a table created by this migration inherits
-- nothing from any earlier `grant on all tables`.

-- status and date_approved are outside the grant: approve_fee() is the only
-- way a fee becomes approved, so a consultant cannot approve their own by
-- writing a column. budget_line_ids is host-only in practice but stays in the
-- grant, because it is an editorial link rather than a decision -- and the
-- pre-construction module it names is invisible to anybody else anyway.
grant select, insert, delete on fees to authenticated;
grant update (reference, kind, description, value, date_submitted, budget_line_ids)
  on fees to authenticated;

-- status, agreed_by and agreed_at belong to agree_payment_schedule().
grant select, insert, delete on payment_schedule to authenticated;
grant update (reference, description, value, programme_task_uid, offset_days,
              anchor, due_date_override)
  on payment_schedule to authenticated;

-- status, date_paid, certified_by and certified_at belong to
-- certify_invoice(). A claimant who could set their own invoice to Certified
-- would make the whole cashflow meaningless.
grant select, insert, delete on invoices to authenticated;
grant update (reference, value, date_submitted, schedule_id, note)
  on invoices to authenticated;

-- preferred_quote_id belongs to set_preferred_quote(), which checks the quote
-- is against this line.
grant select, insert, delete on precon_budget to authenticated;
grant update (reference, category, discipline, title, required, budget, notes)
  on precon_budget to authenticated;

grant select, insert, delete on precon_quotes to authenticated;
grant update (company_id, supplier, reference, date_received, base_value, status, notes)
  on precon_quotes to authenticated;

grant select, insert, delete on precon_quote_adjustments to authenticated;
grant update (label, value) on precon_quote_adjustments to authenticated;

-- status and issue_id belong to realise_risk(): a risk marked realised with no
-- task behind it is the parallel list this product exists to remove, and the
-- constraint refuses it anyway. raised_by and reference are the row's
-- identity. template_id is the record of where it came from.
grant select, insert, delete on risks to authenticated;
grant update (kind, title, description, mitigation, category, person_id,
              likelihood, impact_cost, impact_weeks, programme_task_uid,
              offset_days, anchor, due_date_override, visibility, closed_at)
  on risks to authenticated;

grant select, insert, delete on risk_templates to authenticated;
grant update (reference, kind, title, description, category, likelihood, sort_order)
  on risk_templates to authenticated;

grant select, insert, delete on warranty_templates to authenticated;
grant update (reference, drm_ref, title, description, period_years, beneficiary,
              form, sort_order)
  on warranty_templates to authenticated;

-- No company_id to grant, because there is no company_id. If a later migration
-- adds one, this is the line that should have stopped it.
grant select, insert, delete on warranties to authenticated;
grant update (reference, drm_ref, title, description, period_years, beneficiary,
              form, provided_by, status, required, programme_task_uid,
              offset_days, anchor, due_date_override)
  on warranties to authenticated;

grant select, insert, delete on materials to authenticated;
grant update (reference, title, spec, location, company_id, person_id,
              programme_task_uid, offset_days, anchor, due_date_override, required)
  on materials to authenticated;

-- No DELETE, following the transmittal precedent: a decided round cannot be
-- removed to tidy away a rejection, and the freeze trigger stops it being
-- edited away. The decision columns are outside the update grant, so
-- decide_material_round() -- which checks can_decide_material() -- is the only
-- path to a decision. `round` and `material_id` are refused by the trigger as
-- well as being absent here, because they are facts about what was submitted.
grant select, insert on material_submissions to authenticated;
grant update (sample_reference, comments) on material_submissions to authenticated;

-- The variation link is an ordinary edit; the status is not, because
-- Implemented has a precondition. set_change_status() is the only way there.
revoke update on change_requests from authenticated;
grant update (title, description, reason, category, from_company_id, to_company_id,
              to_person_id, origin_entity, origin_id, impact_scope, impact_weeks,
              impact_cost, impact_other, decision_task_uid, decision_offset_days,
              decision_anchor, decision_date_override, effective_task_uid,
              effective_offset_days, effective_anchor, effective_date_override,
              decision_note, visibility, variation_id)
  on change_requests to authenticated;

-- done_by and done_at belong to tick_change_item(), so "who said this was
-- done" cannot be written by somebody else.
revoke update on change_request_items from authenticated;
grant update (entity_type, entity_id, description) on change_request_items to authenticated;

-- ------------------------------------------------------------------- views
alter view v_payment_schedule set (security_invoker = on);
alter view v_invoices         set (security_invoker = on);
alter view v_precon_budget    set (security_invoker = on);
alter view v_precon_quotes    set (security_invoker = on);
alter view v_risks            set (security_invoker = on);
alter view v_warranties       set (security_invoker = on);
alter view v_materials        set (security_invoker = on);
grant select on v_payment_schedule to authenticated;
grant select on v_invoices         to authenticated;
grant select on v_precon_budget    to authenticated;
grant select on v_precon_quotes    to authenticated;
grant select on v_risks            to authenticated;
grant select on v_warranties       to authenticated;
grant select on v_materials        to authenticated;
