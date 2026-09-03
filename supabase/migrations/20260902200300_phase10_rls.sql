-- Phase 10, part four -- Row Level Security and column grants.

alter table change_requests      enable row level security;
alter table change_request_items enable row level security;
alter table occurrences          enable row level security;

create policy change_requests_select on change_requests for select to authenticated
using (can_see(project_id, visibility, raised_by, null));

create policy change_requests_insert on change_requests for insert to authenticated
with check (can_see_project(project_id));

create policy change_requests_update on change_requests for update to authenticated
using (can_see(project_id, visibility, raised_by, null))
with check (can_see(project_id, visibility, raised_by, null));

create policy change_requests_delete on change_requests for delete to authenticated
using (can_write_project_setup(project_id));

create policy change_request_items_select on change_request_items for select to authenticated
using (exists (select 1 from change_requests cr
               where cr.id = change_request_items.change_request_id
                 and can_see(cr.project_id, cr.visibility, cr.raised_by, null)));

create policy change_request_items_write on change_request_items for all to authenticated
using (exists (select 1 from change_requests cr
               where cr.id = change_request_items.change_request_id
                 and can_see(cr.project_id, cr.visibility, cr.raised_by, null)))
with check (exists (select 1 from change_requests cr
               where cr.id = change_request_items.change_request_id
                 and can_see(cr.project_id, cr.visibility, cr.raised_by, null)));

-- Occurrences default to internal visibility: a mandatory occurrence report is
-- a statutory matter between the duty-holders and the regulator, not project
-- correspondence.
create policy occurrences_select on occurrences for select to authenticated
using (can_see(project_id, visibility, raised_by, null));

create policy occurrences_write on occurrences for all to authenticated
using (can_write_project_setup(project_id))
with check (can_write_project_setup(project_id));

-- ------------------------------------------------------------------ grants
--
-- The classification columns are the whole point of this phase's guard, and
-- they are outside the update grant entirely. classify_change() is the only way
-- to set them, and it checks can_classify() server-side -- so a synthetic event
-- from someone senior who does not hold the duty is refused by the database,
-- not by a hidden button.
--
-- bsa_notified_at, bsa_objected, the application fields and the decision record
-- are also outside it: they are facts about what the regulator did, and a
-- column that could be written directly would let "may work proceed" say yes
-- because somebody edited a date.
grant select, insert, delete on change_requests to authenticated;
grant update (title, description, reason, category, from_company_id, to_company_id,
              to_person_id, status, origin_entity, origin_id, impact_scope, impact_weeks,
              impact_cost, impact_other, decision_task_uid, decision_offset_days,
              decision_anchor, decision_date_override, effective_task_uid,
              effective_offset_days, effective_anchor, effective_date_override,
              decision_note, visibility)
  on change_requests to authenticated;

grant select, insert, delete on change_request_items to authenticated;
grant update (entity_type, entity_id, description) on change_request_items to authenticated;

grant select, insert, delete on occurrences to authenticated;
grant update (title, description, kind, status, assessment, occurred_at, discovered_at,
              reported_at, person_id, company_id, visibility) on occurrences to authenticated;

-- The HRB switch and the two periods are an account admin's, not a project
-- member's: turning the regime off, or widening an objection window, is not a
-- project-level decision.
grant update (hrb, hrb_reason, g2_reference, g2_approved_date, commencement_notified,
              hrb_notify_days, hrb_major_weeks) on projects to authenticated;

-- The golden thread designation is an ordinary register edit; the BASELINE is
-- not, and g2_revision stays outside the grant so it can only be stamped once,
-- by stamp_g2_baseline().
grant update (golden_thread) on drawing_register to authenticated;

alter view v_change_requests set (security_invoker = on);
grant select on v_change_requests to authenticated;
