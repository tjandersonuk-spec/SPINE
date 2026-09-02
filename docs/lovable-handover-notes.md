# Lovable handover notes — HBC Design Management Platform

Everything needed to rebuild the prototype as a live multi-user app on Lovable + Supabase. Written to be pasted into Lovable in sections, not all at once.

---

## 1. Stack

- **Lovable** front end (React + Tailwind).
- **Supabase**: Postgres, Auth, Storage, Row Level Security, Edge Functions for scheduled email.
- **Resend** or **Postmark** for transactional and digest email.
- No other services. Charts can be Recharts; the Gantt in Phase 3 can be a custom SVG component.

---

## 1a. Read this before the schema — what to build differently from the prototype

The prototype grew module by module and its test suites kept it honest, but a product built
to be licensed to other main contractors should not copy its structure. Five things below
supersede what the later sections say wherever they conflict. The later sections are still the
right description of *behaviour*; this section is the right description of *shape*.

### One tracked-item engine, not five tables

Planning conditions, building control items, scope of service lines, BREEAM credits and every
checklist are the same record: a prompt, a heading, an owner (company and person), a date off
the programme, evidence, a discussion and a strike-out. The prototype has them as separate
implementations because they arrived one at a time. Build **one** table:

```sql
create table tracked_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null,          -- planning | bc | scope | breeam | checklist:<type>
  reference text not null, heading text, title text not null, prompt text,
  discipline text,
  required boolean not null default true,
  status text not null default 'Not started',
  response text,
  company_id uuid references companies(id), person_id uuid references profiles(id),
  programme_task_uid text, offset_days int default 0, anchor text default 'finish',
  due_override date,
  custom boolean not null default false,
  ext jsonb default '{}',      -- kind-specific: credits, weighting, quotation dates, RIBA stage
  visibility jsonb,            -- see below
  unique (project_id, kind, reference)
);
```

`ext` carries what differs by kind — BREEAM's credits available, targeted and achieved; a
utility's enquiry and quotation dates; a scope line's RIBA stage. Keep it small and typed in
the application layer; if a kind's `ext` grows past six or seven keys it has earned a side table.
The derived-state view is one view with a `case` on `kind`, and the evidence and comment tables
already attach polymorphically. The schema sections later in this document that define separate
`planning_conditions`, `building_control`, `scope_items`, `breeam_credits` and `checklists`
tables describe the *fields*; fold them into this one.

### One visibility primitive, not four rules

The prototype has four: tasks (empty distribution = everyone), risks (empty = nobody but the
named), change requests (both parties plus named), pre-construction (HBC only). Each is right
in isolation and together they are thirty policies to get subtly wrong. Put one structure on
every record that has an audience, and one function that reads it:

```sql
-- visibility jsonb on any table:
-- {"mode":"project"}                          everyone on the project
-- {"mode":"named","people":[...]}            only the listed profiles (+ raiser, owner)
-- {"mode":"parties","companies":[...],"people":[...]}   the company trees plus named
-- {"mode":"internal"}                        the tenant's own staff only

create or replace function can_see(p_project uuid, v jsonb, raiser uuid, owner uuid)
returns boolean language sql stable security definer as $$
  select is_admin(p_project)
      or auth.uid() in (raiser, owner)
      or (v->>'mode' = 'project')
      or (v->>'mode' = 'internal' and member_role(p_project) in ('admin','internal'))
      or (v->>'mode' in ('named','parties')
          and (v->'people') ? auth.uid()::text)
      or (v->>'mode' = 'parties'
          and exists (select 1 from jsonb_array_elements_text(v->'companies') c
                      where c::uuid in (select my_company_tree(p_project))))
$$;
```

Every `select` policy becomes `using (can_see(project_id, visibility, raised_by, person_id))`.
Tasks default to `project`, risks and change requests to `parties` or `named`, pre-construction
to `internal`. The admin override lives in one place. This is the difference between a security
model and a pile of exceptions, and it is what a licensing customer's IT review will read.

### Organisations above projects, and consultants who belong to several

*The full platform layer — sign-up, invitations, the platform owner, entitlements — is in §1b.
This subsection is the summary that motivates it.*

Everything in the prototype is keyed on `project_id`. Licensing needs a tenant above that, and
the hard part is not the tenant — it is that the same structural engineer works for HBC and for
the next contractor you license to, with one login.

```sql
create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null, slug text unique not null,
  brand_colour text default '#1E3A5F', logo_path text, theme text default 'light',
  modules jsonb default '{}'          -- entitlements; see below
);
alter table projects add column organisation_id uuid not null references organisations(id);

-- a person is one profile; membership is per organisation
create table organisation_members (
  organisation_id uuid references organisations(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  role text not null,                  -- admin | internal | consultant | client
  company_id uuid references companies(id),
  primary key (organisation_id, profile_id)
);
```

`member_role(project_id)` resolves through `projects.organisation_id` to
`organisation_members`. A consultant sees each contractor's projects only through that
contractor's membership, and never sees that the other contractor exists. This is also the
commercial flywheel: consultants who already use it on HBC's jobs are the sales channel to
the next tenant, so their experience — the consultant front — is the thing to get right.

The master catalogue is per organisation. Two tenants may both hold "Bellhouse Architects"
as separate catalogue rows; that is correct, because each tenant's relationship with them is
separate. Do not attempt a shared global company registry — it is a data-protection and
commercial-confidence problem you do not need.

### Templates are a tenant asset with a published default

The 464 checklist items, the DRM library, the standard scope and the discipline list are the
licensable IP. The prototype holds them as one singleton. Build them as rows owned by an
organisation, with a `published` set that ships with the product:

```sql
alter table checklist_templates add column organisation_id uuid references organisations(id);
-- null organisation_id = the published default that every tenant starts from
```

A new tenant forks the published set on creation; edits stay theirs; a product update to the
published set is offered as a diff, never applied silently. The same three-line shape applies
to `drm_library`, `scope_template` and `disciplines`.

### Entitlements — modules per tenant, one codebase

Do not build separate applications. One codebase, and a module is switched on per tenant (and
optionally per project) by `organisations.modules`. The core cannot be turned off, because
nothing works without the directory and the programme — those are the spines. Everything else
is an entitlement:

| Tier | Modules |
|---|---|
| Core — always on | projects, directory, disciplines, DRM, programme, register, packs, transmittals, tasks, meetings, comments, evidence, audit |
| Compliance | planning conditions, building control, building safety, BREEAM, checklists, scope of service |
| Commercial | fees and cashflow, pre-construction budget, risk and opportunity, change requests |

This gives three things at once: HBC phase-in by switching modules on per project, a tiered
price list, and an upsell path. The prototype's Settings page shows the shape.

### Snapshots — the one stored-derived table

A nightly job writes one row per project with the derived headline numbers. It is the only
place a derived value is stored, and it is not really an exception: a snapshot is a fact
*about a date*, which is what a trend needs and what nothing else keeps.

```sql
create table snapshots (
  project_id uuid references projects(id) on delete cascade,
  date date not null,
  issued int, anticipated int, overdue int, open_tasks int, drm_gaps int,
  risk_expected numeric, certified numeric, client_done int, client_total int,
  primary key (project_id, date)
);
```

Never read a live figure from it. It exists for burn-up and trend charts only.

### What the prototype gets right and should be copied exactly

The two spines. Derive-never-store, as SQL views with the assertions from the seven test suites
ported as tests. The polymorphic evidence and comment tables. The admin override as one
function. The brand-only customiser with semantic colours fixed. The consultant front. And the
change control classification restricted to the PDB by policy, not by hiding a control.

---

## 1b. The platform layer — hosts, people, invitations, and the owner above them

Nothing in this section is in the prototype. It is the layer the product needs so that more
than one main contractor can use it, so that a consultant who works for two of them has one
login, and so that you can run it. Build it first — prompt 1 in the sequence — because every
policy in §4 references it and it is the hardest thing to change once projects exist.

### Three levels

```
platform owner  ─── sees every host; creates, approves, suspends; sets entitlements
   └── host     ─── one main contractor's account; owns projects, catalogue, templates
        └── membership ─── a person × a host × a role × a company
              └── person ─── one human, one login, any number of memberships
```

```sql
create table organisations (               -- a HOST: one main contractor's account
  id uuid primary key default gen_random_uuid(),
  name text not null, slug text unique not null,
  status text not null default 'pending'    -- pending | active | suspended
    check (status in ('pending','active','suspended')),
  brand_colour text default '#1E3A5F', logo_path text, theme text default 'light',
  modules jsonb not null default '{}',      -- entitlements: {"compliance":true,"commercial":false,...}
  subscription_tier text,                   -- core | compliance | complete
  approved_by uuid, approved_at timestamptz,
  created_at timestamptz default now()
);

create table profiles (                    -- a PERSON: one row per human, one login
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null, email text not null unique,
  phone text, created_at timestamptz default now()
);

create table organisation_members (        -- a MEMBERSHIP: how a person belongs to a host
  organisation_id uuid not null references organisations(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role text not null check (role in ('admin','internal','consultant','client')),
  company_id uuid references companies(id),  -- which of the host's companies they belong to
  joined_at timestamptz default now(),
  primary key (organisation_id, profile_id)
);

create table platform_owners (             -- the layer above every host
  profile_id uuid primary key references profiles(id) on delete cascade,
  granted_at timestamptz default now()
);
```

`projects.organisation_id` (added in §1a) is what scopes everything. `member_role(project_id)`
resolves through the project's organisation to `organisation_members` for `auth.uid()`.

### Host isolation is absolute

A person with memberships in two hosts sees each host's projects only through that host's
membership — and **must never be able to discover that the other host exists.** No list of
"your organisations" that reveals names to a member of only one; the switcher shows only hosts
the person is a member of, which for most consultants is exactly the hosts they already know
about. No shared company or people registry across hosts: two hosts may each hold "Bellhouse
Architects" as separate catalogue rows, and that is correct, because each host's relationship
with them is separate.

### Invitations — consent, not email matching

This is the rule that makes cross-host membership defensible, and it is easy to get wrong in a
way that looks like a feature.

```sql
create table invitations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  email text not null,
  role text not null, company_id uuid references companies(id),
  project_ids uuid[] default '{}',         -- optionally scoped to projects
  token text not null unique,
  invited_by uuid not null references profiles(id),
  created_at timestamptz default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references profiles(id)
);
```

Adding a person to a host's directory creates a row here and shows an **Invite** button. The
invite is sent by email with the token. The person clicks it, signs in — creating a login if
they have none — and *accepting* inserts the `organisation_members` row. Until then, the
directory entry is a name and an email and nothing more: it grants no access, and the person
does not appear in any list a member of that host can see as "a member".

**Do not match on email.** If typing an address into a directory were enough to create a
membership, anyone who knew a consultant's address could pull them into a project they never
agreed to join, and their existing employer would have no way to see it had happened. The
outcome you want — one person seeing projects across two hosts — is exactly what happens once
they accept both invites. The consent step is what makes that outcome something a data
protection review will accept.

A person can decline or ignore an invite; it expires. A host admin can revoke one. An accepted
invite that is later revoked removes the membership; the person keeps their login and their
other memberships untouched.

### Sign-up

The marketing site's sign-up creates an `organisations` row in `pending` status and a
`profiles` row for the first admin, with a membership in `admin` role. Nothing is usable until
a platform owner sets `status = 'active'`. Approval is a human step by design; the marketing
page says so.

### The platform owner

You. Able to: list every host; approve a pending one; suspend one (members cannot sign in);
set `modules` and `subscription_tier`; see any host's projects for support. **No host admin can
see this layer or that it exists.**

```sql
create or replace function is_platform_owner()
returns boolean language sql stable security definer as $$
  select exists (select 1 from platform_owners where profile_id = auth.uid())
$$;
```

Every `select` policy on host-scoped tables gains `or is_platform_owner()`. Every action taken
under that bypass writes to its own table:

```sql
create table platform_audit (
  id bigserial primary key,
  owner_id uuid not null references profiles(id),
  organisation_id uuid references organisations(id),
  action text not null, detail jsonb,
  at timestamptz default now()
);
```

This is the account that can see everything, so it is the account whose every action must be
visible to a later reviewer. Do not fold it into the per-host change log — a host admin must not
see platform-owner activity, and the platform owner must not be able to edit their own trail.

### Entitlements

`organisations.modules` is read by `module_on(project_id, key)`:

```sql
create or replace function module_on(p_project uuid, p_key text)
returns boolean language sql stable as $$
  select coalesce((o.modules ->> p_key)::boolean, false)
  from projects p join organisations o on o.id = p.organisation_id
  where p.id = p_project
$$;
```

Core modules are never in this map — they are always on. A route whose module is off returns a
"not switched on" page, not a 404 and not a blank. The per-project override the prototype hints
at (switching a module on for one project only) is `projects.modules_override jsonb`, merged
over the host's map, for phasing a toolkit in one job at a time.

### What a person sees on sign-in

One login; then, if they hold more than one membership, a host switcher listing only their
hosts. Inside a host: their projects (per their memberships' project scoping, or all the host's
projects for `admin` and `internal`), and — once portfolio dashboards exist — the host home.
A consultant with a single membership never sees a switcher and never sees the concept.

---

## 2. Build order for Lovable

Do not ask Lovable to build the whole app in one prompt. It will produce something shallow and the permission model will be wrong. Build in this order, testing each before moving on:

1. Auth, `profiles`, `companies`, `projects`, `project_members`. **Get RLS working and tested here.** This is the single highest-risk step.
2. Directory UI: company list with nesting, company profile, people.
3. Appointment document slots + Supabase Storage bucket.
4. DRM library table, project snapshot, matrix UI, gap view.
5. Comment engine (polymorphic) — build once, reuse everywhere after.
6. Change log triggers.
7. Exports.

Only then move to Phase 3 onward.

---

## 3. Schema

Written as Postgres DDL. Types simplified for clarity; add `created_at timestamptz default now()` to every table.

```sql
-- ---------- identity ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  job_title text,
  company_id uuid references companies(id),
  is_hbc boolean not null default false
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  client_name text,
  address text,
  lat numeric, lng numeric,
  form_of_contract text,
  riba_stage text check (riba_stage in ('0','1','2','3','4','5','6','7')),
  start_on_site date,
  practical_completion date,
  description text,
  drm_library_version text
);

-- ---------- SPINE 1: discipline ----------
create table disciplines (
  code text primary key,        -- 'A', 'S', 'MEP' ...
  name text not null,
  sort_order int not null
);

create table companies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  parent_id uuid references companies(id) on delete set null,  -- sub-consultant nesting
  name text not null,
  originator_code text not null,
  company_type text not null check (company_type in ('consultant','subcontractor','contractor','client')),
  address text,
  notes text,
  unique (project_id, originator_code)   -- drives the BEP naming table
);

create table company_disciplines (
  company_id uuid references companies(id) on delete cascade,
  discipline_code text references disciplines(code),
  primary key (company_id, discipline_code)
);

-- who can see what, per project
create table project_members (
  project_id uuid references projects(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  role text not null check (role in ('admin','internal','consultant','client')),
  company_id uuid references companies(id),   -- null for HBC roles
  primary key (project_id, profile_id)
);

-- ---------- appointment documents ----------
create table appointment_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  slot text not null check (slot in
    ('competency_statement','team_cvs','appointment','scope_of_work','other')),
  storage_path text not null,
  filename text not null,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz default now(),
  approved boolean not null default false,
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  superseded_by uuid references appointment_documents(id),
  unique (company_id, slot)
);

-- ---------- DRM ----------
create table drm_library_items (
  id uuid primary key default gen_random_uuid(),
  library_version text not null,
  ref text not null,
  category_code text not null,
  item text not null,
  default_lead_discipline text references disciplines(code),  -- nullable = deliberate decision
  cdp_likely boolean default false,
  guidance_note text,
  uniclass_ref text,                                          -- optional, non-structural
  unique (library_version, ref)
);

create table drm_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  library_item_id uuid references drm_library_items(id),   -- null = bespoke project item
  ref text not null,
  category_code text not null,
  item text not null,
  lead_discipline text references disciplines(code),       -- NULL = gap
  transfers_at_stage text,
  cdp_package text,
  level_of_information text,
  applicable boolean not null default true,
  notes text,
  unique (project_id, ref)
);

create table drm_roles (
  drm_item_id uuid references drm_items(id) on delete cascade,
  discipline_code text references disciplines(code),
  role_code text not null check (role_code in ('S','R','C','A','I')),
  primary key (drm_item_id, discipline_code)
);

-- ---------- generic engines ----------
create table comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  entity_type text not null,     -- 'company' | 'drm_item' | 'task' | ...
  entity_id uuid not null,
  author_id uuid not null references profiles(id),
  body text not null,
  parent_id uuid references comments(id),
  created_at timestamptz default now()
);
create index on comments (entity_type, entity_id);

create table change_log (
  id bigserial primary key,
  project_id uuid not null references projects(id) on delete cascade,
  actor_id uuid references profiles(id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  value_from text,
  value_to text,
  created_at timestamptz default now()
);
create index on change_log (project_id, created_at desc);
```

### Derived views, not stored columns

```sql
-- Which disciplines are actually held on a project
create view v_held_disciplines as
select c.project_id, cd.discipline_code
from companies c join company_disciplines cd on cd.company_id = c.id
group by 1,2;

-- The gap report. This is the app's reason to exist.
create view v_drm_gaps as
select d.*,
  case
    when d.lead_discipline is null then 'No lead discipline assigned'
    else 'Discipline ' || d.lead_discipline || ' is not held by any appointed company'
  end as gap_reason
from drm_items d
where d.applicable
  and (d.lead_discipline is null
       or not exists (select 1 from v_held_disciplines h
                      where h.project_id = d.project_id
                        and h.discipline_code = d.lead_discipline));

-- Appointment completeness
create view v_appointment_status as
select c.id as company_id, c.project_id,
  count(*) filter (where ad.approved) as approved_count,
  case
    when c.company_type = 'client' then 'Not required'
    when count(*) filter (where ad.approved
      and ad.slot in ('competency_statement','team_cvs','appointment','scope_of_work')) = 4
      then 'Complete'
    when count(ad.id) = 0 then 'Not started'
    else 'Partial'
  end as status
from companies c
left join appointment_documents ad on ad.company_id = c.id
group by c.id, c.project_id, c.company_type;
```

### Phase 3 additions — programme

```sql
create table programme_imports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  label text not null,
  imported_by uuid references profiles(id),
  imported_at timestamptz default now(),
  row_count int
);

create table programme_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  task_uid text not null,                 -- the planner's ID, stable across revisions
  description text not null,
  start_date date not null,
  finish_date date not null,
  percent_complete int not null default 0 check (percent_complete between 0 and 100),
  level int not null check (level between 1 and 9),
  parent_uid text,
  task_type text not null check (task_type in ('Task','Summary','Milestone')),
  last_import_id uuid references programme_imports(id),
  removed boolean not null default false,  -- absent from the latest revision
  unique (project_id, task_uid)
);
create index on programme_tasks (project_id, parent_uid);

create table programme_watch (
  project_id uuid not null references projects(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  task_uid text not null,
  primary key (project_id, profile_id, task_uid)
);
```

**Never store roll-ups.** Compute summary dates from leaf descendants on read:

```sql
create or replace view v_programme_rollup as
with recursive leaves as (
  select t.id as root_id, t.task_uid as root_uid, t.project_id, c.*
  from programme_tasks t
  join programme_tasks c on c.parent_uid = t.task_uid and c.project_id = t.project_id
  union all
  select l.root_id, l.root_uid, l.project_id, c.*
  from leaves l
  join programme_tasks c on c.parent_uid = l.task_uid and c.project_id = l.project_id
)
select root_id, root_uid, project_id,
  min(start_date) as rolled_start,
  max(finish_date) as rolled_finish,
  round(sum((finish_date - start_date + 1) * percent_complete)::numeric
      / nullif(sum(finish_date - start_date + 1),0)) as rolled_percent
from leaves
where not exists (select 1 from programme_tasks k
                  where k.parent_uid = leaves.task_uid and k.project_id = leaves.project_id)
group by 1,2,3;
```

Every dated entity in later phases uses the same three columns, never a literal date:

```sql
-- pattern to repeat on midp_items, tasks, planning_conditions, bc_items, breeam_credits
  programme_task_uid text,
  offset_days int default 0,
  anchor text default 'finish' check (anchor in ('start','finish')),
  due_date_override date  -- escape hatch; if set, wins and is flagged in the UI
```

with `due_date` as a view column: `(select case when anchor='start' then start_date else finish_date end from programme_tasks ...) + offset_days`.

**RLS for documents.** All project members read the register — a consultant who cannot see what
has been issued cannot coordinate. Only `admin` and `internal` import or reconcile.

**RLS for BEP.** All project members read; `admin` and `internal` write. Consultants need read access — they cannot name files correctly if they cannot see the convention.

**RLS for programme.** All project members read; only `admin` and `internal` write. `programme_watch` is per-user: `using (profile_id = auth.uid())` for both select and write, so nobody can see or edit another person's watchlist.

**Import must be transactional.** Validate the whole file, build the diff, then write in a single transaction. A partially applied programme revision is worse than a rejected one. Do the validation server-side in an Edge Function, not in the browser, or a determined user will post a malformed payload straight to the table.

### Phase 4 additions — BEP

```sql
create table bep (
  project_id uuid primary key references projects(id) on delete cascade,
  delimiter text not null default '-'
);

create table bep_fields (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references bep(project_id) on delete cascade,
  position int not null,
  name text not null,
  min_len int not null,
  max_len int not null,
  required boolean not null default true,
  source text not null check (source in ('project','directory','standard','free')),
  unique (project_id, position)
);

create table bep_field_values (
  field_id uuid references bep_fields(id) on delete cascade,
  code text not null,
  description text,
  primary key (field_id, code)
);

create table bep_revision_rules (
  project_id uuid references bep(project_id) on delete cascade,
  prefix text not null,
  construction_status text not null,
  primary key (project_id, prefix)
);

create table bep_suitability_codes (
  project_id uuid references bep(project_id) on delete cascade,
  code text not null,
  description text,
  in_use boolean not null default true,
  primary key (project_id, code)
);

create table bep_agreements (
  project_id uuid references bep(project_id) on delete cascade,
  topic_key text not null,
  position text,
  agreed_by uuid references profiles(id),
  agreed_on date,
  status text not null default 'Not started' check (status in ('Not started','Draft','Agreed')),
  primary key (project_id, topic_key)
);
```

**The Originator field has no stored values.** `source = 'directory'` means the permitted codes are a join to `companies.originator_code` for that project, resolved at read time. Do not let Lovable generate an editor for it — two lists of the same thing will diverge, and the BEP is then unenforceable.

```sql
create or replace function bep_field_codes(p_field uuid)
returns table(code text, description text) language sql stable as $$
  select case f.source
    when 'directory' then c.originator_code
    else v.code end,
  case f.source when 'directory' then c.name else v.description end
  from bep_fields f
  left join bep_field_values v on v.field_id = f.id and f.source <> 'directory'
  left join companies c on c.project_id = f.project_id and f.source = 'directory'
  where f.id = p_field
$$;
```

**Revision prefix matching must be longest-first.** `order by length(prefix) desc limit 1`, never a plain `like`. If C is tested before CR, every construction record is silently recorded as a contract issue — the kind of defect that is invisible until handover.

```sql
create or replace function construction_status(p_project uuid, p_rev text)
returns text language sql stable as $$
  select construction_status from bep_revision_rules
  where project_id = p_project and upper(p_rev) like prefix || '%'
  order by length(prefix) desc limit 1
$$;
```

**Write the filename validator once.** It must return a per-field verdict, not a boolean, because Phase 5's register audit needs to report which field failed. Build it as a shared function the moment you build the BEP, not again in Phase 5.

### Review corrections — master catalogue

Companies and individuals are global; projects link to them. This replaces the earlier
project-scoped `companies` table.

```sql
create table organisations (            -- master company catalogue
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  constraint org_name_unique unique (lower(name))
);

create table contacts (                 -- master individual catalogue
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  name text not null,
  job_role text,
  email text,
  phone text,
  constraint contact_unique unique (organisation_id, lower(name))
);

create table companies (                -- the PROJECT LINK
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  organisation_id uuid not null references organisations(id),
  parent_id uuid references companies(id) on delete set null,
  originator_code text not null,
  company_type text not null,
  unique (project_id, organisation_id),
  unique (project_id, originator_code)
);

create table project_people (           -- the PROJECT LINK for individuals
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  contact_id uuid not null references contacts(id),
  is_primary boolean not null default false,
  unique (project_id, contact_id)
);
create unique index one_primary_per_company on project_people (company_id)
  where is_primary;
```

**Correction after review: the project link is a SNAPSHOT, not a join.** Name, address, role,
email and phone are copied onto `companies` and `project_people` at the moment of selection and
are never re-read from the catalogue. A project record is the historic account of how someone
was appointed, and a catalogue tidy-up two years later must not rewrite it.

```sql
alter table companies
  add column name text not null,
  add column address text;
alter table project_people
  add column name text not null,
  add column job_role text,
  add column email text,
  add column phone text;
```

`organisation_id` and `contact_id` remain, for provenance only. Surface divergence in the UI —
show both values and offer to pull from the catalogue or push to it — but never resolve it
automatically. Both directions are legitimate, and only a person knows which is meant.

**Removal must be guarded.** Before deleting a `project_people` row, count references (watchlist,
BEP agreements, approvals, and later tasks, conditions, risks and fee approvals). If references
exist, reassign to the company's primary contact inside the same transaction. If the person is
the only individual at that company and holds references, refuse. Deleting a `project_people`
row never touches the `contacts` record.

### Review corrections — disciplines and templates

```sql
create table project_disciplines (      -- per-project overrides
  project_id uuid references projects(id) on delete cascade,
  discipline_code text not null,
  required boolean not null default true,
  primary key (project_id, discipline_code)
);

create table project_custom_disciplines (
  project_id uuid references projects(id) on delete cascade,
  code text not null, name text not null, iso_letter text not null,
  primary key (project_id, code)
);

create table templates (                -- one row, maintained by head of design
  id int primary key default 1 check (id = 1),
  version text not null,
  disciplines jsonb not null,
  appointment_slots jsonb not null,
  revision_rules jsonb not null,
  suitability_codes jsonb not null,
  drm_library_version text not null,
  default_contract text
);
```

New projects copy from `templates` at creation. **Never join a live project to the template
row** — an edit made to tidy the standard list would silently rewrite jobs already on site.

`required = false` removes a discipline from the gap report, the coverage list and the
appointment count. Filter on it in `v_drm_gaps`.

### Phase 5 additions — document register

```sql
create table document_imports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  label text not null,
  imported_by uuid references profiles(id),
  imported_at timestamptz default now(),
  row_count int
);

create table document_rows (            -- raw, append-only, never edited
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

create table drawing_register (         -- curated, only changed by reconciliation
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  document_number text not null,
  title text,
  revision text not null,
  workflow_status text,
  cde_url text,                          -- the file itself stays in the CDE
  added_on date default current_date,
  last_synced date default current_date,
  unique (project_id, document_number)
);
```

Everything else is derived and must not be stored: construction status (from the revision
prefix), DWG availability, originating company, naming compliance.

```sql
create or replace view v_drawing_register as
select r.*,
  construction_status(r.project_id, r.revision) as construction_status,
  exists (select 1 from document_rows d
          where d.project_id = r.project_id
            and d.document_number = r.document_number
            and lower(d.file_format) <> 'pdf'
            and d.import_id = (select id from document_imports
                               where project_id = r.project_id
                               order by imported_at desc limit 1)) as has_dwg,
  (select c.id from companies c
   where c.project_id = r.project_id
     and c.originator_code = split_part(r.document_number, '-', 2)) as company_id
from drawing_register r;
```

**Register presentation.** Construction status, plain-English workflow status, grouping and
conditional formatting are all view concerns — do not store them. Group by originator code,
then sort on the number field (`split_part(document_number, '-', 7)`) rather than the whole
string, because consultants block-allocate number ranges. Drawing comments reuse the
polymorphic `comments` table with `entity_type = 'drawing'`.

**Two rules to hold to.**

Import and reconcile are separate transactions. Importing writes `document_rows` only. The
register changes only when a user accepts a row. Do not let Lovable "helpfully" auto-apply the
diff — a register nobody accepted is a register nobody trusts.

Only PDFs reach the register. DWGs of the same document number set the `has_dwg` flag. This is
the one place where two rows in the source collapse to one row in the output, and it is easy to
get wrong on the first pass.

### Phase 6 additions — actions and transmittals

Actions are a **nullable extension of `comments`**, not a separate table. This is deliberate: a
task detached from the discussion that produced it loses the reasoning, and people stop trusting
either one.

```sql
alter table comments
  add column action_assigned_to uuid references profiles(id),
  add column action_title text,
  add column action_status text check (action_status in ('open','done')),
  add column action_due date,                 -- fixed date
  add column action_task_uid text,            -- or programme-anchored
  add column action_offset_days int default 0,
  add column action_anchor text default 'finish',
  add column action_closed_by uuid references profiles(id),
  add column action_closed_at timestamptz,
  constraint action_needs_owner check (
    action_status is null or action_assigned_to is not null);
```

Resolve the due date in a view, never store it — a programme-anchored action must move when the
programme moves:

```sql
create or replace view v_actions as
select c.*,
  coalesce(
    (select case when c.action_anchor = 'start' then t.start_date else t.finish_date end
       + c.action_offset_days
     from programme_tasks t
     where t.project_id = c.project_id and t.task_uid = c.action_task_uid),
    c.action_due) as resolved_due
from comments c
where c.action_status is not null;
```

**Phase 8 correction: the issue is its own row, and the comment points at it.** The earlier draft
put action columns on `comments`. That worked while an action could only come from a comment. It
does not survive the IRS, where most issues are typed directly. Build it the other way round:

```sql
create table issues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,
  title text not null,
  description text,
  category text,
  company_id uuid references companies(id),
  person_id uuid references project_people(id),
  programme_task_uid text,
  offset_days int default 0,
  anchor text default 'finish' check (anchor in ('start','finish')),
  due_override date,
  priority int not null default 50 check (priority between 0 and 100),
  status text not null default 'Open',
  source text not null default 'irs' check (source in ('irs','comment')),
  origin_entity text, origin_id uuid, origin_comment_id uuid references comments(id),
  raised_by uuid references profiles(id),
  raised_at timestamptz default now(),
  closed_at timestamptz, closed_by uuid references profiles(id),
  unique (project_id, reference)
);
```

Drop the `action_*` columns from `comments` entirely. A comment-raised issue is an `issues` row
with `source = 'comment'` and the three `origin_*` columns populated.

Urgency is computed, never stored:

```sql
create or replace view v_issues as
select i.*,
  coalesce(i.due_override,
    (select case when i.anchor='start' then t.start_date else t.finish_date end + i.offset_days
       from programme_tasks t
       where t.project_id = i.project_id and t.task_uid = i.programme_task_uid)) as due_date,
  case when i.status = 'Closed' then 0 else least(100, i.priority +
    case
      when coalesce(i.due_override, (select case when i.anchor='start' then t.start_date
             else t.finish_date end + i.offset_days from programme_tasks t
             where t.project_id = i.project_id and t.task_uid = i.programme_task_uid))
           is null then 0
      when ... < current_date then 30
      when ... < current_date + 7 then 15
      when ... < current_date + 21 then 7
      else 0 end) end as urgency
from issues i;
```

(Written out longhand for clarity; in practice compute `due_date` in a CTE and reference it once.)

**Show the formula in the UI.** A ranked list people cannot audit is one they will not trust the
first time they disagree with the order.

### Phase 8b/8c — tabs, RFIs, distribution and meetings

```sql
alter table issues
  add column source_kind text default 'irs'
    check (source_kind in ('irs','comment','rfi','meeting')),
  add column rfi_question text,
  add column rfi_response text,
  add column rfi_status text check (rfi_status in ('Open','Answered','Closed')),
  add column rfi_responded_by uuid references profiles(id),
  add column rfi_responded_at timestamptz,
  add column raised_meeting_id uuid references meetings(id),
  add column raised_agenda_item_id uuid references meeting_agenda_items(id);

create table issue_distribution (        -- empty set = visible to the whole project
  issue_id uuid references issues(id) on delete cascade,
  person_id uuid references project_people(id) on delete cascade,
  primary key (issue_id, person_id)
);

create table comment_attachments (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references comments(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz default now()
);

create table meetings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,
  title text not null,
  meeting_type text not null,
  meeting_date date not null,
  meeting_time time,
  location text,
  call_link text,
  chair_id uuid references project_people(id),
  status text default 'Draft',
  notes text,
  unique (project_id, reference)
);

create table meeting_agenda_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  position int not null,
  heading text not null,
  notes text
);

create table meeting_people (
  meeting_id uuid references meetings(id) on delete cascade,
  person_id uuid references project_people(id) on delete cascade,
  role text not null check (role in ('attendee','apology','distribution')),
  primary key (meeting_id, person_id)
);

-- an item is RAISED once but may APPEAR on many agendas
create table issue_agenda_refs (
  issue_id uuid references issues(id) on delete cascade,
  meeting_id uuid references meetings(id) on delete cascade,
  agenda_item_id uuid references meeting_agenda_items(id) on delete cascade,
  primary key (issue_id, meeting_id)
);
```

**The distinction between `raised_meeting_id` and `issue_agenda_refs` is the important one.**
An early version moved items to the new meeting on duplication, which left the previous minutes
empty. Minutes must be a record of what was discussed on the day. Duplication therefore INSERTS
a row into `issue_agenda_refs`; it never updates `raised_meeting_id` and never deletes the old
reference.

**Visibility.** An empty `issue_distribution` set means the whole project sees it. A populated
one means those people, plus `admin`/`internal`, plus `raised_by` and `person_id` — never let a
distribution list lock the owner out of their own item. Meetings are visible only to rows in
`meeting_people`. Both need RLS policies, and **both need the exports to honour them** — an
unfiltered CSV is the easiest way to leak a restricted RFI.

### Phase 11 — fees and cashflow

```sql
create table fees (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  company_id uuid not null references companies(id),
  reference text not null,
  kind text not null check (kind in ('fee','variation')),
  description text,
  value numeric(12,2) not null,          -- EXCLUDING VAT, GBP
  date_submitted date, date_approved date,
  status text not null default 'Proposed' check (status in ('Proposed','Approved','Rejected'))
);

create table payment_schedule (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  company_id uuid not null references companies(id),
  reference text not null,
  description text,
  value numeric(12,2) not null,
  programme_task_uid text, offset_days int default 0,
  anchor text default 'finish', due_override date
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  company_id uuid not null references companies(id),
  schedule_id uuid references payment_schedule(id),
  reference text not null,
  value numeric(12,2) not null,
  date_submitted date not null, date_paid date,
  status text not null default 'Submitted'
    check (status in ('Submitted','Certified','Paid','Disputed'))
);
```

**Never total proposed and approved together.** Every summary must carry them as separate
figures. A fee report that mixes them looks overspent and stops being believed.

**The scheduled cashflow is derived from the programme**, like every other date. Do not store
instalment dates — a consultant's cashflow that does not move when the job moves is worse than
no cashflow at all.

Two checks worth building as views, because both are silent otherwise:
- an instalment whose due date has passed with no invoice mapped to it;
- a payment schedule total that differs from the approved fee (almost always an approved
  variation nobody added to the schedule).

**RLS is the sharpest here.** Fees, payment schedules and invoices are the most commercially
sensitive tables in the system (with `precon_budget` and `risks`, both of which are tighter
still — see the sections that follow). `admin`, `internal` and `client` see everything; a consultant
sees rows where `company_id` is in their own company tree and nothing else. **Exports must run
through the same policy** — a CSV endpoint that bypasses RLS is how a consultant learns what a
competitor is charging.

### Phase 10 — scope of service

```sql
create table scope_template_items (     -- HBC's own words. Ships with the app.
  ref text primary key,
  discipline text default 'All',
  heading text not null,
  description text not null,
  riba_stage text
);

create table scope_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  standard text not null,               -- 'HBC', 'BG6', 'CIC', …
  ref text not null,
  discipline text,
  heading text not null,
  description text,                     -- NULL for licensed schedules
  riba_stage text,
  status text not null default 'Not started',
  proposed_date date,                   -- what the consultant offered
  programme_task_uid text,              -- when it is actually needed
  offset_days int default 0,
  anchor text default 'finish',
  source text default 'manual' check (source in ('template','import','manual')),
  unique (project_id, company_id, ref)
);
```

**Licensing is a build constraint, not a disclaimer.** Ship `scope_template_items` populated with
HBC's own items only. Never seed BG6, CIC or any other publisher's content into the product.

The import must:
- require an explicit licence confirmation before the file input is enabled;
- default to discarding the `Description` column, storing reference and heading only;
- record the confirmation in `change_log` with the user and timestamp.

A disclaimer does not make reproduction lawful. What keeps the position clean is that the
publisher's text never enters the product — it stays in the licensed workbook held as the
scope-of-work appointment document.

**Compute both dates, store one.** `proposed_date` is a fact the consultant gave you and is
stored. The required date is derived from the programme like every other date in the system:

```sql
create or replace view v_scope as
select s.*,
  (select case when s.anchor='start' then t.start_date else t.finish_date end + s.offset_days
     from programme_tasks t
     where t.project_id = s.project_id and t.task_uid = s.programme_task_uid) as required_date
from scope_items s;
```

The difference between the two is the most valuable column in the module — a service offered
later than the programme needs it is a problem that exists at appointment and normally surfaces
as a late deliverable months afterwards.

**RLS.** All project members read. `admin` and `internal` write anything; a consultant may update
`status` and `proposed_date` on their own company's rows only.

### Phase 9 — compliance trackers

```sql
create table planning_conditions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,
  condition_number text not null,
  phase text not null check (phase in
    ('pre-commencement','pre-super','pre-cladding','pre-occupation','compliance','informative')),
  title text not null,
  condition_text text,
  decision_reference text,
  discharge_reference text,
  company_id uuid references companies(id),
  person_id uuid references project_people(id),
  programme_task_uid text, offset_days int default 0,
  anchor text default 'finish', due_override date,
  status text not null default 'Not started'
);

create table bc_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  part text not null,                    -- 'A','B1'…'S','REG7','REG38','MISC'
  title text not null,
  summary text,
  is_misc boolean not null default false,
  company_id uuid references companies(id),
  person_id uuid references project_people(id),
  programme_task_uid text, offset_days int default 0,
  anchor text default 'finish', due_override date,
  status text not null default 'Not started'
);

create table compliance_evidence (      -- files OR a link to a register drawing
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('planning','bc')),
  entity_id uuid not null,
  filename text, storage_path text,
  drawing_id uuid references drawing_register(id),
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz default now(),
  check (storage_path is not null or drawing_id is not null)
);

create table compliance_agenda_refs (
  entity_type text not null check (entity_type in ('planning','bc')),
  entity_id uuid not null,
  meeting_id uuid references meetings(id) on delete cascade,
  agenda_item_id uuid references meeting_agenda_items(id) on delete cascade,
  primary key (entity_type, entity_id, meeting_id)
);
```

**Seed `bc_items` from a template on project creation**, the same way the DRM library is loaded —
all 23 Approved Document rows with their summaries. A project switches rows off rather than
typing rows in. Store the AD list in the `templates` row so the head of design maintains it as
the regulations change.

**`status = 'Not required'` must be excluded from every denominator.** The dashboard reports
"13 of 26", not "13 of 28". Getting this wrong makes the progress bar permanently unreachable
and people stop looking at it.

**Assigning a company defaults `person_id` to that company's primary contact.** This is the
payoff for the one-primary-per-company constraint added earlier.

**These are not issues.** Do not model them in the `issues` table. A condition is a standing
obligation with a defined discharge, not a task to close. But provide "raise a task about this",
which inserts an `issues` row pre-filled from the condition — the obligation and the action stay
separate records, because a discharged condition and a closed task mean different things.

**Do not create issues for late drawings.** They are register rows whose `due_date` has passed.
Surface them with a link from the issue list; never duplicate them into it.

```sql
create table transmittals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,
  issue_date date not null,
  method text not null,
  reason text,
  to_company_id uuid references companies(id),
  to_person_id uuid references project_people(id),
  issued_by uuid references profiles(id),
  notes text,
  created_at timestamptz default now(),
  unique (project_id, reference)
);

create table transmittal_items (
  transmittal_id uuid references transmittals(id) on delete cascade,
  drawing_id uuid references drawing_register(id),
  revision_at_issue text not null,     -- FROZEN. never recalculated.
  primary key (transmittal_id, drawing_id)
);
```

**Three rules.**

`revision_at_issue` is written once and never updated. Add a trigger that raises on any attempt
to update it. If it follows the register, the transmittal stops being evidence of anything.

Transmittals are append-only. No update, no delete. Corrections are a new transmittal. Enforce
it in RLS: grant `select` and `insert` only.

Generate the reference server-side from a per-project sequence. Typed references produce
duplicates and gaps within a month.

**Recipients are a separate table**, not columns on the transmittal:

```sql
create table transmittal_recipients (
  transmittal_id uuid references transmittals(id) on delete cascade,
  company_id uuid not null references companies(id),
  person_id uuid references project_people(id),
  distribution text not null default 'information'
    check (distribution in ('action','information')),
  primary key (transmittal_id, company_id, person_id)
);
```

Drop `to_company_id` and `to_person_id` from `transmittals`. The action/information split is not
decoration — it is what tells a recipient whether they owe a response, and every downstream view
("what has this company been asked to do") depends on it.

### Phase 7 revised — the MIDP IS the register

**Do not build a `midp_items` table.** An earlier draft of these notes specified one. It was
wrong: two tables holding the same drawings, joined on a filename string, is the disconnected
-schedule problem this application exists to remove.

Extend `drawing_register` instead:

```sql
alter table drawing_register
  alter column revision drop not null,          -- null = planned, not yet uploaded
  add column company_id uuid references companies(id),
  add column deliverable_type text default 'Drawing',
  add column programme_task_uid text,
  add column offset_days int default 0,
  add column anchor text default 'finish' check (anchor in ('start','finish')),
  add column planned_status text default 'Not started',
  add column source text default 'cde' check (source in ('planned','import','cde'));

create table drawing_drm_items (        -- many-to-many, and it must be many-to-many
  drawing_id uuid references drawing_register(id) on delete cascade,
  drm_item_id uuid references drm_items(id) on delete cascade,
  primary key (drawing_id, drm_item_id)
);
```

`revision is null` is the whole lifecycle. A planned drawing is a register row with no revision;
it becomes delivered when a CDE export supplies one.

```sql
create or replace view v_drawing_register as
select r.*,
  (r.revision is not null) as delivered,
  (select case when r.anchor='start' then t.start_date else t.finish_date end + r.offset_days
     from programme_tasks t
     where t.project_id = r.project_id and t.task_uid = r.programme_task_uid) as due_date,
  construction_status(r.project_id, r.revision) as construction_status
from drawing_register r;
```

**The DRM link is many-to-many and optional.** One detail sheet covers several matrix items;
some matrix items produce a report or nothing at all. Never generate one drawing per matrix item
— it assumes consultants bracket drawings the way the matrix brackets responsibility, and they
do not. Offer an uncovered-items report as a prompt, never as a validation rule.

**Audit states.** Reconciliation now has six outcomes. Two are new and both matter:
`first upload` (a file arrived against a planned number — accepting it sets the revision and
*keeps* the due date, owner and matrix links) and `awaiting upload` (planned, not in the export,
correctly so). Do not let a planned drawing fall into "missing from export" — it is alarming and
wrong.

**RLS.** All project members read the register. Writing splits three ways: anyone on the project
may insert a planned row for their **own** company and update its planning columns; only `admin`
and `internal` may touch another company's rows; and **nobody** may write `revision` or
`workflow_status` directly — those come only from an accepted reconciliation. Enforce the last
one with a trigger, since RLS cannot restrict individual columns.

**RLS.** All project members read transmittals — knowing what has been issued is coordination
information, not commercial. Only `admin` and `internal` insert.

---

### Amendments — evidence, attachments and cross-references

Three small tables changed shape, and one behaviour was a bug worth recording so it is not
rebuilt.

**Evidence is now generic.** The `{reviewer, reviewed_at, revision_at_review}` record built for
the compliance trackers turned out to fit fees, invoices, payment instalments, risks and
pre-construction quotes without alteration. Rather than five near-identical columns, hold one
table:

```sql
create table evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  entity_type text not null,             -- planning | bc | fee | invoice | sched | risk | quote | budget
  entity_id uuid not null,
  name text,                             -- for a named file with no register row
  drawing_id uuid references drawing_register(id),
  storage_path text,
  revision_at_add text,
  added_by uuid references profiles(id), added_at timestamptz default now(),
  reviewed_by uuid references profiles(id), reviewed_at timestamptz,
  revision_at_review text
);
create index on evidence (entity_type, entity_id);
```

The derived state is unchanged and stays a view: never reviewed → *Awaiting review*; reviewed
and the register revision has not moved → *Reviewed*; reviewed and it has → *Revised since
review*. Nothing about review state is stored.

**Comment attachments take the same shape.** `comment_attachments (comment_id, name,
drawing_id, storage_path)` rather than a text array, so a drawing referenced in a discussion is
a live link showing its current revision instead of a filename somebody typed six months ago.
Legacy string arrays normalise on read.

**A bug worth not repeating.** The evidence drawing picker posted the drawing's *name* into a
lookup keyed on *id*, so the link silently never resolved and the handler threw. Wherever a
select feeds a foreign key, the option value must be the key. Worth a lint rule.

**Every cross-reference is a link.** One resolver, `entityLink(type, id)`, and one navigation
handler covering all sixteen entity types. Printing an entity's title as text is how three
different "open the original" buttons ended up doing nothing.

**Names are links to people.** Anywhere a person appears in a list — distribution, attendees,
apologies, RFI recipients, risk owner — the name opens their card with company, role, email,
telephone and what they are carrying. `profiles` already holds it; it just was not reachable.

---

### Drawing packs

A pack is a named, reusable group of drawings. It exists because the same grouping is issued
more than once, and rebuilding a forty-drawing selection by hand each time is how one gets
left out.

```sql
create table drawing_packs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,               -- PK-01
  name text not null,
  purpose text,
  owner_id uuid references profiles(id),
  created_at timestamptz default now(),
  unique (project_id, reference)
);

create table drawing_pack_items (
  pack_id uuid not null references drawing_packs(id) on delete cascade,
  drawing_id uuid not null references drawing_register(id) on delete cascade,
  primary key (pack_id, drawing_id)
);

create table drawing_pack_programme (
  pack_id uuid not null references drawing_packs(id) on delete cascade,
  programme_task_uid text not null,
  primary key (pack_id, programme_task_uid)
);
```

**The pack holds references, not copies.** Change a drawing and every pack containing it
changes. This is the whole point and must survive the rebuild — a pack that snapshots
revisions is a stale document pretending to be a live one.

**`drawing_pack_programme` must never influence a date.** A drawing's due date comes from its
own `programme_task_uid` + offset on the register row, and from nowhere else. A pack is linked
to a programme line purely as a resource, so whoever is doing that piece of work can see the
drawings relevant to it. Enforce this in review: if a query joins `drawing_pack_programme`
while computing a date, it is wrong. The original design put a `pack_uids` array on each
drawing, which made a second relationship between the same two records mean something
different from the first — exactly the ambiguity that ends in two disagreeing dates.

**Issuing a pack.** The transmittal builder takes a pack and expands it into individual
`transmittal_items`, each recording the revision issued at that moment. The transmittal stores
drawings, never a pack reference — the pack changes, the historic issue must not. "Which
transmittals carried this pack" is then a derived question, and so is "how many drawings have
been revised since the pack was last issued as a whole set".

---

### Phase 12 — risk and opportunity register

```sql
create table risks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,               -- RSK-01 / OPP-01
  kind text not null check (kind in ('risk','opportunity')),
  title text not null,
  description text,
  mitigation text,
  category text,
  person_id uuid references profiles(id),        -- OWNER IS A PERSON, NOT A DISCIPLINE
  likelihood int not null check (likelihood between 1 and 5),
  impact_cost numeric(12,2) not null default 0,  -- EXCLUDING VAT, GBP
  impact_weeks int default 0,
  status text not null,
  programme_task_uid text, offset_days int default 0,
  anchor text default 'finish', due_override date,
  issue_id uuid references issues(id),           -- set when a risk is realised
  raised_by uuid not null references profiles(id),
  raised_at timestamptz default now(),
  closed_at date,
  unique (project_id, reference)
);

create table risk_distribution (
  risk_id uuid not null references risks(id) on delete cascade,
  profile_id uuid not null references profiles(id),
  primary key (risk_id, profile_id)
);
```

**Ownership is a person, deliberately breaking the discipline rule.** Everywhere else the app
assigns to a discipline, because responsibility for producing information is a matter of
appointment. A live risk is not — it is somebody personally chasing something down, and a risk
owned by "structures" is a risk nobody is holding. Do not "fix" this for consistency.

**Visibility is closed by default and it is the inverse of the task list.** On a task, an empty
distribution means the whole project. On a risk, an empty distribution means *nobody but the
raiser and the owner* — plus the admin override below. A costed risk is a commercial position
long before it is a shared one.

```sql
create policy risk_read on risks for select using (
  is_admin(project_id)                            -- overrides everything, see §4
  or raised_by = auth.uid()
  or person_id = auth.uid()
  or exists (select 1 from risk_distribution d
             where d.risk_id = risks.id and d.profile_id = auth.uid())
);
```

Note the clause names `admin` only, not `internal`. `internal` gets no risk override and sees
only what it has been named on.

**Nothing about exposure is stored.** Likelihood bands map to fixed percentages (rare 10,
unlikely 25, possible 50, likely 75, almost certain 90). The impact band is derived from the
cost, not chosen: under £10k minor, £10k–50k moderate, £50k–150k significant, £150k–500k major,
above that severe. Expected value is cost × likelihood; score is likelihood × band. All views.

Deriving the band rather than asking for it removes the commonest argument in a risk workshop,
where two people score the same £80k item differently and the register loses its ordering.

**Never total raw impacts and call it exposure.** Every summary shows expected value. Adding up
what everything would cost if it all happened is how a risk report stops being believed.

**A realised risk becomes a task, not a second thing to chase.** Setting a risk to *Realised*
inserts one row into `issues` with `source = 'task'`, `origin = {entity:'risk', id}`, the risk's
distribution copied across, and a priority derived from the score. The risk keeps its record and
points at the issue. It does not get its own action list — that is the parallel-table problem
the app exists to remove.

Opportunities use the same table with `kind = 'opportunity'` and their own status list
(Identified / Under review / Accepted / Implemented / Rejected). `impact_cost` is a saving. This
is where value engineering is recorded, so a VE idea has an owner, a value, a likelihood and a
review date like anything else, rather than living in a spreadsheet until somebody remembers it.

---

### Pre-construction fee budget

Held apart from the appointed-fee tables on purpose. During pre-construction nothing is
appointed, so there is no company to hang a fee on and no programme to date it from — the two
spines the rest of the app runs on do not exist yet. Forcing it into `fees` would mean inventing
company records for consultants who may never be appointed.

```sql
create table precon_budget (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,               -- PB-001
  category text not null check (category in ('consultant','survey','statutory')),
  discipline text,                       -- nullable; surveys map to no discipline
  title text not null,
  required boolean not null default true,-- struck out, never deleted
  budget numeric(12,2) default 0,
  notes text,
  preferred_quote_id uuid,               -- FK added after quotes, circular
  unique (project_id, reference)
);

create table precon_quotes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  budget_line_id uuid not null references precon_budget(id) on delete cascade,
  company_id uuid references companies(id),   -- when they are in the directory
  supplier text,                              -- when they are not
  reference text,
  date_received date,
  base_value numeric(12,2) not null default 0,
  status text not null default 'Received'
    check (status in ('Received','Shortlisted','Rejected','Withdrawn')),
  notes text
);

create table precon_quote_adjustments (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references precon_quotes(id) on delete cascade,
  label text not null,                   -- what is being levelled
  value numeric(12,2) not null           -- signed; negative deducts
);

-- the one link outwards
alter table fees add column budget_line_ids uuid[] default '{}';
```

**Adjustments are the point of the module.** Submissions are never like for like — one ground
investigation quote prices twelve boreholes against fourteen and excludes the interpretative
report. The adjustment records what is being levelled *and why*, in words, so the comparison can
be defended six months later. The submitted figure is kept alongside, because "what did they
actually quote" is a different question from "what is comparable". Require a label: a plugged
number with no explanation is worse than no adjustment.

**Struck out, not deleted.** `required = false` renders the line greyed and struck through and
drops it from every total. Deleting it loses the decision that it was not needed, which is
precisely the thing somebody asks about at the cost report.

**One thread outwards, and only one.** `fees.budget_line_ids` names which budget line or lines
an appointment came from. That single link answers "is the current fee inside the original
forecast?" and nothing else in the module reaches into the live app. It reads the discipline
list and the directory rather than keeping its own copies — a fully separate store would mean
retyping the consultant list, which is the duplication the app was built to remove.

**Visibility.** HBC only, and that includes the consultant who submitted into it.

```sql
create policy precon_read on precon_budget for select using (
  member_role(project_id) in ('admin','internal')
);
```

Same policy on `precon_quotes` and `precon_quote_adjustments`. The full-project JSON download
omits the section entirely for anybody else rather than returning it emptied — an empty array
tells a consultant there is a budget, which is itself information.

---

### Payment schedules are negotiated, not imported

The original schema treated the schedule as reference data. It is a negotiated document, and
the missing piece was that there was no way to create one at all.

```sql
alter table payment_schedule
  add column status text not null default 'Proposed'
    check (status in ('Proposed','Agreed')),
  add column agreed_by uuid references profiles(id),
  add column agreed_at date;
```

Agreement is a stored fact, not a derived one — it records a decision somebody made, with who
and when, which is exactly the kind of thing that *should* be stored. The distinction that
matters: store decisions, derive consequences. The due date, the invoiced position and the
schedule-versus-fee mismatch stay computed.

Three routes in, and all three are needed: type an instalment, upload the published
`payment-schedule-template.csv`, or agree what the consultant proposed. Proposed instalments
still count in the planned curve, because that is the consultant's expectation and hiding it
makes the curve optimistic — but the header carries the un-agreed count and value.

**Context windows.** Fees, variations, instalments and invoices each carry their own comment
thread and their own evidence rows. A disputed claim is argued in one place with the documents
beside the argument. On invoices this is close to load-bearing: certifying against an
application nobody can produce later is how payment disputes are lost, so an invoice with no
document held is flagged.

---

### Phase 13 — BREEAM

**Ship no BREEAM content.** The technical manual is BRE copyright with controlled access
(assessors and APs via BREEAM Projects; everyone else by request). The tables below start empty
and are populated per project from the licence-holder's own tracker. Do not seed them, do not
scrape them, and do not "helpfully" add a starter set in a later sprint.

```sql
create table breeam_schemes (          -- one row per VERSION of the standard
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  version text not null,               -- 'UKNC 2018', 'Version 7.1'
  name text,
  building_type text,                  -- the active weighting set
  building_types text[] default '{}',
  sections jsonb default '[]',         -- [{code, name, stated}]
  weightings jsonb default '{}',       -- {building_type: {section_code: 0.11}}
  ratings jsonb default '[]'           -- [{name, min}]
);
alter table projects add column breeam_scheme_id uuid references breeam_schemes(id);

create table breeam_issues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  scheme_id uuid not null references breeam_schemes(id) on delete cascade,
  code text not null,                  -- 'Man 01'
  title text,
  section text,                        -- matches a sections[].code
  note text,                           -- the AP's advisory wording
  min_standards jsonb default '{}'     -- {rating: {credits, note}}
);

create table breeam_credits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  issue_id uuid not null references breeam_issues(id) on delete cascade,
  requirement text,
  description text,
  kind text not null default 'credit' check (kind in ('credit','prerequisite')),
  credits_available int default 0,
  targeted int default 0,
  achieved int default 0,
  status text not null default 'Not started',
  company_id uuid references companies(id),
  person_id uuid references profiles(id),
  programme_task_uid text, offset_days int default 0,
  anchor text default 'finish', due_override date
);
```

Evidence and comments attach through the existing polymorphic tables with
`entity_type = 'breeam'`.

**A scheme is a version, and a project holds several.** Switching `projects.breeam_scheme_id`
switches the entire framework. UKNC 2018 remains live for projects registered under the older
building regulations while newer ones sit on later versions, and the sections, weightings and
issue structure differ between them.

**Section credits available must be a view, summed from `breeam_credits`.** Never a column.
`sections[].stated` exists only as a cross-check and is reported when it disagrees with the
rows. This is not theoretical: the source spreadsheet this was modelled from states section
totals on one tab and lists credits on another, and six of ten sections disagree — with the
score computed against the stated figure. One source, derived, and the disagreement becomes
impossible.

**Prerequisites block their issue.** A `kind = 'prerequisite'` row that is not `Verified`
excludes every credit under the same `issue_id` from the achieved total. Build it into the
scoring view so it cannot be bypassed, and surface *which* prerequisite is blocking rather than
silently subtracting.

**Minimum standards are structured, not prose.** `{rating: {credits, note}}` lets the report
state that a rating is capped and by what — *this issue needs four credits and two are
targeted*. A stored pass/fail flag would go stale the moment a credit moves. Report the rating
on score and the rating after minimum standards side by side.

**Imports.** Three templates — sections, credits, minimum standards — with the usual contract:
strict header validation, whole-file rejection on a missing column, a preview before any write,
and rejected rows returned as CSV. One trap found in the prototype and worth avoiding: a
weighting file carries one row per section *per building type*, so the same section repeats. A
later row that leaves a field blank must not erase a value an earlier row supplied — blank means
"not specified here", not "clear it".

---

### Checklists — one table, five templates

Five checklists were asked for; one module was built. Pre-construction pre-assessment, client
requirements, handover, highways and utilities are the same record with a different template.
Do not split them back out — five near-identical tables is the duplication this system exists to
remove, and it makes the sixth checklist a build instead of a template.

```sql
create table checklist_templates (      -- HBC's own words, central, inherited by new projects
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('precon','client','handover','highways','utilities')),
  reference text not null,
  heading text not null,
  title text not null,
  prompt text,
  discipline text,                      -- pre-assignment hint, not an assignment
  sort_order int,
  unique (type, reference)
);

create table checklists (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  type text not null,
  reference text not null,
  heading text not null,
  title text not null,
  prompt text,
  discipline text,
  required boolean not null default true,   -- struck out, never deleted
  status text not null default 'Not started',
  response text,                            -- the ANSWER, not just a status
  company_id uuid references companies(id),
  person_id uuid references profiles(id),
  programme_task_uid text, offset_days int default 0,
  anchor text default 'finish', due_override date,
  -- utilities only; a sequence rather than a state
  supplier text, quote_reference text, quote_value numeric(12,2),
  date_enquiry date, date_quote date, date_accepted date,
  custom boolean not null default false,    -- added on the project rather than from the template
  unique (project_id, type, reference)
);
```

Evidence and comments attach through the polymorphic tables with `entity_type = 'checklist'`.

**Loading copies, it does not link.** A project takes a snapshot of the template, exactly as the
directory takes a snapshot of the master catalogue. Editing a template must never rewrite a live
project — build a test for this, because it is the kind of thing that gets "improved" into a
live link by someone trying to be helpful.

**Pre-assign only where it is unambiguous.** On load, set `company_id` from the discipline only
when exactly one company on the project holds it. Two holders means leave it null: that is a
decision, and a wrong default is worse than a blank one.

**`required = false` is the strike-out.** It drops the row from every denominator and renders it
struck through, but the row survives. Template rows must not be deletable on a project; rows
with `custom = true` may be.

**`response` matters more than it looks.** The pre-assessment list is 193 questions with an
answer field, and the stated intention is to have a model read the tender pack and populate
them. The schema is already the right shape for that: a model writes `response`, a human accepts,
corrects or raises a task. If that is built, keep the provenance — a machine-suggested answer
must be visibly distinguishable from one a person wrote, or the checklist stops meaning anything.

**The utilities columns are the one asymmetry**, and they earn it. A connection is enquiry →
quotation → acceptance → energisation, and recording the first two dates is what makes a lead
time visible before it becomes a delay. A second table for five columns would drift.

---

### Change requests

A request from one party to another to change scope or specification. Direction is data, not
schema — any company can raise one against any other.

```sql
create table change_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,                -- CHG-001
  title text not null,
  description text, reason text, category text,
  from_company_id uuid references companies(id),
  raised_by uuid not null references profiles(id),
  to_company_id uuid references companies(id),
  to_person_id uuid references profiles(id),
  status text not null default 'Draft'
    check (status in ('Draft','Submitted','Under review','Approved','Rejected',
                      'Withdrawn','Implemented','Closed')),
  origin_entity text, origin_id uuid,     -- what it was raised against
  impact_scope text, impact_weeks int default 0,
  impact_cost text, impact_other text,    -- EXPECTATION only; never a value
  variation_id uuid references fees(id),  -- the money lives there
  decision_task_uid text, decision_offset int default 0,
  decision_anchor text default 'finish', decision_override date,
  effective_task_uid text, effective_offset int default 0,
  effective_anchor text default 'finish', effective_override date,
  decided_by uuid references profiles(id), decided_at timestamptz,
  decision_note text,
  raised_at timestamptz default now(), closed_at date,
  unique (project_id, reference)
);

create table change_request_items (       -- what an approval obliges somebody to amend
  id uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references change_requests(id) on delete cascade,
  entity_type text not null,              -- drawing | drm | scope | checklist | breeam | planning | bc | bep | other
  entity_id uuid,                         -- null when entity_type = 'other'
  note text,
  done boolean not null default false,
  done_by uuid references profiles(id), done_at timestamptz
);

create table change_request_distribution (
  change_request_id uuid not null references change_requests(id) on delete cascade,
  profile_id uuid not null references profiles(id),
  primary key (change_request_id, profile_id)
);
```

**No trigger may act on approval.** Approving a change request must not update a drawing, a
scope row or anything else. The amendments are made by people. Resist the "helpful" automation
here — an automatic edit is a second source of truth arriving with nobody reading it, and it
removes the review step that catches the mistake.

**Approval is not implementation, and the schema must keep them apart.** `status = 'Approved'`
with unfinished `change_request_items` is the state this register exists to make visible. Build
it as a view: outstanding count, and a flag for approved-with-an-empty-item-list, which means
either the list was never filled in or the change alters nothing. Marking implemented must be
refused while any item is outstanding, and un-ticking an item must knock the status back from
`Implemented` to `Approved`.

**No value column, ever.** `impact_cost` is an enumeration of expectation, not an amount.
Anything with a number attaches through `variation_id` to `fees`. A second register holding the
same figure is how the fee report stops being believed.

**Two dates, separately anchored.** The decision date and the effective date are different
questions, and a decision due after the change takes effect is a reportable error rather than a
validation failure — say so, do not block it, because sometimes that is genuinely the situation.

```sql
create policy change_request_read on change_requests for select using (
  is_admin(project_id)
  or raised_by = auth.uid() or to_person_id = auth.uid()
  or from_company_id in (select my_company_tree(project_id))
  or to_company_id in (select my_company_tree(project_id))
  or exists (select 1 from change_request_distribution d
             where d.change_request_id = change_requests.id and d.profile_id = auth.uid())
);
```

**A bug worth recording.** The derived-row helper computed `state` and `stateK` and then failed
to include them in the returned object, so every state pill rendered `undefined` — invisible in
a spot check because the surrounding markup still looked right. Anywhere a function derives
display state, assert on the returned value rather than the calculation.

---

### Higher-risk buildings — the Building Safety Act regime

Switched on per project. Everything below is inert unless `projects.hrb` is true, so an ordinary
scheme never sees any of it.

```sql
alter table projects
  add column hrb boolean not null default false,
  add column hrb_reason text,
  add column g2_reference text, add column g2_approved_date date,
  add column commencement_notified date,
  add column hrb_notify_days int default 14,     -- CONFIGURABLE, not a constant
  add column hrb_major_weeks int default 6;

alter table change_requests
  add column bsa_controlled boolean not null default false,
  add column bsa_class text check (bsa_class in ('Recordable','Notifiable','Major')),
  add column bsa_class_by uuid references profiles(id),
  add column bsa_class_at timestamptz,
  add column bsa_class_note text,
  add column bsa_notified_at date,
  add column bsa_objected boolean default false, add column bsa_objection_note text,
  add column bsa_app_reference text, add column bsa_app_submitted date,
  add column bsa_app_decided date, add column bsa_app_outcome text;

alter table drawing_register
  add column golden_thread boolean not null default false,
  add column g2_revision text;                   -- baselined once, at approval

create table occurrences (                       -- mandatory occurrence reporting
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null, title text not null, description text,
  kind text, status text not null default 'Under assessment',
  assessment text,
  occurred_at date, discovered_at date, reported_at date,
  person_id uuid references profiles(id), company_id uuid references companies(id),
  raised_by uuid references profiles(id), raised_at timestamptz default now(),
  unique (project_id, reference)
);
```

**Classification is restricted to the PDB and admin.** Not by hiding the control — by policy.

```sql
create or replace function can_classify(p_project uuid)
returns boolean language sql stable security definer as $$
  select member_role(p_project) = 'admin'
      or exists (select 1 from company_disciplines cd
                 where cd.company_id in (select my_company_tree(p_project))
                   and cd.discipline = 'PDB')
$$;

create policy change_request_classify on change_requests for update using (
  can_classify(project_id) or /* ...the ordinary edit policy for non-BSA columns... */ false
);
```

Split the update policy so the `bsa_*` columns are governed by `can_classify` and the rest by the
normal rule — a column-level grant, or two policies with a trigger that rejects `bsa_*` changes
from anyone who fails `can_classify`. The prototype enforces this at the handler as well as in
the markup, and the test drives a synthetic event at it to prove hiding the control is not the
control. Do the same here: a hidden field is not a permission.

**HBC internal deliberately cannot classify.** It is a named statutory duty, not a seniority.

**Never suggest a category.** Recordable, notifiable or major is a duty-holder judgement made by
the client, principal designer and principal contractor together. Store the classifier, the
timestamp and the written basis; do not compute, default or recommend the value.

**"May work proceed" is a view, never a column.** Derived from the class plus what has been done:
unclassified → stop; notifiable without a notification → stop; notified and inside the window →
warn; notified and the window closed → proceed; objection → stop; major without approval → stop.
Storing this would let it say yes after somebody edits a date.

**The regulatory state outranks the commercial state** on the register display when
`bsa_controlled` is true. A commercially approved change awaiting a major determination reads as
*work must stop*.

**The periods are columns because the published figures disagree.** The notifiable objection
window is quoted as both ten working days and fourteen days across sources, and a major
determination as four to six weeks, extendable by agreement. Do not hardcode either.

**Golden thread is a designation plus a baseline**, not a document store. `g2_revision` is
stamped once at approval; the two reports that matter are designated rows whose revision has
since moved, and designated rows never issued at all.

**Occurrences are their own table.** Do not merge them into `risks`. A risk is prospective, an
occurrence has happened, and they have different clocks and audiences. An occurrence assessed as
not reportable still stores its reasoning.

**Gateways are a checklist template**, not a module — the payoff of the generic checklist engine.

**A caveat to carry into the build.** The categories, periods and reporting threshold are
regulatory matters that move. Everything above should be reviewed by whoever holds the PDB duty
before it is used on a live scheme, and the periods should stay editable in the interface rather
than becoming constants during a refactor.

---

### Period reports

Three audiences, one engine, no stored document, **three pages**. The first cut stopped at two
and was too thin — state-of-play tiles and a period list, none of the material that makes the
live dashboard worth opening. The middle page fixes that by reusing the dashboard's own
building blocks — decision queue, gone-quiet, consultant health, the programme timeline —
reframed per audience rather than per signed-in user, because a report is read by someone who
may not be who generated it. A report is a query over a date range plus an audience filter,
rendered on request — nothing is drafted, saved, or versioned, so there is never a stale copy to
reconcile.

```sql
-- No new tables. The report reads from what already exists:
-- transmittals, issues (raised_at/closed_at), meetings, change_requests
-- (raised_at/decided_at), the change log (for checklist completions),
-- invoices, payment_schedule, comments.
```

Compute the period server-side the same way as the prototype: a week is a rolling 7-day window
ending today, a month a rolling calendar month. Both ends inclusive.

**The audience decides content in one place, not at render time per field.** Build four
parameterised functions, one per page's content plus the shared timeline: `report_metrics`,
`report_attention`, `report_activity`, and `report_timeline` (shared verbatim with the live
dashboard — there should be exactly one function that draws the programme bar, called from two
places). Do not sprinkle `if audience === 'client'` through a template.

**The attention page reframes "personal" as "audience".** The live dashboard's decision queue
answers "what is waiting on **me**" — `auth.uid()`. The report version of the same idea answers
"what is waiting on **this audience**": every open decision project-wide for internal; only
items where the client's company is the recipient for client; only items where that one
company is the recipient for consultant. Write it as a second function rather than reusing the
personal one with a bypassed `auth.uid()` filter — the two answer different questions and a
report referencing the signed-in user's identity while addressed to someone else is a subtle
form of it leaking whose account generated it.

**Consultant health and gone-quiet are audience-gated independently of everything else.**
Consultant health never appears outside `internal`, matching the live dashboard exactly.
Gone-quiet appears for `internal` (everything) and `consultant` (scoped to that company's own
items only, via `my_company_tree`), and is withheld from `client` entirely — flagging that
something has stalled is a tone judgement for a person to make in conversation, not a fact for
an automated document to assert. "Coming up" — programme lines and milestones due in the
following period — is the one section identical for all three; dates are not commercially
sensitive.

**Every tracked-item type needs its own row, not a merged total.** The first cut folded
planning conditions, building control and all six checklist types into one aggregate tile, and
it was wrong — a merged number cannot answer "which one is behind?", which is the first
question anyone reading a compliance section asks. Build `report_compliance_rows(project,
audience, company_id)` as a table function returning one row per type with its own
done/total/overdue, not a rollup. Client excludes the pre-construction pre-assessment and the
gateway checklist by type key, same reasoning as the change-control exclusion. Consultant scopes
every row by `company_id` and only emits rows where that company actually holds items — an
empty row for a type they have nothing on is noise, not a finding.

The prototype's `REPORT_EXCLUSIONS` map is the
right shape: one string per audience stating plainly what was left out, rendered on the document
itself. Keep that. An omission a reader cannot see stated is indistinguishable from an oversight.

**Access control mirrors role, not a report-specific permission.** `admin` and `internal` may
generate any of the three; `client` role may only ever generate `client`, locked; `consultant`
and `subconsultant` may only ever generate `consultant`, locked to their own company via
`my_company_tree`, never to a company id supplied by the client. Enforce the lock server-side —
the prototype's test drives a tampered `company_id` at the view specifically to prove the UI
restriction is not the only restriction, and the same should be true here: a consultant's own
role should make requesting another company's report a 403, not a UI dead end.

**Client exclusions, explicitly, because this is the one place a wrong default is expensive.**
No fee or cashflow figures — consultant fees are HBC's cost structure, not the client's
business. No risk register. No consultant health or appointment-gap detail naming a company. No
BREEAM change-control classification detail. No occurrence report content. These aren't a
permissions question the way most of this app's visibility is — they're a commercial and
liability judgement, made once, here, and worth a review by whoever owns that decision before a
report actually goes out the door. Revisit this list with them before go-live; do not let it
drift by feature addition without the same review.

**Consultant reports never reveal another company's figures.** Every derived figure filters by
`company_id` through `my_company_tree`, matching the pattern already used for the consultant
home page.

**PDF.** No server-side rendering — `window.print()` against a print stylesheet with
`@page { size: A4 }` and `page-break-before: always` between the two report sheets is
sufficient and is what the prototype does. If a downloadable PDF without a print dialog is
wanted later, render the same HTML through a headless-Chrome print-to-PDF step server-side
rather than building a second templating path.

---

### Warranties — ownership is a query, never a foreign key to a company

The one place in this schema where "who owns this" is deliberately **not** a stored
`company_id`. A warranty links to a DRM item; its owner is resolved at read time through
whichever company currently holds that item's lead discipline.

```sql
create table warranty_templates (      -- the published starting sixteen, tenant-forkable
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  drm_ref text not null,               -- matches drm_library.reference, e.g. '04.060'
  title text not null, description text,
  period_years int, beneficiary text, form text
);

create table warranties (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,
  drm_ref text,                        -- matches this project's drm.reference — NOT a company
  title text not null, description text,
  period_years int, beneficiary text, form text,
  provided_by text,                    -- free text; the actual manufacturer/subcontractor,
                                        -- once known, distinct from who is chasing it
  status text not null default 'Not started',
  required boolean not null default true,
  programme_task_uid text, offset_days int default 0,
  anchor text default 'finish', due_override date,
  custom boolean not null default false,
  unique (project_id, reference)
);
```

**Do not add `company_id` to this table.** Resolve ownership with a view or function that joins
through `drm` on `warranties.drm_ref = drm.reference` for this project, then through
`company_disciplines` on `drm.lead`:

```sql
create or replace function warranty_owner(p_warranty_id uuid)
returns table(company_id uuid, company_name text) language sql stable as $$
  select c.id, c.name
  from warranties w
  join drm d on d.project_id = w.project_id and d.reference = w.drm_ref
  join company_disciplines cd on cd.discipline = d.lead
  join companies c on c.id = cd.company_id and c.project_id = w.project_id
  where w.id = p_warranty_id and d.applicable
$$;
```

If `d.lead` is null, or no company holds it, the function returns no rows — that absence *is*
the "no owner" state, and the UI shows it exactly the way the DRM's own gap detector shows a
gap, because it is running the same query in spirit. Reassigning `drm.lead` changes every
linked warranty's resolved owner immediately, with no write to `warranties` at all. This is the
one relationship in the schema worth a comment in the migration explaining why it isn't a
foreign key — the next engineer's instinct will be to normalise it into one, and that would
silently reintroduce the thing this design avoids: an owner that goes stale the moment the
matrix changes.

**RLS follows the resolved owner, not a stored one.** A company's `select` policy on
`warranties` should use `warranty_owner()` in its `using` clause, the same as every other
company-scoped read in this schema — just resolved through a function instead of a column.

### Material samples — a submission history, not a single decision

```sql
create table materials (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,
  title text not null, spec text, location text,
  company_id uuid references companies(id), person_id uuid references profiles(id),
  programme_task_uid text, offset_days int default 0,
  anchor text default 'finish', due_override date,
  required boolean not null default true,
  custom boolean not null default false,
  unique (project_id, reference)
);

create table material_submissions {         -- one row per round, never overwritten
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials(id) on delete cascade,
  round int not null,
  submitted_at date not null,
  sample_reference text,
  decision text not null default 'Pending',
  decided_by uuid references profiles(id), decided_at timestamptz,
  comments text,
  unique (material_id, round)
);
```

**Never update a submission row once decided.** A new round is a new row. This is what makes
"was this rejected before?" answerable months later without anyone having deliberately kept a
paper trail — the trail is just what the table already is. Restrict `decision` updates on a row
to whoever created it while `decision = 'Pending'`, and to the design-manager role only —
`can_decide_material(project_id)`, the same shape as the change-control classification guard in
§37, enforced at the policy level and not just hidden in the UI.

### Planning and building control — one importer, two kinds

```sql
-- No new tables. This is an import PATH into planning_conditions and
-- building_control, sharing one validator and one apply function keyed by
-- 'kind'. Building two separate importers is how they drift apart —
-- resist the temptation even though the two target tables differ.
```

Validate headers before writing a single row (`TRACKER_PLANNING_HEADERS` /
`TRACKER_BC_HEADERS` in the prototype), diff against what already exists by natural key
(`condition_no` for planning, `(part, title)` for BC) so a re-import updates rather than
duplicates, and return rejected rows with a named reason rather than silently dropping them.
The prototype resolves a `Discipline` column to a suggested `company_id` only when exactly one
company on the project holds that discipline — same ambiguity rule as the checklist importer —
and leaves it unassigned otherwise.

### Scope of service — named templates, and a bug worth learning from

This one shipped broken in an earlier pass, and the shape of the bug is worth keeping in mind
for every other "one flat list applied to everyone" table in this schema.

```sql
create table scope_templates (           -- was one flat table; now one row per NAMED template
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id),   -- null = published default, fork-on-create per §1a
  name text not null,
  discipline text,                       -- null/'All' for the core standard template
  is_core boolean not null default false -- the standard template only; cannot be deleted
);

create table scope_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references scope_templates(id) on delete cascade,
  reference text not null,
  heading text not null, description text not null,
  riba_stage text not null,
  unique (template_id, reference)
);

alter table scope_items add column template_id uuid references scope_templates(id);
-- null template_id = imported from a licensed schedule (BG6 etc.), not template-derived
```

**The bug:** a discipline-tagged row was added to the one existing template without updating
the apply flow to filter by discipline, so applying "standard scope" to any company pulled in
every discipline's items regardless of who was being appointed — a mechanical engineer could
receive architectural production-information duties. The fix was not a filter bolted onto the
old table; it was recognising that "the standard items" and "the architectural items" were never
one list to begin with, and splitting them into named, independently-appliable templates removed
the class of bug rather than one instance of it.

**Apply as a selection, not a single action.**

```sql
create or replace function suggested_scope_templates(p_company uuid)
returns setof scope_templates language sql stable as $$
  select t.* from scope_templates t
  where t.is_core
     or exists (select 1 from company_disciplines cd
                where cd.company_id = p_company and cd.discipline = t.discipline)
$$;
```

Pre-check the result of this function in the apply UI; let the user check anything else by hand
for a company covering more than one discipline. Dedup on apply by `(company_id, template_id,
reference)`, not by `reference` alone — two different templates are free to reuse the same
reference numbering internally (the prototype prefixes them: `STD-`, `ARC-`, `STR-`, and so on)
and should never be treated as the same item because the numbers happen to collide.

**Applied items store the template's name at the time of application** (`scope_items.standard`
in the prototype), not a live join — so renaming a template later doesn't rewrite history on
appointments that already have its items. `template_id` is still the reference used for dedup
and for "which template gave me this row"; the stored name is display-only.

**The one thing to test before this ships again**: write the seed/fixture data generator to
assert, the same way the prototype's test now does permanently, that no company ends up with a
discipline template it doesn't hold the discipline for. That assertion is cheap to write and is
exactly the class of bug that shipped here — a migration or seed script is exactly where it
would silently reappear.

### The risk template library

```sql
alter table risk_templates add column organisation_id uuid references organisations(id);
-- null organisation_id = the published default; same fork-on-creation pattern as
-- checklist_templates and drm_library in §1a.
```

Loading never sets `person_id`, `likelihood` beyond the template default, or a review date —
those are project-specific judgements, and a loader that guessed them would be inventing a
decision somebody has to be accountable for. Skip on `title` match, same as every other
template loader in this schema.

---

## 4. Row Level Security

This is the part to get right first. Every table needs `enable row level security`.

Helper function, used by nearly every policy:

```sql
create or replace function member_role(p_project uuid)
returns text language sql stable security definer as $$
  select role from project_members
  where project_id = p_project and profile_id = auth.uid()
$$;

-- Returns the company tree the current user belongs to, including sub-consultants.
create or replace function my_company_tree(p_project uuid)
returns setof uuid language sql stable security definer as $$
  with recursive root as (
    select company_id from project_members
    where project_id = p_project and profile_id = auth.uid()
  ), tree as (
    select c.id from companies c join root r on c.id = r.company_id
    union all
    select c.id from companies c join tree t on c.parent_id = t.id
  )
  select id from tree
$$;
```

### The admin override

`admin` sees every record in the system, and it beats every distribution list, restricted
thread and closed register. Build it as **one function referenced by every policy**, never as a
role check written out again in each one — an override copied into thirty policies is one that
somebody eventually forgets, and the failure mode is silent: a row that quietly does not appear
in a list nobody knows is short.

```sql
create or replace function is_admin(p_project uuid)
returns boolean language sql stable security definer as $$
  select coalesce(member_role(p_project) = 'admin', false)
$$;
```

Every `for select` policy on a table carrying a distribution list — `issues`, `meetings`,
`risks` — leads with `is_admin(project_id) or ...`. Same on the fee tables, where `admin` and
`internal` already saw everything.

**`internal` is deliberately not included.** HBC internal keeps its existing access to tasks,
meetings and fees but does not get the risk override. If that turns out to be the wrong line, it
is one word in `is_admin`, but it should be a decision rather than a drift.

**Say so in the interface.** The risk detail page names the design manager on the visibility
panel alongside the raiser and the owner. A register that tells somebody their entry is private
when it is not is worse than one that makes no promise — the first time a person discovers
otherwise, they stop writing candidly anywhere in the app. The override is a permission, not a
secret.

Policies:

```sql
-- Projects: you see a project if you are a member of it.
create policy proj_select on projects for select
  using (exists (select 1 from project_members m
                 where m.project_id = projects.id and m.profile_id = auth.uid()));
create policy proj_write on projects for all
  using (member_role(projects.id) = 'admin')
  with check (member_role(projects.id) = 'admin');

-- Directory: everyone on the project reads it. Only HBC writes.
create policy co_select on companies for select
  using (exists (select 1 from project_members m
                 where m.project_id = companies.project_id and m.profile_id = auth.uid()));
create policy co_write on companies for all
  using (member_role(companies.project_id) in ('admin','internal'))
  with check (member_role(companies.project_id) in ('admin','internal'));

-- Appointment documents: HBC and client see all. Consultants see only their own tree.
create policy appt_select on appointment_documents for select
  using (
    exists (select 1 from companies c where c.id = appointment_documents.company_id
            and member_role(c.project_id) in ('admin','internal','client'))
    or appointment_documents.company_id in (
         select my_company_tree((select project_id from companies
                                 where id = appointment_documents.company_id)))
  );
create policy appt_write on appointment_documents for all
  using (exists (select 1 from companies c where c.id = appointment_documents.company_id
                 and member_role(c.project_id) in ('admin','internal')));

-- DRM: all members read, HBC writes.
create policy drm_select on drm_items for select
  using (exists (select 1 from project_members m
                 where m.project_id = drm_items.project_id and m.profile_id = auth.uid()));
create policy drm_write on drm_items for all
  using (member_role(drm_items.project_id) in ('admin','internal'))
  with check (member_role(drm_items.project_id) in ('admin','internal'));

-- Comments: all members read, everyone except client writes, nobody edits another's.
create policy cmt_select on comments for select
  using (exists (select 1 from project_members m
                 where m.project_id = comments.project_id and m.profile_id = auth.uid()));
create policy cmt_insert on comments for insert
  with check (member_role(comments.project_id) in ('admin','internal','consultant')
              and author_id = auth.uid());

-- Change log: HBC only, insert via trigger.
create policy chg_select on change_log for select
  using (member_role(change_log.project_id) in ('admin','internal'));
```

**Approval is not an RLS rule.** Ticking `approved` must be restricted to `admin`. Enforce it with a `before update` trigger that raises if `approved` changed and `member_role(...) <> 'admin'`, because RLS cannot restrict a single column.

Fee tables in Phase 11 follow the same pattern as `appointment_documents`: HBC and client see everything, consultants see their own tree only. Write those policies at the same time as the tables, never afterwards.

---

## 5. Change log trigger

Generic, attach to every mutable table:

```sql
create or replace function log_change() returns trigger language plpgsql as $$
declare pid uuid;
begin
  pid := coalesce(new.project_id, old.project_id);
  insert into change_log (project_id, actor_id, entity_type, entity_id, action, value_from, value_to)
  values (pid, auth.uid(), tg_table_name,
          coalesce(new.id, old.id),
          tg_op,
          case when tg_op = 'INSERT' then null else to_jsonb(old)::text end,
          case when tg_op = 'DELETE' then null else to_jsonb(new)::text end);
  return coalesce(new, old);
end $$;
```

For a readable log rather than raw JSON, write per-table wrappers that name the field that changed. The prototype's log format is the target: *who, what item, which field, from, to*.

---

## 6. Storage

One bucket, `project-files`, private. Path convention:

```
{project_id}/appointments/{company_id}/{slot}/{uuid}-{filename}
{project_id}/evidence/{entity_type}/{entity_id}/{uuid}-{filename}
```

Storage RLS mirrors the table policies: a consultant can read only paths under their own company tree. **No drawings go in this bucket** — the drawing register stores a CDE URL only.

---

## 7. Email

One Edge Function, two triggers:

- **On assignment** — when a `drm_item.lead_discipline`, task, condition or BC item is assigned to a company, notify that company's primary contact plus anyone `@mentioned`.
- **Weekly digest** — pg_cron at `0 6 * * 1` UTC (07:00 BST). One query per project member, rendering the template shown on the prototype's "Monday summary" page. Content is filtered by the same permission rules as the UI, so a consultant's digest never leaks another consultant's position.

Give users three settings: immediate on assignment, daily digest, weekly digest. Default to weekly plus immediate-on-assignment.

---

## 8. Design tokens and theming

Three layers of token, and the layers matter more than the values.

**Tenant-customisable — brand only.** `--brand` is set from the organisation record. `--brand-ink`,
`--brand-soft` and `--brand-deep` are derived from it (contrast-checked text, a tint, a darker
hover) so a tenant sets one colour and every state follows. The logo is the only other brand
asset. That is the whole customiser: name, logo, one colour, light or dark.

**Structural.** Paper, surface, ink, rule, graphite. These flip for dark mode via
`:root[data-theme="dark"]` as a token override, not a second stylesheet.

**Semantic — never customisable.** Hi-vis means an unallocated gap. Green, amber and red mean
what they mean. These are literal values in the stylesheet, not variables a tenant can reach,
and dark mode adjusts only their backgrounds. If a tenant could make "overdue" blue, the
convention that holds every page together is gone. The Settings page shows the five fixed
pills so the rule is visible rather than implicit.

**Kind tints.** A fourth, quiet layer: evidence, discussion, commercial and compliance panels
each carry a left border and a tinted header, so a page tells you what sort of thing you are
looking at without spending the semantic colours. Discussion threads are chat-shaped and
purple-tinted; they should never look like a form.

Navigation is solid brand colour with the active item marked in hi-vis — the one place hi-vis
means "you are here" rather than "gap", which is acceptable because it is outside the content
area and cannot be confused with a row.

Fonts: one sans (Inter, falling back to Helvetica), one mono for codes and numbers. No third.

## 9. Prompts to give Lovable

Rough sequence. Give it the schema section above first, then these.

1. *"Set up Supabase auth with a profiles table and a project_members join table with roles admin, internal, consultant, client. Add a project switcher in the top bar showing only projects the signed-in user is a member of."*
2. *"Build a companies table supporting self-referencing parent_id for sub-consultants. Render the directory as an indented tree, sub-consultants nested under their lead. Enforce unique originator_code per project."*
3. *"Add five fixed appointment document slots per company with Supabase Storage upload and an approved checkbox that only admin role can change. Derive an appointment status of Complete, Partial or Not started from the four mandatory slots."*
4. *"Create a DRM library table and a per-project drm_items table. Add a 'Load standard library' action that copies library rows into the project. Highlight any row where lead_discipline is null, or where no company on the project holds that discipline, and surface the count on the dashboard."*
5. *"Add a polymorphic comments table with entity_type and entity_id, and a reusable CommentThread component. Mount it on the company profile and the DRM item detail page."*

Insist on RLS after each step. Lovable will happily build a working UI with the policies wide open.
