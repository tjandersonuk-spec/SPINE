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
except the derived views. This is **enforced, not reviewed**: `supabase/tests/phase14.test.ts`
scans `pg_proc` and fails the build if any function other than `take_snapshot`, `project_trend`
and `portfolio_trend` names the table. Nobody may write one by hand either — there is no insert,
update or delete policy at all, and the writer is `security definer` with execute revoked from
`authenticated`, because a stored figure somebody could edit is one they could edit into agreeing
with an argument. `portfolio_summary()` is live rather than read from today's row even though the
two would usually agree: "usually" is how a dashboard starts being a day behind unnoticed.

## Other rules that must not be reinterpreted

- Licensed third-party content (BREEAM criteria, BG6, CIC) is **never shipped**. Tables that would
  hold it start empty and are loaded per-project by whoever holds the licence.
- **The change log is written by a trigger, and nobody can edit it.** Application-side logging
  records what the developer remembered to log; the trigger records what actually happened,
  including an edit made straight through PostgREST. One row per field that genuinely moved — a
  write that changes nothing logs nothing. No role holds insert, update or delete on
  `change_log`; every project member reads it, because a trail only some people can see is a
  record of what someone was shown rather than of what happened.
- **A tenant sets a name, a logo, one brand colour, and light or dark. That is the whole
  customiser.** Everything the colour drives — the readable text on it, a tint, a darker hover —
  is derived in `src/lib/theme.ts`, never asked for. The derived ink is white or **pure black**,
  not the structural `#14181B`: the worst brand is the one equidistant from both, at 4.58, which
  clears AA — while a near-black drops a band of mid-luminance colours below 4.5 with neither
  option passing. `src/theme.test.ts` sweeps the whole colour space rather than a list.
- **A module nobody has decided about is ON.** Entitlements are packaging, not permission — RLS
  decides what a person may read and is untouched by any of this — so failing closed protects
  nothing and breaks the product for any account that has not yet been sold a feature list.
  `organisations.modules` defaults to `{}`, and reading an absent key as "off" emptied every
  sidebar the moment the shell started asking. A key that is **not a module at all** stays off,
  which is what keeps a nav entry naming a module that does not exist from ever appearing.
  `project_shell()` returns the map already resolved over `module_keys()`, so the client looks
  a value up rather than reimplementing the rule and eventually disagreeing.
- **A module that is off is absent, not dimmed**, and its page refuses rather than rendering
  empty. Showing a locked door tells a consultant what their client has and has not paid for.
  `src/theme.test.ts` fails the build if a gated nav key is missing from `module_keys()`.
  **My work and Admin are `core` groups, never gated:** a project with no settings page and no
  change log is not a cheaper product, it is a broken one.
- **An export contains exactly what the person exporting can already see.** Every export goes
  through the same query layer the pages use, so RLS does the filtering — a wide query narrowed
  afterwards in the browser is the easiest way in the product to leak a restricted RFI. A section
  the exporter cannot see is marked withheld rather than omitted: a silent omission reads as
  "there is none of that", which is a different and worse claim.
- **Consultant health is a sort order, never a grade**, and it never leaves the contractor's own
  staff. A letter or a percentage invites an argument about the mark rather than about the facts
  under it. Open items are not in the score: a busy consultant is not a worrying one, a late or a
  silent one is. **"Gone quiet" is silence, not age** — touched means a comment or a change-log
  entry, so an item being old is not the finding.
- **There is exactly one `programme_timeline()`**, called by the dashboard and by Phase 13's
  period report. Two functions drawing the same bar would eventually draw different pictures.
  The dashboard's `decision_queue()` is keyed on `auth.uid()` and answers "what is waiting on
  me"; `report_attention()` answers "what is waiting on this audience" and is a **separate
  function**, because a report addressed to a client that referenced whoever generated it would
  leak whose account produced it. A test asserts `report_attention` contains no `auth.uid()`.
- **A report is a query, never a document.** Nothing is drafted, saved or versioned — there is no
  report table, and a test fails the build if one appears — so there is never a stale copy to
  reconcile against the live project. **The audience decides content in one place**, in the four
  report functions, never as `if audience === 'client'` in a template: a section missing from a
  client report is missing because the query returned nothing, which is the only way the rule and
  what is rendered cannot drift apart. `report_scope()` **raises** rather than substituting, so a
  consultant asking for a rival's report gets a refusal and not their own figures under another
  company's name. Consultant health is internal only; gone-quiet is withheld from the client
  entirely (a stall is a tone judgement, not a fact for an automated document); "coming up" is
  identical for all three, because a date is not commercially sensitive. The **client exclusion
  list is a commercial and liability judgement**, not a permissions one — review it with whoever
  owns that decision before go-live, and do not let it drift by feature addition.
- **A consultant's front is scoped through `my_company_tree()`**, which recurses: a firm is
  answerable for the specialists it appointed under itself. A rival on the same project is
  absent from every figure, not merely unhighlighted.
- **The portfolio is a roll-up and nothing else.** Every figure on it is the one a project page
  already computes; the only new code is the aggregation, which is what stops the two disagreeing
  in front of somebody who has both open. Which projects appear is `my_projects()` — stated once,
  never restated — so account staff see their account's and everybody else sees their own
  memberships. A firm on several jobs is gathered by **catalogue entry**, not by name: `companies`
  is per-project, and matching on name would merge two different firms that share one and split
  one that was typed twice. `my_decisions()` is keyed on `auth.uid()`, the opposite of
  `report_attention()`, because a dashboard is read by the person looking at it.
- Hi-vis yellow means exactly one thing: an unallocated DRM gap. Nowhere else in the UI. The
  token is `--hivis` and is fixed: semantic colours are never part of a tenant's theme.
- **The design tokens are the prototype's, and they come in three groups with a hard boundary
  between them.** *Brand* (`--brand` and its derivations) is the only thing a tenant may change,
  and it drives nav, primary buttons and links — nothing else. *Structural* (paper, ink, rules,
  elevation) flips for dark mode and is not customisable, because legibility is not a matter of
  taste. *Semantic* (`--hivis`, `--ok`, `--warn`, `--stop`, and the four kind tints) is never
  customisable and never themed — only its ground moves in dark mode, far enough to stay legible
  and no further. Design direction, from the prototype's own first comment: *structure is drafting
  ink, signal is hi-vis, codes are monospace*.
- **Every code is monospace and every table is the dense one.** A reference, an originator code, a
  discipline letter, a drawing number and a programme UID are read down a column, not across a
  sentence: use `<Code>` and the `Table` primitives in `src/components/ui/table.tsx` rather than a
  bare `<table>`. A gap row gets `gap` on `<TR>` and nothing else does.
- **The discipline list is the prototype's twenty-six, and each carries its ISO 19650 letter.**
  Mechanical, electrical and public health are three appointments, not one. The letter is what
  Phase 5's naming convention is built from, so it is set when the discipline is, never after.
- Every reference to another record is a working link, never printed text.
- Templates (DRM library, checklist templates, scope templates, risk/warranty libraries) are
  **host assets forked from a published default**. Editing a template never rewrites a project
  that already loaded a copy of it.
- Warranties resolve their owner live through the DRM lead discipline. **Never add a `company_id`
  column to warranties** — same gap the matrix shows, same fix.
- **A pack holds references, and never a date.** `drawing_pack_programme` links a pack to a
  programme line as a *resource only*, so whoever is doing that work can find the drawings for
  it. A drawing's due date comes from its own anchor columns on `drawing_register` and nowhere
  else. This is now enforced rather than reviewed: a table carrying `programme_task_uid` without
  `offset_days` beside it is a link, not an anchor, and `supabase/tests/phase4.test.ts` fails the
  build if one appears in `programme_dependents()`.
- **Import and reconcile are separate transactions, and a transmittal is frozen.** Importing a CDE
  export writes `document_rows` only; the register changes when a person accepts a row and never
  before, because a register nobody accepted is a register nobody trusts. Only PDFs become
  register rows — a DWG of the same number sets `has_dwg` — and this is the one place two source
  rows collapse to one. `transmittal_items.revision_at_issue` is written once: a trigger refuses
  to change it and no role holds update or delete on any transmittal table, so a correction is a
  new transmittal.
- **No drawings are ever stored in Supabase Storage.** The drawing register stores a CDE URL
  only. The one storage bucket (`project-files`, private) holds appointment documents and
  evidence/comment attachments only, path-scoped `project/company/slot/filename` so a consultant
  reads and writes only their own company tree and cannot see a rival's fee scope on the same
  project. Links are signed and expire; a replacement supersedes rather than overwrites, so there
  is no update policy on `storage.objects` at all. The policies resolve the caller's own company
  through the definer `my_company_on_project()` — read inline they would always fail, because
  member visibility is admin-only and a consultant cannot see their own membership row.
- One `visibility` jsonb primitive on any record that has an audience, read by one `can_see()`
  function: `project` (everyone on the project — the default for tasks), `named` (raiser + owner +
  listed people only — the default for risks), `parties` (company trees + named people — change
  requests), `internal` (host's own staff only — pre-construction). Admin always sees everything,
  overriding whichever mode applies. **The raiser and the owner are never locked out of their own
  record** — a list that hides an item from the person carrying it reads as the item having
  vanished. A `named` list holds **profile ids**, because `can_see()` compares them against
  `auth.uid()`; a directory row with no login behind it cannot be named in one. A mode no branch
  understands is refused by `visibility_is_valid()` at write time rather than falling through to
  "everyone", which would be the worst possible default. Later phases add their audience to this
  column, never a `*_distribution` table of their own.
- **A record of who did what is never writable.** `reviewed_by`/`reviewed_at`/`revision_at_review`
  on evidence, `closed_by`/`closed_at` and the RFI response fields on issues, `raised_by` and
  every generated `reference` — all outside the update grant, written only by the definer function
  that performs the act. The revision at add and at review is stamped by trigger from the
  register: the reviewer states that they reviewed it, but which revision that was is a fact
  rather than their opinion.
- **A generated reference sequence is keyed on the prefix, not the kind.** Three issue kinds share
  the `TSK` prefix, so keying `next_reference()` on the kind gives each its own counter and they
  collide at `TSK-001`.
- Invitations are consent-based. Adding someone to a directory creates an invite; typing an email
  address grants nothing. Membership is only created when the invited person accepts from their
  own login.
- The Building Safety Act change-control classification guard is enforced by policy/handler, never
  by hiding a button in the UI — a synthetic event from the wrong role must be refused server-side.
  The classification columns on `change_requests` sit outside the update grant, so
  `classify_change()` is the only path to them and it re-checks `can_classify()` itself. **Internal
  staff cannot classify**: a designation the client's own dutyholder did not make is not a
  designation, and the fact that the UI would not offer them the button is not what stops them.
- **A change request's work status is derived, in twelve states, by one function.** `work_status()`
  answers whether work may proceed from the classification, the notification and the acceptance
  together — never from a stored flag someone forgot to clear. Every state is tested, and a
  meta-test fails the build if a thirteenth appears without one. The notification and acceptance
  periods are **columns, not constants**: the published figures disagree with each other, so the
  project carries the ones it is working to.
- **The golden-thread baseline is stamped once.** `g2_revision` records the revision that was
  current at gateway 2 and a trigger refuses to change it; `golden_thread_moved()` and
  `golden_thread_never_issued()` are then derivations off the register rather than a second list
  somebody maintains. A drawing that moved after gateway 2 and one that never went out at all are
  different findings and are reported separately.
- **An occurrence is not a risk.** Mandatory occurrence reporting is a statutory duty with its own
  audience and its own clock, so it is its own table — folding it into `risks` would put a
  regulator's report behind the risk register's `named` default.
- **BREEAM is derived from the credit rows and never from a stated total.** A section's credits
  available is summed in `v_breeam_sections`; `sections[].stated` is a cross-check reported as
  `stated_gap`, never used in a score. A prerequisite that is not `Verified` zeroes its issue in
  `v_breeam_issues` and names itself in `blocked_by` — built into the view so it cannot be
  bypassed. `breeam_totals()` returns the rating on score **and** the rating after minimum
  standards, side by side, with `capped_*` saying whether they differ. A zero-credit minimum
  standard is a criterion: it caps only when a prerequisite under that issue is outstanding, and
  is otherwise advisory — the prototype's unconditional fail made the achieved rating unreachable.
- **A BREEAM credit is a `tracked_items` row, linked by `breeam_issue_id`** — a real foreign key,
  present exactly when `kind = 'breeam'`. The credit numbers live in `ext`, typed by value, and
  `ext` is **outside the `tracked_items` update grant**: `set_breeam_credit()` is the only way they
  move. A later kind that needs to write `ext` (the utilities dates) gets its own definer function,
  never a re-grant. `sections`, `weightings`, `ratings` and `min_standards` are outside the grant
  for the same reason: they are the scoring basis, loaded by `breeam_import_apply()` alone.
- **A scheme is a version, and a project holds several.** `projects.breeam_scheme_id` names the
  live one; switching it switches the whole framework. The reference on a credit is
  `<issue>.<ordinal>` counted across the **project**, because two schemes may both carry `Man 01`
  and `tracked_items` is unique on `(project, kind, reference)`.
- **The admin override is the ADMIN override.** `can_see()` grants past the mode for an account
  **admin** or that project's own admin, and for nobody else. It once granted for all account
  staff, which handed every `internal` member every `named` record on the project — a costed risk
  is a commercial position long before it is a shared one. `internal` mode keeps its own branch,
  because host-staff-only *is* that mode's definition. A mode no branch understands is **closed**,
  not everyone: `visibility_is_valid()` refuses one at write time and `can_see()` refuses it again.
- **There are exactly two deliberate exceptions to the discipline rule.** A **fee** belongs to a
  company, because an appointment is a contract with a firm and the money under it is owed to that
  firm whatever disciplines it holds. A **risk owner is a person** (`profiles`, so `can_see()` can
  compare them against `auth.uid()`), because a live risk is somebody personally chasing something
  down and a risk owned by "structures" is a risk nobody is holding. Both are commented at the
  column. Do not "fix" either for consistency, and do not add a third.
- **Proposed and approved are never one figure.** `fee_position()` carries them in separate
  columns and the only total that calls itself a total is the approved one — a fee report that
  mixes them looks overspent and stops being believed. Two silent checks are views because
  neither announces itself: an instalment past due with nothing claimed against it, and a schedule
  total that differs from the approved fee. **A proposed instalment still counts in the planned
  cashflow** (it is the consultant's stated expectation, and omitting it makes the curve
  optimistic), with the agreed subtotal carried separately.
- **Nothing about risk exposure is stored.** Likelihood maps to a fixed percentage; the impact band
  is **derived from the cost, never chosen** — which removes the commonest argument in a risk
  workshop; expected value is cost × likelihood and is zero once an item is finished. Every summary
  shows expected value. `gross` is returned only so a page can label it as what everything would
  cost if it all happened, and never as exposure. **A realised risk becomes one task** through
  `realise_risk()`, which is idempotent and is the only way `status = 'Realised'` is reachable.
- **Approval is not implementation, and no trigger anywhere acts on approval** — a test reads
  `pg_trigger` and fails if one appears, because an automatic edit is a second source of truth
  arriving with nobody reading it. `set_change_status()` refuses `Implemented` while an amendment
  is outstanding and refuses it outright when nothing was listed; un-ticking knocks the status
  back. A decision date after the effective date is **reported, never blocked**. `variation_id`
  must reference a variation, not a base fee, and the register never gains a value column.
- **A decided material submission round is frozen and undeletable.** A correction is a new round,
  which is what keeps "was this rejected before?" answerable after a later approval. Deciding is
  `can_decide_material()` — the design manager, refused by the database rather than by a hidden
  button, and `internal` is not it.
- **The pre-construction budget is account staff only, and that excludes a project admin** — who
  may be the firm that quoted — and the `client` role. `can_see_precon()` is deliberately not
  `can_write_project_setup()`. **An export whose module filters rows rather than refusing the
  query needs its own visibility question**: `[]` would read as "there is none of that".
  `ModuleExport.visible` is that question.
- **RLS decides rows; GRANTs decide columns.** A policy that lets someone edit a row lets them
  edit *every column of it*, because Supabase grants `authenticated` update on all columns by
  default. Any column that a role may see but must not write — `organisations.modules`,
  `projects.modules_override`, `profiles.email`, a reviewer's verdict — needs the blanket update
  revoked and a column-level grant in its place. Whenever a phase adds a table with an update
  policy, ask which columns that role has any business writing. A table created by a later migration
  inherits nothing from an earlier `grant on all tables`, so every migration that adds a table
  states its own grants — and grants only what that table's policies are meant to allow.
- **Every date resolves through `due_date(project, uid, offset, anchor, override)` — and it takes
  the project.** `programme_tasks.task_uid` is the planner's own ID and is unique *per project*
  only, so any lookup by uid alone resolves against whichever other project shares the numbering.
  The prototype computes a due date in four separate copies; there is exactly one here, and a
  module that wants a date calls it rather than reimplementing it. A table that gains the four
  anchor columns (`programme_task_uid`, `offset_days`, `anchor`, `due_date_override`) adds its
  branch to `programme_dependents()` in the same migration, or it disappears from the line
  inspector — `supabase/tests/phase4.test.ts` fails the build if it doesn't.
- **Rescheduling writes to `programme_tasks` and nothing else.** No role holds insert or update on
  it: a revision is applied only by `import_programme()`, which validates the whole file, builds
  the diff and writes atomically. A line missing from a revision is marked `removed`, never
  deleted, so anything anchored to it keeps its last date and gains a flag instead of silently
  losing a deadline.
- **Name the foreign key in any PostgREST embed whose table has more than one to the same
  parent** — and if you name one, name it correctly. A constraint that does not exist fails at run
  time exactly like an ambiguous embed, on a query that looks more careful than the one it
  replaced. `supabase/tests/embeds.test.ts` checks both: that ambiguous embeds are disambiguated,
  and that every name given resolves to a real foreign key — so neither an added audit column nor
  a mistyped constraint can silently break a page. `profiles(name)` is ambiguous the moment a
  table gains a second reference to `profiles` — an `added_by` beside a `profile_id`, a
  `reviewed_by` beside a `requested_by` — and fails with "more than one relationship was found",
  which no type checking catches because the query is a string. Write
  `profiles!project_members_profile_id_fkey(name)`.
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
  conditions, building control, scope-of-service lines, BREEAM credits and the checklists.
  `tracked_kinds()` names every kind once, so a typo is an error rather than a row nothing reads.
  **`required = false` is the strike-out**: it drops the row from every denominator and renders it
  struck through, but the row survives — deleting it loses the decision that it was not needed,
  which is precisely what gets asked about later. A template row can only be struck out; a row
  added on the project (`custom = true`) may be deleted, because nothing was decided by removing
  something typed by mistake.
- **`ext` is typed by constraint, not by convention.** A check constraint names the permitted keys
  per kind — the utilities sequence, BREEAM's credits — so the escape hatch cannot become a junk
  drawer. If a kind's `ext` grows past six or seven keys it has earned a side table.
- **Pre-assignment refuses to guess.** `sole_holder()` sets the owner from a template's discipline
  only where exactly one company holds it. Two holders means blank: a wrong default gets accepted
  silently where a blank gets asked about.
- **A scope template is a named row, never one flat list.** This shipped broken once — a
  discipline-tagged row added to the single template, with the apply flow not filtering, so
  applying "standard scope" gave a mechanical engineer architectural production-information
  duties. Dedup on `(company, template, reference)` and never on reference alone: two templates
  are free to reuse numbering internally. An applied row stores the template's name **as it was**,
  so renaming later does not rewrite history on an appointment that already has its items.
- **A response carries its provenance.** `response_source` distinguishes a machine suggestion from
  a person's answer, and accepting one is a deliberate act recorded as theirs. The columns are
  outside the update grant and written only by `set_response()` and `accept_response()` — a
  suggestion silently promoted to an answer would stop the checklist meaning anything.
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

Invitations and membership requests are the admins' business. A member sees the
accounts they belong to and the member directory, and no more: My accounts is a
list of names for anyone who is not an admin, and does not open. Two exceptions
exist because they are about function rather than curiosity — an addressee must
see the invitation meant for them or they cannot accept it, and whoever raised a
membership request must see what became of it or they will raise it again.

`my_accounts()` and `my_projects()` are the only correct way to ask what the
signed-in person belongs to. Reading `organisation_members` directly returns a
row per member of each account, because a member may see their colleagues, and
a five-person account then appears five times.

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
