-- Invitations and membership requests are the admins' business, not the team's.
--
-- An earlier migration widened both to any member of the account. That was a
-- misreading: a member is to see the accounts they belong to and nothing more.
-- This restores §1b's rule, keeping the two exceptions that are not about
-- curiosity but about function — an addressee must see the invitation meant for
-- them or they cannot accept it, and whoever raised a request must see what
-- became of it or they will raise it again.

drop policy if exists invitations_select on invitations;
create policy invitations_select on invitations for select to authenticated
using (
  is_platform_owner()
  or is_account_admin(organisation_id)
  or (project_id is not null and is_project_admin(project_id))
  or lower(email) = (select lower(email) from profiles where id = auth.uid())
);

drop policy if exists membership_requests_select on membership_requests;
create policy membership_requests_select on membership_requests for select to authenticated
using (is_account_admin(organisation_id) or requested_by = auth.uid());

-- The member directory stays visible to the account: a consultant needs to know
-- who else is on the job, and it is the same list the project directory shows.
