-- Phase 11, part four -- Row Level Security and column grants.

alter table breeam_schemes enable row level security;
alter table breeam_issues  enable row level security;

-- The framework is project reference material: every member of the project
-- reads it. There is nothing confidential in a section list, and a scoring
-- view that half the team cannot see produces a score half the team cannot
-- check.
create policy breeam_schemes_select on breeam_schemes for select to authenticated
using (can_see_project(project_id));

-- Loading a framework is a set-up act. The licence holder is usually the
-- BREEAM AP, who reaches this by being staffed as internal or as that
-- project's admin -- a staffing decision, deliberately, rather than a standing
-- right for every consultant to rewrite the scoring basis of the project.
create policy breeam_schemes_write on breeam_schemes for all to authenticated
using (can_write_project_setup(project_id))
with check (can_write_project_setup(project_id));

create policy breeam_issues_select on breeam_issues for select to authenticated
using (can_see_project(project_id));

create policy breeam_issues_write on breeam_issues for all to authenticated
using (can_write_project_setup(project_id))
with check (can_write_project_setup(project_id));

-- ------------------------------------------------------------------ grants
--
-- sections, weightings and ratings are the scoring basis, and they are outside
-- the update grant: they are loaded by breeam_import_apply() and edited
-- through the scheme setup screen's own calls, never by a PATCH that happens
-- to carry a weightings object. A member who could rewrite the weightings
-- could change every figure in the report without a single credit moving.
grant select, insert, delete on breeam_schemes to authenticated;
grant update (version, name, building_type) on breeam_schemes to authenticated;

-- min_standards is the same argument: it decides which rating is capped, so it
-- is loaded from the minimum-standards template and not typed in beside a
-- title.
grant select, insert, delete on breeam_issues to authenticated;
grant update (title, section, note) on breeam_issues to authenticated;

-- The credit numbers are the score. set_breeam_credit() is the only way to
-- move them, so ext leaves the tracked_items update grant -- which also closes
-- the utilities dates and every other kind's ext to a direct PATCH.
--
-- breeam_issue_id is outside it too: moving a credit to another issue would
-- move credits between sections, and therefore between weightings, which is a
-- reassignment of the scheme rather than an edit to a row.
-- Revoking UPDATE on the table drops the column-level grants with it, so
-- Phase 9's list is restated here in full, minus ext.
revoke update on tracked_items from authenticated;
grant update (heading, title, prompt, discipline, required, status,
              company_id, person_id, programme_task_uid, offset_days, anchor,
              due_date_override, visibility)
  on tracked_items to authenticated;

-- Which scheme is live. A project-level choice, so it sits in the projects
-- update grant beside the rest of them.
grant update (breeam_scheme_id) on projects to authenticated;
