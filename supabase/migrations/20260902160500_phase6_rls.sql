-- Phase 6, part six -- Row Level Security and column grants.

alter table comments             enable row level security;
alter table comment_attachments  enable row level security;
alter table evidence             enable row level security;
alter table meetings             enable row level security;
alter table meeting_agenda_items enable row level security;
alter table meeting_people       enable row level security;
alter table issues               enable row level security;
alter table issue_agenda_refs    enable row level security;

-- Comments. Read by whoever the comment's own visibility admits; written by
-- anyone on the project, because a discussion nobody may join is not one.
create policy comments_select on comments for select to authenticated
using (can_see(project_id, visibility, author_id, null));

create policy comments_insert on comments for insert to authenticated
with check (can_see_project(project_id) and author_id = auth.uid());

-- Only the author edits their own words, and only the body -- see the grants.
create policy comments_update on comments for update to authenticated
using (author_id = auth.uid()) with check (author_id = auth.uid());

create policy comments_delete on comments for delete to authenticated
using (author_id = auth.uid()
       or exists (select 1 from projects p where p.id = comments.project_id
                  and is_account_staff(p.organisation_id)));

create policy comment_attachments_select on comment_attachments for select to authenticated
using (exists (select 1 from comments c where c.id = comment_attachments.comment_id
               and can_see(c.project_id, c.visibility, c.author_id, null)));

create policy comment_attachments_write on comment_attachments for all to authenticated
using (exists (select 1 from comments c where c.id = comment_attachments.comment_id
               and c.author_id = auth.uid()))
with check (exists (select 1 from comments c where c.id = comment_attachments.comment_id
               and c.author_id = auth.uid()));

-- Evidence. Everyone on the project sees what has been submitted; only the
-- contractor's team reviews it.
create policy evidence_select on evidence for select to authenticated
using (can_see_project(project_id));

create policy evidence_insert on evidence for insert to authenticated
with check (can_see_project(project_id));

create policy evidence_update on evidence for update to authenticated
using (can_write_project_setup(project_id))
with check (can_write_project_setup(project_id));

create policy evidence_delete on evidence for delete to authenticated
using (added_by = auth.uid() or can_write_project_setup(project_id));

-- Meetings are visible to the people on them, and to the contractor's staff.
create policy meetings_select on meetings for select to authenticated
using (can_see_meeting(id));

create policy meetings_write on meetings for all to authenticated
using (can_write_project_setup(project_id))
with check (can_write_project_setup(project_id));

create policy agenda_select on meeting_agenda_items for select to authenticated
using (can_see_meeting(meeting_id));

create policy agenda_write on meeting_agenda_items for all to authenticated
using (exists (select 1 from meetings m where m.id = meeting_agenda_items.meeting_id
               and can_write_project_setup(m.project_id)))
with check (exists (select 1 from meetings m where m.id = meeting_agenda_items.meeting_id
               and can_write_project_setup(m.project_id)));

create policy meeting_people_select on meeting_people for select to authenticated
using (can_see_meeting(meeting_id));

create policy meeting_people_write on meeting_people for all to authenticated
using (exists (select 1 from meetings m where m.id = meeting_people.meeting_id
               and can_write_project_setup(m.project_id)))
with check (exists (select 1 from meetings m where m.id = meeting_people.meeting_id
               and can_write_project_setup(m.project_id)));

-- Issues. One visibility rule, and the raiser and the owner are never locked
-- out of their own item.
create policy issues_select on issues for select to authenticated
using (can_see(project_id, visibility, raised_by,
               (select pp.profile_id from project_people pp where pp.id = issues.person_id)));

create policy issues_insert on issues for insert to authenticated
with check (can_see_project(project_id));

create policy issues_update on issues for update to authenticated
using (can_see(project_id, visibility, raised_by,
               (select pp.profile_id from project_people pp where pp.id = issues.person_id)))
with check (can_see(project_id, visibility, raised_by,
               (select pp.profile_id from project_people pp where pp.id = issues.person_id)));

create policy issues_delete on issues for delete to authenticated
using (can_write_project_setup(project_id));

create policy agenda_refs_select on issue_agenda_refs for select to authenticated
using (can_see_meeting(meeting_id));

create policy agenda_refs_write on issue_agenda_refs for all to authenticated
using (exists (select 1 from meetings m where m.id = issue_agenda_refs.meeting_id
               and can_write_project_setup(m.project_id)))
with check (exists (select 1 from meetings m where m.id = issue_agenda_refs.meeting_id
               and can_write_project_setup(m.project_id)));

-- ------------------------------------------------------------------ grants
-- Each table states its own; a table created by this migration inherits nothing
-- from any earlier `grant on all tables`.

-- An author edits their own words and nothing else about the comment. Without
-- the column list, the update policy above would also let them move a comment
-- onto another entity, change its author, or widen its visibility after the
-- fact -- the policy decides the row, the grant decides the columns.
grant select, insert, delete on comments to authenticated;
grant update (body, edited_at) on comments to authenticated;

grant select, insert, delete on comment_attachments to authenticated;

-- reviewed_by, reviewed_at and revision_at_review are outside the grant
-- entirely: a review is recorded by review_evidence() and stamped from the
-- register, so nobody can mark their own submission reviewed by writing the
-- column directly.
grant select, insert, delete on evidence to authenticated;
grant update (name, drawing_id, storage_path) on evidence to authenticated;

grant select, insert, delete on meetings to authenticated;
grant update (title, meeting_type, meeting_date, meeting_time, location, call_link,
              chair_id, status, notes) on meetings to authenticated;

grant select, insert, delete on meeting_agenda_items to authenticated;
grant update (position, heading, notes) on meeting_agenda_items to authenticated;

-- A person is added to a meeting or removed; changing their role is a delete
-- and an insert, so there is no update grant.
grant select, insert, delete on meeting_people to authenticated;

-- reference, raised_by, raised_at, closed_by, closed_at, rfi_responded_by and
-- rfi_responded_at are all outside the grant: they are the record of who did
-- what and when. Status moves through close_issue(), the RFI answer through
-- answer_rfi(), so neither can be forged by writing a column.
grant select, insert, delete on issues to authenticated;
grant update (title, description, category, person_id, programme_task_uid, offset_days,
              anchor, due_date_override, priority, visibility, rfi_question)
  on issues to authenticated;

grant select, insert, delete on issue_agenda_refs to authenticated;

alter view v_issues set (security_invoker = on);
alter view v_evidence set (security_invoker = on);
alter view v_comment_attachments set (security_invoker = on);
grant select on v_issues to authenticated;
grant select on v_evidence to authenticated;
grant select on v_comment_attachments to authenticated;
