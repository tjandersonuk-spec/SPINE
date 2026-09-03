-- Phase 9, part four -- Row Level Security and column grants.

alter table tracked_items        enable row level security;
alter table checklist_templates  enable row level security;
alter table scope_templates      enable row level security;
alter table scope_template_items enable row level security;

-- Tracked items follow the one visibility rule, like everything else with an
-- audience. Pre-construction items default to internal at load; the rest to
-- project.
create policy tracked_items_select on tracked_items for select to authenticated
using (can_see(project_id, visibility, created_by,
               (select pp.profile_id from project_people pp where pp.id = tracked_items.person_id)));

-- Anyone on the project may answer an item that is theirs -- a consultant
-- filling in their own scope line is the normal case, not an exception.
create policy tracked_items_insert on tracked_items for insert to authenticated
with check (can_see_project(project_id));

create policy tracked_items_update on tracked_items for update to authenticated
using (can_see(project_id, visibility, created_by,
               (select pp.profile_id from project_people pp where pp.id = tracked_items.person_id)))
with check (can_see(project_id, visibility, created_by,
               (select pp.profile_id from project_people pp where pp.id = tracked_items.person_id)));

-- A template row cannot be deleted on a project -- it is struck out instead, so
-- the decision that it was not needed survives. A row added on the project
-- (custom) may go, because nothing was decided by removing something somebody
-- typed by mistake.
create policy tracked_items_delete on tracked_items for delete to authenticated
using (custom and can_write_project_setup(project_id));

-- The published templates are readable by anyone signed in -- that is what an
-- account sees before it forks. A fork belongs to its account.
create policy checklist_templates_select on checklist_templates for select to authenticated
using (organisation_id is null or is_account_member(organisation_id));

create policy checklist_templates_write on checklist_templates for all to authenticated
using (organisation_id is not null and is_account_admin(organisation_id)
       and account_is_live(organisation_id))
with check (organisation_id is not null and is_account_admin(organisation_id)
       and account_is_live(organisation_id));

create policy scope_templates_select on scope_templates for select to authenticated
using (organisation_id is null or is_account_member(organisation_id));

create policy scope_templates_write on scope_templates for all to authenticated
using (organisation_id is not null and is_account_admin(organisation_id)
       and account_is_live(organisation_id))
with check (organisation_id is not null and is_account_admin(organisation_id)
       and account_is_live(organisation_id));

create policy scope_template_items_select on scope_template_items for select to authenticated
using (exists (select 1 from scope_templates t where t.id = scope_template_items.template_id
               and (t.organisation_id is null or is_account_member(t.organisation_id))));

create policy scope_template_items_write on scope_template_items for all to authenticated
using (exists (select 1 from scope_templates t where t.id = scope_template_items.template_id
               and t.organisation_id is not null and is_account_admin(t.organisation_id)))
with check (exists (select 1 from scope_templates t where t.id = scope_template_items.template_id
               and t.organisation_id is not null and is_account_admin(t.organisation_id)));

-- ------------------------------------------------------------------ grants
-- Each table states its own; a table created by this migration inherits nothing
-- from any earlier `grant on all tables`.

-- kind, reference, template_id, template_name, custom and created_by are all
-- outside the update grant. kind and reference are the row's identity; the
-- template columns are the record of where it came from, and a row that could
-- be re-pointed at a different template would make "which template gave me
-- this" unanswerable. response, response_source, response_by and response_at
-- are written by set_response() and accept_response() alone, so a machine
-- suggestion cannot be silently promoted to a person's answer by writing a
-- column.
grant select, insert, delete on tracked_items to authenticated;
grant update (heading, title, prompt, discipline, required, status, company_id, person_id,
              programme_task_uid, offset_days, anchor, due_date_override, ext, visibility)
  on tracked_items to authenticated;

grant select, insert, delete on checklist_templates to authenticated;
grant update (type, reference, heading, title, prompt, discipline, sort_order)
  on checklist_templates to authenticated;

-- is_core is outside the grant: the standard template cannot be demoted into an
-- ordinary one and then deleted.
grant select, insert, delete on scope_templates to authenticated;
grant update (name, discipline) on scope_templates to authenticated;

grant select, insert, delete on scope_template_items to authenticated;
grant update (reference, heading, description, riba_stage) on scope_template_items to authenticated;

alter view v_tracked_items set (security_invoker = on);
grant select on v_tracked_items to authenticated;
