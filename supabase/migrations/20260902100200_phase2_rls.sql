-- Phase 2 — Row Level Security and privileges for the directory.
--
-- Two audiences. The CATALOGUE belongs to the account: its members read it, its
-- admins maintain it, and it never crosses an account boundary. The PROJECT
-- DIRECTORY belongs to the project: anyone who can see the project reads it,
-- and an account admin or that project's admin maintains it.
--
-- Grants are stated per table, because a `grant on all tables` in an earlier
-- migration reaches none of these.

alter table disciplines           enable row level security;
alter table project_disciplines   enable row level security;
alter table contacts              enable row level security;
alter table companies             enable row level security;
alter table company_disciplines   enable row level security;
alter table project_people        enable row level security;
alter table appointment_documents enable row level security;

-- --------------------------------------------------------------------------
-- disciplines — the published set is readable by anyone signed in, because it
-- is what an account sees before it forks. A fork is the account's own.
-- --------------------------------------------------------------------------

create policy disciplines_select on disciplines for select to authenticated
using (organisation_id is null or is_account_member(organisation_id));

create policy disciplines_write on disciplines for all to authenticated
using (organisation_id is not null and is_account_admin(organisation_id)
       and account_is_live(organisation_id))
with check (organisation_id is not null and is_account_admin(organisation_id)
       and account_is_live(organisation_id));

grant select on disciplines to authenticated;
grant insert, delete on disciplines to authenticated;
grant update (code, name, sort_order) on disciplines to authenticated;

-- --------------------------------------------------------------------------
-- project_disciplines — striking a discipline out for one job
-- --------------------------------------------------------------------------

create policy project_disciplines_select on project_disciplines for select to authenticated
using (can_see_project(project_id));

create policy project_disciplines_write on project_disciplines for all to authenticated
using (exists (select 1 from projects p where p.id = project_disciplines.project_id
               and account_is_live(p.organisation_id)
               and (is_account_admin(p.organisation_id) or is_project_admin(p.id))))
with check (exists (select 1 from projects p where p.id = project_disciplines.project_id
               and account_is_live(p.organisation_id)
               and (is_account_admin(p.organisation_id) or is_project_admin(p.id))));

grant select, insert, delete on project_disciplines to authenticated;
grant update (required) on project_disciplines to authenticated;

-- --------------------------------------------------------------------------
-- catalogue_companies and contacts — the account's own catalogue
-- --------------------------------------------------------------------------

grant update (name, address, company_type, notes) on catalogue_companies to authenticated;
grant insert, delete on catalogue_companies to authenticated;

create policy contacts_select on contacts for select to authenticated
using (exists (select 1 from catalogue_companies cc
               where cc.id = contacts.catalogue_company_id
                 and is_account_member(cc.organisation_id)
                 and account_is_readable(cc.organisation_id)));

create policy contacts_write on contacts for all to authenticated
using (exists (select 1 from catalogue_companies cc
               where cc.id = contacts.catalogue_company_id
                 and is_account_admin(cc.organisation_id)
                 and account_is_live(cc.organisation_id)))
with check (exists (select 1 from catalogue_companies cc
               where cc.id = contacts.catalogue_company_id
                 and is_account_admin(cc.organisation_id)
                 and account_is_live(cc.organisation_id)));

grant select, insert, delete on contacts to authenticated;
grant update (name, job_role, email, phone) on contacts to authenticated;

-- --------------------------------------------------------------------------
-- companies — the project directory
-- --------------------------------------------------------------------------

create policy companies_select on companies for select to authenticated
using (can_see_project(project_id));

create policy companies_write on companies for all to authenticated
using (exists (select 1 from projects p where p.id = companies.project_id
               and account_is_live(p.organisation_id)
               and (is_account_admin(p.organisation_id) or is_project_admin(p.id))))
with check (exists (select 1 from projects p where p.id = companies.project_id
               and account_is_live(p.organisation_id)
               and (is_account_admin(p.organisation_id) or is_project_admin(p.id))));

grant select, insert, delete on companies to authenticated;
-- catalogue_company_id and project_id are not editable: a snapshot may be
-- corrected, but it may not be re-pointed at a different firm after the fact.
grant update (name, address, originator_code, company_type, notes, parent_id)
  on companies to authenticated;

create policy company_disciplines_select on company_disciplines for select to authenticated
using (exists (select 1 from companies c where c.id = company_disciplines.company_id
               and can_see_project(c.project_id)));

create policy company_disciplines_write on company_disciplines for all to authenticated
using (exists (select 1 from companies c join projects p on p.id = c.project_id
               where c.id = company_disciplines.company_id
                 and account_is_live(p.organisation_id)
                 and (is_account_admin(p.organisation_id) or is_project_admin(p.id))))
with check (exists (select 1 from companies c join projects p on p.id = c.project_id
               where c.id = company_disciplines.company_id
                 and account_is_live(p.organisation_id)
                 and (is_account_admin(p.organisation_id) or is_project_admin(p.id))));

grant select, insert, delete on company_disciplines to authenticated;

-- --------------------------------------------------------------------------
-- project_people
-- --------------------------------------------------------------------------

create policy project_people_select on project_people for select to authenticated
using (can_see_project(project_id));

create policy project_people_write on project_people for all to authenticated
using (exists (select 1 from projects p where p.id = project_people.project_id
               and account_is_live(p.organisation_id)
               and (is_account_admin(p.organisation_id) or is_project_admin(p.id))))
with check (exists (select 1 from projects p where p.id = project_people.project_id
               and account_is_live(p.organisation_id)
               and (is_account_admin(p.organisation_id) or is_project_admin(p.id))));

grant select, insert, delete on project_people to authenticated;
-- profile_id is not writable: it says whether this person holds a login, which
-- the delete guard reads. Letting it be cleared would defeat the guard.
grant update (name, job_role, email, phone, is_primary) on project_people to authenticated;

-- --------------------------------------------------------------------------
-- appointment_documents — the project reads, the host approves
-- --------------------------------------------------------------------------

create policy appointment_documents_select on appointment_documents for select to authenticated
using (exists (select 1 from companies c where c.id = appointment_documents.company_id
               and can_see_project(c.project_id)));

create policy appointment_documents_write on appointment_documents for all to authenticated
using (exists (select 1 from companies c join projects p on p.id = c.project_id
               where c.id = appointment_documents.company_id
                 and account_is_live(p.organisation_id)
                 and (is_account_staff(p.organisation_id) or is_project_admin(p.id))))
with check (exists (select 1 from companies c join projects p on p.id = c.project_id
               where c.id = appointment_documents.company_id
                 and account_is_live(p.organisation_id)
                 and (is_account_staff(p.organisation_id) or is_project_admin(p.id))));

grant select, insert, delete on appointment_documents to authenticated;
-- Approval is the host's judgement and is recorded; the file itself is replaced
-- by superseding, never by editing the row's path underneath it.
grant update (approved, approved_by, approved_at, superseded_by)
  on appointment_documents to authenticated;
