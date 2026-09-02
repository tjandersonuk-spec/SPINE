-- Phase 3 — the design responsibility matrix.
-- Reference: handover §3 (DRM tables and v_drm_gaps), §1a (templates are a
-- tenant asset forked from a published default).
--
-- This is the module the whole application exists for, and the shape follows
-- from the first spine. A matrix item names a LEAD DISCIPLINE, never a company.
-- Which company that resolves to is asked live, so novating the architect moves
-- every item they led without a single write to the matrix.
--
-- A gap is one of two things, and the distinction matters because the fix is
-- different: an applicable item with no lead discipline at all, which is a
-- decision nobody has made; or an item whose lead discipline nobody appointed
-- holds, which is a decision made and then not resourced.
--
-- The library follows the template rule: a published default, a fork per
-- account, and a versioned snapshot taken into each project. Editing the
-- library never reaches a project that already loaded a copy — a matrix is a
-- record of who was responsible for what, and rewriting it retrospectively
-- would destroy the thing it is for.

-- The version of the library this project's matrix was taken from. Stamped at
-- load and never re-read: it records which edition of the standard the job was
-- set up against, which is a fact about the past.
alter table projects add column if not exists drm_library_version text;

create table drm_categories (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) on delete cascade, -- null = published
  code            text not null,
  name            text not null,
  sort_order      int not null default 0
);
create unique index drm_categories_account_code on drm_categories (organisation_id, code)
  where organisation_id is not null;
create unique index drm_categories_published_code on drm_categories (code)
  where organisation_id is null;

create table drm_library_items (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid references organisations(id) on delete cascade,
  library_version         text not null default 'published-1',
  ref                     text not null,
  category_code           text not null,
  item                    text not null,
  -- Nullable on purpose. Three interface items ship with no default lead
  -- because there is no right answer in general: who owns the facade-to-frame
  -- junction is a decision each project has to make consciously, and a default
  -- would let it be made by not looking.
  default_lead_discipline text,
  cdp_likely              boolean not null default false,
  guidance_note           text,
  sort_order              int not null default 0,
  created_at              timestamptz not null default now()
);
create unique index drm_library_account_ref
  on drm_library_items (organisation_id, library_version, ref) where organisation_id is not null;
create unique index drm_library_published_ref
  on drm_library_items (library_version, ref) where organisation_id is null;

-- The project's own copy. Taken once, at load, and independent from then on.
create table drm_items (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  library_item_id   uuid references drm_library_items(id) on delete set null, -- null = bespoke
  ref               text not null,
  category_code     text not null,
  item              text not null,
  lead_discipline   text,                    -- null = gap, and a deliberate one is still a gap
  transfers_at_stage text,
  cdp_package       text,
  level_of_information text,
  applicable        boolean not null default true,
  guidance_note     text,
  notes             text,
  created_at        timestamptz not null default now(),
  unique (project_id, ref)
);
create index drm_items_project_idx on drm_items (project_id);

-- Everyone else's involvement. The lead is on the item; these are the
-- supporting, reviewing, contributing, approving and informed disciplines.
create table drm_roles (
  drm_item_id     uuid not null references drm_items(id) on delete cascade,
  discipline_code text not null,
  role_code       text not null check (role_code in ('S','R','C','A','I')),
  primary key (drm_item_id, discipline_code)
);
