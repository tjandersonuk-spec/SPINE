-- Phase 5, part two -- the drawing register, packs and transmittals.
--
-- No file is ever stored here. The CDE holds the drawing; this holds what is
-- due, what has arrived, at what revision, and who has been given it.

-- ------------------------------------------------------------ the raw import
-- Append-only and never edited. It is the evidence of what the CDE said on a
-- given day, which is the only thing that makes a reconciliation arguable.
create table document_imports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  label text not null,
  imported_by uuid references profiles(id),
  imported_at timestamptz not null default now(),
  row_count int not null default 0
);
create index on document_imports (project_id, imported_at desc);

create table document_rows (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  import_id uuid not null references document_imports(id) on delete cascade,
  document_number text not null,
  title text,
  revision text not null,
  workflow_status text,
  file_format text not null
);
create index on document_rows (project_id, import_id, document_number);

-- ---------------------------------------------------------- the register
-- Planned and delivered are the same row. A drawing that is expected but has
-- not arrived is a register row with no revision -- not a separate list, because
-- two lists is how something ends up on neither.
create table drawing_register (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  document_number text not null,
  title text,
  -- Null until the drawing actually arrives. Planned rows carry the number and
  -- the date it is due, and nothing else.
  revision text,
  workflow_status text,
  cde_url text,
  -- The four anchor columns. A drawing's date comes from here and nowhere else;
  -- in particular it never comes from a pack's programme link.
  programme_task_uid text,
  offset_days int not null default 0,
  anchor text not null default 'finish' check (anchor in ('start','finish')),
  due_date_override date,
  added_on date not null default current_date,
  last_synced date,
  unique (project_id, document_number)
);
create index on drawing_register (project_id, programme_task_uid);

-- ---------------------------------------------------------------- packs
-- A named, reusable group. It exists because the same grouping gets issued more
-- than once, and rebuilding a forty-drawing selection by hand is how one gets
-- left out.
create table drawing_packs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,
  name text not null,
  purpose text,
  owner_id uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (project_id, reference)
);

-- References, not copies. Change a drawing and every pack holding it changes;
-- a pack that snapshotted revisions would be a stale document pretending to be
-- a live one.
create table drawing_pack_items (
  pack_id uuid not null references drawing_packs(id) on delete cascade,
  drawing_id uuid not null references drawing_register(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (pack_id, drawing_id)
);

-- A pack may be linked to a programme line as a RESOURCE ONLY, so whoever is
-- doing that piece of work can find the drawings for it. This table must never
-- influence a date: a drawing's due date comes from its own anchor columns on
-- drawing_register. Any query that joins this while computing a date is wrong.
create table drawing_pack_programme (
  pack_id uuid not null references drawing_packs(id) on delete cascade,
  programme_task_uid text not null,
  primary key (pack_id, programme_task_uid)
);

-- --------------------------------------------------------- transmittals
-- Evidence that something was issued. Append-only: a correction is a new
-- transmittal, because a record that can be edited afterwards is not evidence.
create table transmittals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,
  issue_date date not null default current_date,
  method text not null,
  reason text,
  to_company_id uuid references companies(id),
  to_person_id uuid references project_people(id),
  issued_by uuid references profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  unique (project_id, reference)
);
create index on transmittals (project_id, issue_date desc);

create table transmittal_items (
  transmittal_id uuid not null references transmittals(id) on delete cascade,
  drawing_id uuid not null references drawing_register(id),
  -- Frozen at issue and never recalculated. If it followed the register, the
  -- transmittal would stop being evidence of anything. A trigger enforces it.
  revision_at_issue text not null,
  primary key (transmittal_id, drawing_id)
);

create table transmittal_recipients (
  transmittal_id uuid not null references transmittals(id) on delete cascade,
  company_id uuid not null references companies(id),
  person_id uuid references project_people(id),
  distribution text not null default 'information'
    check (distribution in ('action','information')),
  primary key (transmittal_id, company_id, person_id)
);

-- The revision issued is written once. Not "should not be updated" -- cannot be.
create or replace function freeze_revision_at_issue()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.revision_at_issue is distinct from old.revision_at_issue then
    raise exception
      'revision_at_issue is frozen: a transmittal records what was issued at the time. '
      'Issue a new transmittal instead.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger transmittal_items_frozen
before update on transmittal_items
for each row execute function freeze_revision_at_issue();

-- Per-project reference sequences. Typed references produce duplicates and gaps
-- within a month, so nothing here is ever typed by a user.
create table project_sequences (
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null,
  last_value int not null default 0,
  primary key (project_id, kind)
);

create or replace function next_reference(p_project uuid, p_kind text, p_prefix text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_n int;
begin
  insert into project_sequences (project_id, kind, last_value)
  values (p_project, p_kind, 1)
  on conflict (project_id, kind)
    do update set last_value = project_sequences.last_value + 1
  returning last_value into v_n;
  return p_prefix || '-' || lpad(v_n::text, 3, '0');
end;
$$;
