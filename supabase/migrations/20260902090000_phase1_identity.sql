-- Phase 1 — identity, accounts, memberships, invitations.
-- Reference: docs/lovable-handover-notes.md §1b.
--
-- Naming note. §1b defines `organisations` as an ACCOUNT (one main contractor's
-- tenancy); §3's master-catalogue correction defines a second table of the same
-- name meaning a FIRM in the directory. Both cannot exist. `organisations` stays
-- the account here, because projects, memberships, invitations, the audit trail
-- and module_on all reference it; the catalogue firm is `catalogue_companies`.

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  email       text not null,
  phone       text,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz
);
create unique index profiles_email_key on profiles (lower(email));

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

create table organisations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  status        text not null default 'pending'
                check (status in ('pending','active','suspended','archived')),
  brand_colour  text not null default '#1E3A5F',
  logo_path     text,
  theme         text not null default 'light',
  modules       jsonb not null default '{}'::jsonb,
  subscription_tier text check (subscription_tier in ('core','compliance','complete')),
  approved_by   uuid references profiles(id), approved_at  timestamptz,
  suspended_by  uuid references profiles(id), suspended_at timestamptz,
  suspend_reason text,
  archived_by   uuid references profiles(id), archived_at  timestamptz,
  created_at    timestamptz not null default now()
);

-- A firm in one account's master catalogue. Phase 2 extends this; phase 1 needs
-- it because a membership names the firm the person belongs to.
create table catalogue_companies (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  name            text not null,
  address         text,
  created_at      timestamptz not null default now()
);
create unique index catalogue_companies_name_key
  on catalogue_companies (organisation_id, lower(name));

create table organisation_members (
  organisation_id uuid not null references organisations(id) on delete cascade,
  profile_id      uuid not null references profiles(id) on delete cascade,
  role            text not null check (role in ('admin','internal','consultant','client')),
  company_id      uuid references catalogue_companies(id) on delete set null,
  joined_at       timestamptz not null default now(),
  primary key (organisation_id, profile_id)
);
create index organisation_members_profile_idx on organisation_members (profile_id);

create table platform_owners (
  profile_id uuid primary key references profiles(id) on delete cascade,
  granted_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------

-- §3 makes projects.code globally unique. That is an isolation leak: a unique
-- violation would tell one account a code is in use by another. Scoped per
-- account instead.
create table projects (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  name            text not null,
  code            text not null,
  modules_override jsonb,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  unique (organisation_id, code)
);

create table project_members (
  project_id   uuid not null references projects(id) on delete cascade,
  profile_id   uuid not null references profiles(id) on delete cascade,
  project_role text not null default 'member'
               check (project_role in ('project_admin','member')),
  added_by     uuid references profiles(id),
  added_at     timestamptz not null default now(),
  primary key (project_id, profile_id)
);
create index project_members_profile_idx on project_members (profile_id);

-- ---------------------------------------------------------------------------
-- Account requests
-- ---------------------------------------------------------------------------

create table account_requests (
  id             uuid primary key default gen_random_uuid(),
  requested_by   uuid not null references profiles(id) on delete cascade,
  company_name   text not null,
  company_number text,
  contact_phone  text,
  intended_tier  text check (intended_tier in ('core','compliance','complete','undecided')),
  note           text,
  status         text not null default 'pending'
                 check (status in ('pending','approved','rejected','withdrawn')),
  reviewed_by    uuid references profiles(id),
  reviewed_at    timestamptz,
  review_note    text,
  organisation_id uuid references organisations(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index account_requests_requested_by_idx on account_requests (requested_by);
-- One live request per person at a time; approved/rejected/withdrawn may repeat.
create unique index account_requests_one_pending
  on account_requests (requested_by) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Invitations — one table, two scopes
-- ---------------------------------------------------------------------------

create table invitations (
  id              uuid primary key default gen_random_uuid(),
  scope           text not null check (scope in ('organisation','project')),
  organisation_id uuid not null references organisations(id) on delete cascade,
  project_id      uuid references projects(id) on delete cascade,
  email           text not null,
  role            text check (role in ('admin','internal','consultant','client')),
  company_id      uuid references catalogue_companies(id) on delete set null,
  project_role    text check (project_role in ('project_admin','member')),
  project_ids     uuid[] not null default '{}',
  token           text not null unique,
  invited_by      uuid not null references profiles(id),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '14 days',
  accepted_at     timestamptz, accepted_by uuid references profiles(id),
  revoked_at      timestamptz, revoked_by  uuid references profiles(id),
  constraint organisation_scope_shape check (
    scope <> 'organisation' or (project_id is null and role is not null)),
  constraint project_scope_shape check (
    scope <> 'project' or (project_id is not null and project_role is not null))
);
create index invitations_email_idx on invitations (lower(email));
create index invitations_organisation_idx on invitations (organisation_id);

-- ---------------------------------------------------------------------------
-- Platform audit — append only, for everyone, including platform owners
-- ---------------------------------------------------------------------------

create table platform_audit (
  id                 bigserial primary key,
  owner_id           uuid not null references profiles(id),
  organisation_id    uuid references organisations(id) on delete set null,
  subject_profile_id uuid references profiles(id) on delete set null,
  action             text not null,
  detail             jsonb not null default '{}'::jsonb,
  at                 timestamptz not null default now()
);
