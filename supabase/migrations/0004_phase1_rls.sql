-- Phase 1 — Row Level Security.
--
-- Two rules run through all of it. A person with no memberships must get the
-- EMPTY SET from every table rather than an error, because that is a supported
-- state and their landing page queries these tables. And every select policy on
-- an account-scoped table carries `or is_platform_owner()`.

alter table profiles              enable row level security;
alter table organisations         enable row level security;
alter table catalogue_companies   enable row level security;
alter table organisation_members  enable row level security;
alter table platform_owners       enable row level security;
alter table projects              enable row level security;
alter table project_members       enable row level security;
alter table account_requests      enable row level security;
alter table invitations           enable row level security;
alter table platform_audit        enable row level security;

-- --------------------------------------------------------------------------
-- profiles — yourself, people you share an account with, and the owner
-- --------------------------------------------------------------------------

create policy profiles_select on profiles for select to authenticated
using (
  id = auth.uid()
  or is_platform_owner()
  or exists (
    select 1 from organisation_members mine
    join organisation_members theirs on theirs.organisation_id = mine.organisation_id
    where mine.profile_id = auth.uid() and theirs.profile_id = profiles.id)
);

create policy profiles_update_self on profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

-- A person who holds a login is never deleted from here; there is no delete
-- policy at all, so the audit-proven behaviour holds at the database.

-- --------------------------------------------------------------------------
-- organisations — only your own accounts are visible, ever
-- --------------------------------------------------------------------------

create policy organisations_select on organisations for select to authenticated
using (is_account_member(id) or is_platform_owner());

-- Account admins may edit branding and theme on a live account. Status and the
-- lifecycle columns are not writable here: set_account_status() owns those, and
-- an account admin must not be able to un-suspend themselves.
create policy organisations_update on organisations for update to authenticated
using (is_account_admin(id) and status = 'active')
with check (is_account_admin(id) and status = 'active');

-- No insert or delete policy: accounts come from approve_account_request() and
-- go through delete_account(), both platform-owner only.

-- --------------------------------------------------------------------------
-- catalogue_companies
-- --------------------------------------------------------------------------

create policy catalogue_companies_select on catalogue_companies for select to authenticated
using (is_account_member(organisation_id) and account_is_readable(organisation_id)
       or is_platform_owner());

create policy catalogue_companies_write on catalogue_companies for all to authenticated
using (is_account_admin(organisation_id) and account_is_live(organisation_id))
with check (is_account_admin(organisation_id) and account_is_live(organisation_id));

-- --------------------------------------------------------------------------
-- organisation_members
-- --------------------------------------------------------------------------

create policy organisation_members_select on organisation_members for select to authenticated
using (profile_id = auth.uid() or is_account_member(organisation_id) or is_platform_owner());

-- Membership is created by accept_invitation() alone, so there is no insert
-- policy. An admin may change a role or remove a member.
create policy organisation_members_update on organisation_members for update to authenticated
using (is_account_admin(organisation_id) and account_is_live(organisation_id))
with check (is_account_admin(organisation_id) and account_is_live(organisation_id));

create policy organisation_members_delete on organisation_members for delete to authenticated
using (is_account_admin(organisation_id) and account_is_live(organisation_id));

-- --------------------------------------------------------------------------
-- platform_owners — the layer must not be discoverable
-- --------------------------------------------------------------------------

create policy platform_owners_select on platform_owners for select to authenticated
using (is_platform_owner());

-- --------------------------------------------------------------------------
-- projects — creation is account admin only, enforced here
-- --------------------------------------------------------------------------

create policy projects_select on projects for select to authenticated
using (
  is_platform_owner()
  or (account_is_readable(organisation_id)
      and (is_account_staff(organisation_id)
           or exists (select 1 from project_members pm
                      where pm.project_id = projects.id and pm.profile_id = auth.uid())))
);

-- The rule the whole phase turns on. Not a hidden button: an `internal`, a
-- project admin or a consultant issuing a direct insert is refused here.
create policy projects_insert on projects for insert to authenticated
with check (is_account_admin(organisation_id) and account_is_live(organisation_id));

create policy projects_update on projects for update to authenticated
using ((is_account_admin(organisation_id) or is_project_admin(id))
       and account_is_live(organisation_id))
with check ((is_account_admin(organisation_id) or is_project_admin(id))
       and account_is_live(organisation_id));

create policy projects_delete on projects for delete to authenticated
using (is_account_admin(organisation_id) and account_is_live(organisation_id));

-- --------------------------------------------------------------------------
-- project_members
-- --------------------------------------------------------------------------

create policy project_members_select on project_members for select to authenticated
using (profile_id = auth.uid() or can_see_project(project_id));

-- Rows are created by accept_invitation(). A project admin may change a role or
-- remove someone from their own project; removal leaves the account membership
-- and every other project untouched, because this table holds neither.
create policy project_members_update on project_members for update to authenticated
using (exists (select 1 from projects p where p.id = project_members.project_id
               and account_is_live(p.organisation_id)
               and (is_account_admin(p.organisation_id) or is_project_admin(p.id))))
with check (exists (select 1 from projects p where p.id = project_members.project_id
               and account_is_live(p.organisation_id)
               and (is_account_admin(p.organisation_id) or is_project_admin(p.id))));

create policy project_members_delete on project_members for delete to authenticated
using (exists (select 1 from projects p where p.id = project_members.project_id
               and account_is_live(p.organisation_id)
               and (is_account_admin(p.organisation_id) or is_project_admin(p.id))));

-- --------------------------------------------------------------------------
-- account_requests — the requester and the platform owner, nobody else
-- --------------------------------------------------------------------------

create policy account_requests_select on account_requests for select to authenticated
using (requested_by = auth.uid() or is_platform_owner());

create policy account_requests_insert on account_requests for insert to authenticated
with check (requested_by = auth.uid());

-- The requester may only withdraw. Approval and rejection go through the
-- platform-owner functions, which also write the audit row.
create policy account_requests_withdraw on account_requests for update to authenticated
using (requested_by = auth.uid() and status = 'pending')
with check (requested_by = auth.uid() and status in ('pending','withdrawn'));

-- --------------------------------------------------------------------------
-- invitations
-- --------------------------------------------------------------------------

-- An invitation is visible to the account's admins and to its addressee. It is
-- NOT visible to the rest of the account: until acceptance the invitee is a name
-- and an email and nothing more.
create policy invitations_select on invitations for select to authenticated
using (
  is_platform_owner()
  or is_account_admin(organisation_id)
  or (project_id is not null and is_project_admin(project_id))
  or lower(email) = (select lower(email) from profiles where id = auth.uid())
);

-- Issued only through invite_to_account() / invite_to_project(), which carry the
-- membership guard, so no insert policy exists. Admins may revoke.
create policy invitations_update on invitations for update to authenticated
using (is_account_admin(organisation_id)
       or (project_id is not null and is_project_admin(project_id)))
with check (is_account_admin(organisation_id)
       or (project_id is not null and is_project_admin(project_id)));

-- --------------------------------------------------------------------------
-- platform_audit — readable by the owner, appendable by nobody, and with no
-- update or delete policy for anyone including platform owners, so the trail
-- cannot be edited by its own subject.
-- --------------------------------------------------------------------------

create policy platform_audit_select on platform_audit for select to authenticated
using (is_platform_owner());
