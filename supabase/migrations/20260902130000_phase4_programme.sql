-- Phase 4 — the programme, and with it the date spine.
--
-- The second invariant: no date is ever typed. Every date in the product is
-- programme_task_uid + offset_days + anchor, resolved through due_date().
-- Re-importing the programme therefore reschedules the whole project without a
-- single write to any dependent record.
--
-- This migration adds the three tables. The function that makes them a spine is
-- in 20260902130100_phase4_due_date.sql.

-- One row per revision of the programme that has been loaded. Kept forever: it
-- is how "what moved between Rev 11 and Rev 12" stays answerable.
create table programme_imports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  label text not null,
  imported_by uuid references profiles(id),
  imported_at timestamptz not null default now(),
  row_count int not null default 0,
  -- What this revision did to the project, as reported back to the importer.
  -- A record of the diff, not a source of truth: every figure in it can be
  -- recomputed from programme_tasks.
  summary jsonb not null default '{}'::jsonb
);
create index on programme_imports (project_id, imported_at desc);

create table programme_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  -- The planner's own ID, stable across revisions. Unique per project only --
  -- two projects may each have a line "1120", so nothing may ever look a task
  -- up by uid alone.
  task_uid text not null,
  description text not null,
  start_date date not null,
  finish_date date not null,
  percent_complete int not null default 0 check (percent_complete between 0 and 100),
  level int not null check (level between 1 and 9),
  parent_uid text,
  task_type text not null check (task_type in ('Task','Summary','Milestone')),
  last_import_id uuid references programme_imports(id) on delete set null,
  -- Absent from the latest revision. Never deleted: records anchored to this
  -- line keep resolving a date, and are flagged as orphaned instead of
  -- silently losing one.
  removed boolean not null default false,
  removed_at timestamptz,
  constraint programme_tasks_uid_unique unique (project_id, task_uid),
  constraint programme_tasks_finishes_after_start check (finish_date >= start_date),
  -- A milestone is a single day by definition; a planner export that says
  -- otherwise has been mismapped.
  constraint programme_tasks_milestone_is_one_day
    check (task_type <> 'Milestone' or start_date = finish_date)
);
create index on programme_tasks (project_id, parent_uid);
create index on programme_tasks (project_id, finish_date);

-- Who is tracking which line. Per-person and private: a watchlist says what
-- someone is worried about, which is nobody else's business.
create table programme_watch (
  project_id uuid not null references projects(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  task_uid text not null,
  watched_at timestamptz not null default now(),
  primary key (project_id, profile_id, task_uid)
);
