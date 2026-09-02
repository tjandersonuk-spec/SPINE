-- Phase 4 — Row Level Security and column grants for the programme.

alter table programme_imports enable row level security;
alter table programme_tasks   enable row level security;
alter table programme_watch   enable row level security;

-- Everyone on the project reads the programme. A consultant who cannot see when
-- their package is due cannot plan around it, and the whole point of the spine
-- is that one set of dates is visible to everyone working to them.
create policy programme_tasks_select on programme_tasks for select to authenticated
using (can_see_project(project_id));

create policy programme_imports_select on programme_imports for select to authenticated
using (can_see_project(project_id));

-- No write policy on either table, deliberately. Rescheduling a project happens
-- through import_programme() and nowhere else, so there is no path by which a
-- single line can be edited into disagreeing with the revision it came from.
-- A project admin is not exempt: they did not produce the programme either.

-- A watchlist is private. Both halves are scoped to the caller, so this holds
-- even for an account admin: seeing which lines a person is anxious about is
-- not an administrative need.
create policy programme_watch_own on programme_watch for select to authenticated
using (profile_id = auth.uid() and can_see_project(project_id));

create policy programme_watch_insert on programme_watch for insert to authenticated
with check (profile_id = auth.uid() and can_see_project(project_id));

create policy programme_watch_delete on programme_watch for delete to authenticated
using (profile_id = auth.uid());

-- Grants. A table created by this migration inherits nothing from any earlier
-- `grant on all tables`, so each states its own -- and states only what its
-- policies are meant to allow.

-- Read-only to everyone. The definer functions do the writing, so `authenticated`
-- needs no insert, update or delete on either table: without the grant, a
-- crafted post to PostgREST is refused at the privilege layer before RLS is
-- even consulted.
grant select on programme_tasks to authenticated;
grant select on programme_imports to authenticated;

-- The watch table is the one thing a person writes directly. There is no update
-- grant: a watch is added or dropped, never edited, and an update grant would
-- let someone move a row onto another person's profile_id.
grant select, insert, delete on programme_watch to authenticated;

revoke all on function import_programme(uuid, text, jsonb) from public;
grant execute on function import_programme(uuid, text, jsonb) to authenticated;
revoke all on function watch_programme_line(uuid, text) from public;
grant execute on function watch_programme_line(uuid, text) to authenticated;
revoke all on function unwatch_programme_line(uuid, text) from public;
grant execute on function unwatch_programme_line(uuid, text) to authenticated;
grant execute on function due_date(uuid, text, int, text, date) to authenticated;
grant execute on function anchor_state(uuid, text) to authenticated;
grant execute on function programme_dependents(uuid, text) to authenticated;

-- The rollup view is derived from programme_tasks and is reached by the same
-- people. It runs security_invoker so the underlying policy still decides rows,
-- rather than the view becoming a way around it.
alter view v_programme_rollup set (security_invoker = on);
grant select on v_programme_rollup to authenticated;
