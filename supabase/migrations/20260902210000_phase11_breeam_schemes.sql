-- Phase 11, part one -- the BREEAM framework.
--
-- SHIP NO BREEAM CONTENT. The technical manual is BRE copyright with
-- controlled access, so none of its wording, criteria or credit structure is
-- in this migration, in a seed, or anywhere else in the repository. Every
-- table below starts empty and computes correctly the moment somebody who
-- holds the licence loads their own rows. Do not add a starter set later.
--
-- What ships is the machinery: sections, weightings, rating thresholds,
-- issues, credits and minimum standards, all derived rather than stated.

-- A scheme is a VERSION of the standard, and a project holds several.
--
-- UKNC 2018 stays live for projects registered under the older building
-- regulations while newer ones sit on later versions, and the sections,
-- weightings and issue structure differ between them. Switching
-- projects.breeam_scheme_id switches the entire framework -- which is why the
-- framework hangs off the scheme and not off the project.
create table breeam_schemes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  version text not null check (btrim(version) <> ''),
  name text,
  -- The weighting set in force. One of building_types, checked below rather
  -- than trusted, because a weighting set nobody holds scores everything zero
  -- and does it silently.
  building_type text,
  building_types text[] not null default '{}',
  -- [{code, name, stated}] -- `stated` is the assessor's own section total and
  -- is a CROSS-CHECK ONLY. The credits available for a section are summed from
  -- the credit rows by v_breeam_sections; a stated figure that disagrees is
  -- reported, never used. The spreadsheet this was modelled from states section
  -- totals on one tab and lists credits on another, and six of ten sections
  -- disagree -- with the score computed against the stated figure.
  sections jsonb not null default '[]'::jsonb,
  -- {building_type: {section_code: 0.11}} -- a fraction, not a percentage.
  weightings jsonb not null default '{}'::jsonb,
  -- [{name, min}] -- min is a fraction of the weighted total.
  ratings jsonb not null default '[]'::jsonb,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, version)
);
create index on breeam_schemes (project_id);

-- The three jsonb columns carry structure the scoring maths reads, so their
-- shape is checked at write time. An array where an object is expected, or a
-- weighting held as the string '11', is the sort of thing that turns a score
-- into null three screens away from the row that caused it.
create or replace function breeam_sections_are_valid(v jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(v) = 'array' and not exists (
    select 1 from jsonb_array_elements(v) e
    where jsonb_typeof(e) <> 'object'
       or coalesce(btrim(e->>'code'), '') = ''
       or (e ? 'stated' and jsonb_typeof(e->'stated') not in ('number','null'))
       or exists (select 1 from jsonb_object_keys(e) k
                  where k not in ('code','name','stated')));
$$;

create or replace function breeam_weightings_are_valid(v jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(v) = 'object' and not exists (
    select 1 from jsonb_each(v) t
    where jsonb_typeof(t.value) <> 'object'
       or exists (select 1 from jsonb_each(t.value) s
                  where jsonb_typeof(s.value) <> 'number'));
$$;

create or replace function breeam_ratings_are_valid(v jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(v) = 'array' and not exists (
    select 1 from jsonb_array_elements(v) e
    where jsonb_typeof(e) <> 'object'
       or coalesce(btrim(e->>'name'), '') = ''
       or jsonb_typeof(e->'min') <> 'number'
       or exists (select 1 from jsonb_object_keys(e) k where k not in ('name','min')));
$$;

-- Referenced by breeam_issues' composite foreign key below, so it is declared
-- before anything points at it.

-- Referenced by breeam_issues' composite foreign key below, so it is declared
-- before anything points at it.
alter table breeam_schemes add unique (id, project_id);

alter table breeam_schemes
  add constraint breeam_schemes_sections_shape check (breeam_sections_are_valid(sections)),
  add constraint breeam_schemes_weightings_shape check (breeam_weightings_are_valid(weightings)),
  add constraint breeam_schemes_ratings_shape check (breeam_ratings_are_valid(ratings)),
  -- The active weighting set must be one the scheme holds. Null is fine: a
  -- scheme mid-load has no type yet and scores nothing rather than lying.
  add constraint breeam_schemes_type_is_held
    check (building_type is null or building_type = any(building_types));

grant execute on function breeam_sections_are_valid(jsonb) to authenticated;
grant execute on function breeam_weightings_are_valid(jsonb) to authenticated;
grant execute on function breeam_ratings_are_valid(jsonb) to authenticated;

-- Which scheme is live on this project. A project with schemes but no active
-- one falls back to its earliest, so loading a framework makes it visible
-- without a second step.
alter table projects
  add column breeam_scheme_id uuid references breeam_schemes(id) on delete set null;

-- An issue -- 'Man 01'. Belongs to a scheme, sits in a section, and carries the
-- assessor's advisory wording and its minimum standards.
create table breeam_issues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  scheme_id uuid not null references breeam_schemes(id) on delete cascade,
  code text not null check (btrim(code) <> ''),
  title text,
  -- Matches a sections[].code on the scheme. Text rather than a foreign key
  -- because the sections are a scheme column, and an issue whose section has
  -- not been loaded yet must still import.
  section text,
  note text,
  -- {rating: {credits, note}} -- STRUCTURED, not prose. This is what lets the
  -- report say "Excellent needs four credits here and two are targeted"
  -- instead of printing FAIL in a column. A stored pass/fail flag would go
  -- stale the moment a credit moved.
  min_standards jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (scheme_id, code)
);
create index on breeam_issues (project_id);
create index on breeam_issues (scheme_id, section);

create or replace function breeam_min_standards_are_valid(v jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(v) = 'object' and not exists (
    select 1 from jsonb_each(v) t
    where jsonb_typeof(t.value) <> 'object'
       or jsonb_typeof(t.value->'credits') not in ('number','null')
       or exists (select 1 from jsonb_object_keys(t.value) k
                  where k not in ('credits','note')));
$$;

alter table breeam_issues
  add constraint breeam_issues_min_standards_shape
    check (breeam_min_standards_are_valid(min_standards)),
  -- An issue belongs to the scheme's project. Two projects on the same account
  -- both holding 'Man 01' is normal; an issue pointing at another project's
  -- scheme is not, and the composite key is what refuses it.
  add constraint breeam_issues_scheme_matches_project
    foreign key (scheme_id, project_id) references breeam_schemes (id, project_id);


grant execute on function breeam_min_standards_are_valid(jsonb) to authenticated;

-- ------------------------------------------------------- credits are items
--
-- A BREEAM credit is a tracked item, per §1a: a prompt, a heading, an owner,
-- a date off the programme, evidence, a discussion and a strike-out is the
-- same record as a planning condition. So this phase adds no credits table --
-- it adds the link from tracked_items to the issue the credit sits under.
--
-- That link is a COLUMN and not an ext key, because a reference to another
-- record is a reference: a jsonb 'issue' string cannot cascade, cannot be
-- joined without a cast, and cannot stop an issue being deleted out from
-- under its credits.
alter table tracked_items
  add column breeam_issue_id uuid references breeam_issues(id) on delete cascade;
create index on tracked_items (breeam_issue_id);

alter table tracked_items
  add constraint tracked_items_breeam_has_issue
    check ((kind = 'breeam') = (breeam_issue_id is not null));

-- The import dedups on the issue and the requirement text, so that pair is
-- enforced rather than reviewed: re-importing a corrected tracker must update
-- the credit that is there, never add a second one beside it.
create unique index tracked_items_breeam_requirement
  on tracked_items (breeam_issue_id, title) where kind = 'breeam';

-- Phase 9 declared which ext keys a BREEAM credit may carry. Phase 11 is what
-- reads the numbers, so it also types the VALUES: `(ext->>'credits_available')
-- ::int` on a key somebody set to "two" raises inside a scoring view, three
-- screens from the row that caused it.
create or replace function breeam_ext_is_valid(v jsonb)
returns boolean
language sql
immutable
as $$
  select v is null or (
    jsonb_typeof(v) = 'object'
    and not exists (
      select 1 from jsonb_object_keys(v) k
      where k not in ('section','issue','credits_available','credits_targeted',
                      'credits_achieved','weighting','is_prerequisite','minimum_standard'))
    and not exists (
      select 1 from jsonb_each(v) t
      where (t.key in ('credits_available','credits_targeted','credits_achieved','weighting')
             and jsonb_typeof(t.value) not in ('number','null'))
         or (t.key = 'is_prerequisite' and jsonb_typeof(t.value) not in ('boolean','null')))
    -- Targeted and achieved cannot exceed what the credit offers. A tracker
    -- claiming three of two credits is a typo, and catching it here is the
    -- difference between a rejected row and a score nobody can reconcile.
    and coalesce((v->>'credits_targeted')::numeric, 0)
          <= coalesce((v->>'credits_available')::numeric, 0)
    and coalesce((v->>'credits_achieved')::numeric, 0)
          <= coalesce((v->>'credits_available')::numeric, 0)
  );
$$;

-- Replacing a check function's body does not re-check the rows already there,
-- and Postgres treats VALIDATE on an already-valid check as a no-op. Dropping
-- and re-adding is what makes the tightened rule apply to the existing table.
alter table tracked_items drop constraint tracked_items_breeam_ext;
alter table tracked_items add constraint tracked_items_breeam_ext
  check (kind <> 'breeam' or breeam_ext_is_valid(ext));
