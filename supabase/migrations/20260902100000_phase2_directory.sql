-- Phase 2 — projects, the master catalogue, the directory, and disciplines.
-- Reference: handover §3 and its "Review corrections — master catalogue" and
-- "Review corrections — disciplines and templates" sections.
--
-- The shape that matters here is the SNAPSHOT. A project's directory is not a
-- join to the catalogue; it is a copy taken at the moment a firm is selected. A
-- project record is the historic account of how someone was appointed, and a
-- catalogue tidy-up two years later must not rewrite it. Every column marked
-- "snapshot" below is copied once and never re-read.

-- ---------------------------------------------------------------------------
-- Projects gain the fields §3 defines
-- ---------------------------------------------------------------------------

alter table projects
  add column if not exists client_name text,
  add column if not exists address text,
  add column if not exists form_of_contract text,
  add column if not exists riba_stage text check (riba_stage in ('0','1','2','3','4','5','6','7')),
  add column if not exists start_on_site date,
  add column if not exists practical_completion date,
  add column if not exists description text;

-- Column privileges, per the standing rule: a policy that allows the row does
-- not decide the columns. organisation_id and created_by stay out of reach.
grant update (name, code, client_name, address, form_of_contract, riba_stage,
              start_on_site, practical_completion, description)
  on projects to authenticated;

-- ---------------------------------------------------------------------------
-- Disciplines — a published default, forked per account
-- ---------------------------------------------------------------------------

create table disciplines (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) on delete cascade, -- null = published
  code            text not null,
  name            text not null,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create unique index disciplines_account_code on disciplines (organisation_id, code)
  where organisation_id is not null;
create unique index disciplines_published_code on disciplines (code)
  where organisation_id is null;

-- A generic starting list, not licensed content. An account forks it and then
-- owns its copy; editing the published set never touches a fork.
insert into disciplines (organisation_id, code, name, sort_order) values
  (null, 'A',   'Architecture',                 10),
  (null, 'S',   'Structural engineering',       20),
  (null, 'MEP', 'Mechanical, electrical, public health', 30),
  (null, 'C',   'Civil engineering',            40),
  (null, 'FS',  'Fire safety',                  50),
  (null, 'FA',  'Facade',                       60),
  (null, 'L',   'Landscape',                    70),
  (null, 'AC',  'Acoustics',                    80),
  (null, 'PD',  'Principal designer (CDM)',     90),
  (null, 'PDB', 'Principal designer (BSA)',    100),
  (null, 'BC',  'Building control',            110),
  (null, 'SU',  'Surveying',                   120);

create table project_disciplines (      -- per-project overrides
  project_id      uuid not null references projects(id) on delete cascade,
  discipline_code text not null,
  required        boolean not null default true,
  primary key (project_id, discipline_code)
);

-- ---------------------------------------------------------------------------
-- The master catalogue: firms and the individuals at them, per account
-- ---------------------------------------------------------------------------

alter table catalogue_companies
  add column if not exists company_type text
    check (company_type in ('consultant','subcontractor','contractor','client')),
  add column if not exists notes text;

create table contacts (
  id                   uuid primary key default gen_random_uuid(),
  catalogue_company_id uuid not null references catalogue_companies(id) on delete cascade,
  name                 text not null,
  job_role             text,
  email                text,
  phone                text,
  created_at           timestamptz not null default now()
);
create unique index contacts_company_name on contacts (catalogue_company_id, lower(name));

-- ---------------------------------------------------------------------------
-- The project link — snapshots, not joins
-- ---------------------------------------------------------------------------

create table companies (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references projects(id) on delete cascade,
  catalogue_company_id uuid references catalogue_companies(id) on delete set null,
  parent_id            uuid references companies(id) on delete set null,  -- sub-consultants
  name                 text not null,   -- snapshot
  address              text,            -- snapshot
  originator_code      text not null,
  company_type         text not null
    check (company_type in ('consultant','subcontractor','contractor','client')),
  notes                text,
  created_at           timestamptz not null default now(),
  unique (project_id, originator_code),          -- drives the BEP naming table
  unique (project_id, catalogue_company_id)      -- a firm appears once per project
);
create index companies_project_idx on companies (project_id);

create table company_disciplines (
  company_id      uuid not null references companies(id) on delete cascade,
  discipline_code text not null,
  primary key (company_id, discipline_code)
);

create table project_people (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  company_id  uuid not null references companies(id) on delete cascade,
  contact_id  uuid references contacts(id) on delete set null,
  -- set when this person holds a login on this account; the guard below reads it
  profile_id  uuid references profiles(id) on delete set null,
  name        text not null,   -- snapshot
  job_role    text,            -- snapshot
  email       text,            -- snapshot
  phone       text,            -- snapshot
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (project_id, contact_id)
);
create unique index one_primary_per_company on project_people (company_id) where is_primary;
create index project_people_project_idx on project_people (project_id);

-- Proven by the prototype's audits and easy to lose: a person who holds a login
-- cannot be removed from the directory. A policy cannot say why, so this does.
create or replace function guard_directory_person_delete()
returns trigger language plpgsql as $$
begin
  if old.profile_id is not null then
    raise exception 'that person holds a login on this project; remove their access first';
  end if;
  return old;
end $$;

create trigger project_people_no_delete_with_login
  before delete on project_people
  for each row execute function guard_directory_person_delete();

-- ---------------------------------------------------------------------------
-- Appointment documents
-- ---------------------------------------------------------------------------

create table appointment_documents (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  slot          text not null check (slot in
                  ('competency_statement','team_cvs','appointment','scope_of_work','other')),
  storage_path  text not null,
  filename      text not null,
  uploaded_by   uuid references profiles(id) on delete set null,
  uploaded_at   timestamptz not null default now(),
  approved      boolean not null default false,
  approved_by   uuid references profiles(id) on delete set null,
  approved_at   timestamptz,
  superseded_by uuid references appointment_documents(id) on delete set null,
  unique (company_id, slot)
);
