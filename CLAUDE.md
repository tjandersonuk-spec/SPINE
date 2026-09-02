# Design Management Platform — CLAUDE.md

Read this before touching any code. It is the condensed version of `docs/lovable-build-brief.md`
and `docs/lovable-handover-notes.md` — the rules here are the ones that get silently violated if
forgotten. Full detail lives in `/docs`; this file is what must never drift.

## What this is

A design management platform for main contractors who take on design responsibility. It sits
**above** the CDE (Asite, Aconex, Viewpoint) — the CDE holds files; this holds what is due, who
owns it, what slips when the programme moves, and what nobody has been given.

Reference material:
- `docs/dmp-prototype.html` — working single-file prototype. **Source of truth for behaviour**:
  what every derivation does, what every page shows to each role, what every button does. It is
  NOT the source of truth for structure, and its code should never be copied — only its behaviour
  reproduced.
- `docs/lovable-handover-notes.md` — the schema and rules document. **Source of truth for
  structure.** §1a and §1b are the identity/structural decisions and must be read before any
  schema work.
- `docs/prototype-vs-product-gap-register.md` — one row per module: what's proven in the
  prototype, what still needs building, which prototype test file its assertions should be ported
  from.
- `docs/landing-page-reference.html` — design tokens and tone reference for the marketing site.
- `TASKS.md` — the build order, phase by phase. Work through it in order; do not skip ahead.

## Two invariants that govern every module

1. **Nothing is assigned to a company directly.** Assignment is always to a **discipline**, and
   companies hold disciplines. "Which company holds this?" is always a live lookup
   (`companies_for_discipline(project, code)`), never a stored foreign key to a company.
2. **No date is ever typed.** Every date is `programme_task_uid + offset_days + anchor
   (start|finish)`, computed through one function (`due_date(...)`) used everywhere. Re-importing
   the programme reschedules the whole project with no writes to dependent records.

## Derive, never store

Construction status, due/overdue, cashflow, risk exposure, warranty ownership, BREEAM scores,
whether a change may proceed — all computed on read (views/functions), never stored columns.

**The one exception:** the nightly `snapshots` table. It stores facts *about a date*, for trend
charts only. No live figure is ever read from a snapshot, and no live page reads from anything
except the derived views.

## Other rules that must not be reinterpreted

- Licensed third-party content (BREEAM criteria, BG6, CIC) is **never shipped**. Tables that would
  hold it start empty and are loaded per-project by whoever holds the licence.
- Hi-vis yellow means exactly one thing: an unallocated DRM gap. Nowhere else in the UI.
- Every reference to another record is a working link, never printed text.
- Templates (DRM library, checklist templates, scope templates, risk/warranty libraries) are
  **host assets forked from a published default**. Editing a template never rewrites a project
  that already loaded a copy of it.
- Warranties resolve their owner live through the DRM lead discipline. **Never add a `company_id`
  column to warranties** — same gap the matrix shows, same fix.
- **No drawings are ever stored in Supabase Storage.** The drawing register stores a CDE URL
  only. The one storage bucket (`project-files`, private) holds appointment documents and
  evidence/comment attachments only, path-scoped so a consultant can read only their own company
  tree.
- One `visibility` jsonb primitive on any record that has an audience, read by one `can_see()`
  function: `project` (everyone on the project — the default for tasks), `named` (raiser + owner +
  listed people only — the default for risks), `parties` (company trees + named people — change
  requests), `internal` (host's own staff only — pre-construction). Admin always sees everything,
  overriding whichever mode applies.
- Invitations are consent-based. Adding someone to a directory creates an invite; typing an email
  address grants nothing. Membership is only created when the invited person accepts from their
  own login.
- The Building Safety Act change-control classification guard is enforced by policy/handler, never
  by hiding a button in the UI — a synthetic event from the wrong role must be refused server-side.
- **RLS decides rows; GRANTs decide columns.** A policy that lets someone edit a row lets them
  edit *every column of it*, because Supabase grants `authenticated` update on all columns by
  default. Any column that a role may see but must not write — `organisations.modules`,
  `projects.modules_override`, `profiles.email`, a reviewer's verdict — needs the blanket update
  revoked and a column-level grant in its place. Whenever a phase adds a table with an update
  policy, ask which columns that role has any business writing. A table created by a later migration
  inherits nothing from an earlier `grant on all tables`, so every migration that adds a table
  states its own grants — and grants only what that table's policies are meant to allow.
- **Only an account `admin` may create a project.** Enforced by the insert policy on `projects`,
  never by hiding the button — a direct insert from `internal`, a project admin or a consultant
  must be refused by the database. A project admin staffs their own project from the account's
  existing members; widening the account stays an account admin's decision.
- Locking an account (`suspended`) and archiving one (`archived`) are different operations and
  must not be collapsed: suspended is expected back and blocks sign-in mid-session; archived is
  finished and stays readable by its members. An account may only be deleted from `archived`, and
  its `platform_audit` row is written before the cascade so the trail survives its subject.

## Structural decisions the product makes that the prototype doesn't

(Full detail: handover notes §1a.)

- One `tracked_items` table with a `kind` column, not five separate tables, for planning
  conditions, building control, scope-of-service lines, and the six checklists.
- One `visibility` primitive and one `can_see()` function, not four different visibility rules.
- `organisations` (accounts) sit above `projects`; `organisation_members` links person × account
  × role × company and `project_members` links person × project × project role; a person can hold
  several memberships across several accounts and must never discover an account exists that they
  aren't a member of.
- Module entitlements live on the host record, read by the shell to hide nav entries and refuse
  pages.

## Identity model (build this first — see TASKS.md phase 1)

**Account** = a row in `organisations`: one main contractor's tenancy. **Company** = a firm in
that account's directory. Older text in `/docs` says "host" where the UI says "account".

Three levels: **platform owner** (above everything, own RLS bypass, own `platform_audit` table —
kept separate from the per-account change log deliberately, so an account admin can't see
platform-owner activity and the platform owner can't edit their own trail) → **accounts**
(`organisations`, each with `status` pending/active/suspended/archived, projects, catalogue and
template forks) → **people** (`profiles`: one login regardless of how many accounts they work
with).

**A login and an account are separate things.** Anyone may sign up; it creates a `profiles` row
and nothing else — no organisation, no membership, no request. Email confirmation is required.
A confirmed login with zero memberships is a normal, supported state: it lands on the personal
landing page and every query must return empty rather than error. From there the person may
raise an `account_requests` row, which the platform owner reviews, amends and approves — and
only approval creates the account and its first `admin` membership.

Two membership tables, and neither substitutes for the other. `organisation_members` (person ×
account × role × company, roles admin/internal/consultant/client) answers *are you in this
account*. `project_members` (person × project × project_admin|member) answers *which projects
are yours* — and is not `project_people`, which is the directory snapshot and often has no login
behind it. Account `admin` and `internal` see every project in their account without a
`project_members` row.

Invitations are one table with a `scope`. **Organisation scope** (account admin only) brings a
person into the account. **Project scope** (account admin or that project's `project_admin`) adds
someone to one project, and the invitee **must already be a member of the account that owns the
project** — checked at issue and again at accept, since membership can be revoked while a
14-day token is live. Membership is only ever created on accept.

Adding someone to an account runs in two directions. **Top down**, an account
admin invites and the invitation goes straight out. **Bottom up**, anyone working
on a project may propose someone — they know who is missing long before an admin
does — but a new member may change what the account is billed for, so it becomes
a `membership_requests` row that lands with the account's admins. Only their
approval issues the invitation, and they may change the role on the way through
because they carry the cost. Nothing reaches the person named until then, and
the consent step is unchanged: they still accept for themselves.

The platform owner sees accounts and people, **not project contents**. §1b once
granted "see any account's projects for support"; that is more than running the
platform needs and a customer's design data is the last thing the landlord
should read. Counts reach the owner through `account_summary()`, because how
many projects and members an account has is a billing fact rather than project
data.

An invitation reaches its addressee two ways, and both must work: the emailed
link, and the landing page, where anyone signed in with that address sees it
waiting with Accept and Decline. The email may be filtered or slow; the
invitation is theirs either way. `my_pending_invitations()` discloses the
inviting account's name to the addressee alone — an exception to account
isolation that consent requires, since agreeing to join something you cannot see
the name of is not consent.

The personal landing page spans accounts and is the only screen that does: a **My accounts** tab
(always present, even at one row) and a **Projects** tab listing everything the person can reach
across every account, each labelled with its account. Entitlements read through
`module_on(project_id, key)`; `organisations.modules` can be overridden per project via
`projects.modules_override`.

Billing is not built yet and belongs at the account level, in its own tables — never confused
with the commercial tier, which models what the contractor owes its consultants.

## Stack

- Vite + React + TypeScript + Tailwind + shadcn/ui
- Supabase (Postgres, Auth, Storage, RLS, Edge Functions for scheduled email) — schema as real
  migrations under `supabase/migrations/`, not ad hoc dashboard edits
- Resend or Postmark for transactional/digest email
- Netlify for deploys, continuous from `main`
- Vitest for derivation/unit logic, Playwright for behaviour/click-through tests
- CSV import: PapaParse with a column-mapping step (every DMS/programme export has different
  headers)
- PDF export: client-side, jsPDF + autoTable, title block populated from the project record
- Gantt: frappe-gantt or a custom SVG component — no heavyweight commercial Gantt library

## Testing

Every module in the gap register names a prototype test file (`test.js`, `behaviour.js`,
`bsa.js`, `breeam.js`, `changereq.js`, `newmodules.js`, `reports.js`, `audit-static.js`,
`audit-dynamic.js`). When building that module, open the named file in the prototype's test
harness, read its assertions, and port the **assertions**, not the code, into Vitest/Playwright.
Do not consider a phase done until its assertions have a passing automated equivalent.

Also preserve, as tests, the audit-proven behaviours that are easy to lose in a rebuild:
- A person who holds a login cannot be removed from the directory.
- Every "Add" control refuses empty input rather than creating a blank row.
- A duplicate "already on this project" add is refused, not silently duplicated.
- A tab clicked while active is a no-op.
- Exports honour the exporting role's visibility.
- The client role can never select the internal report audience; a consultant can never select
  another company's.

## Working conventions

- Work through `TASKS.md` in order. Each phase should leave a working, deployed application behind
  it — don't start a phase whose dependencies aren't merged.
- Commit at the end of each phase, not mid-phase.
- Before writing schema for a phase, re-read the relevant section of
  `docs/lovable-handover-notes.md` named in TASKS.md — don't rely on memory of it from an earlier
  session.
