# Build task list

Converted from `docs/lovable-prompt-sequence.md`. That document was written as one-shot prompts
for Lovable; here it's a phase checklist for Claude Code sessions. The order is unchanged and
matters — later phases assume earlier ones are merged. Don't start a phase out of order.

Each phase: read the referenced doc section(s) first, build, port that phase's named test
assertions (see CLAUDE.md → Testing), commit. Tick off as you go.

---

## Phase 0 — Framing session (do this once, first)

- [ ] Read `docs/lovable-build-brief.md` in full
- [ ] Read `docs/lovable-handover-notes.md` §1a and §1b in full
- [ ] Confirm you can restate the two invariants (discipline not company; date = programme line +
      offset) before writing any code

## Phase 1 — Identity, accounts, memberships, invitations

*Reference: handover §1b in full, plus §1a's organisations subsection.*

Terminology: an **account** is a row in `organisations` (one main contractor's tenancy); a
**company** is a firm in that account's directory. Older text says "host" for account.

### Logins and confirmation

- [ ] `profiles` (people) — one row per human, one login, created on sign-up
- [ ] Email confirmation required; an unconfirmed login reaches the confirmation screen and
      nothing else
- [ ] Sign-up creates **no** organisation, **no** membership and **no** request — a login on its
      own grants nothing
- [ ] A confirmed login with zero memberships can sign in and lands on the personal landing page;
      every data query returns empty rather than erroring

### Accounts and requests

- [ ] `organisations` (accounts) with `status` pending/active/suspended/archived and the
      lifecycle columns (approved/suspended/archived by and at, suspend reason)
- [ ] `account_requests` — raised from the landing page by any confirmed login; visible to its
      requester and the platform owner only; status pending/approved/rejected/withdrawn with a
      review note the requester can read
- [ ] `approve_account_request()` as one transaction taking the **reviewed** values, so a name or
      tier can be corrected before the account exists; creates the account active and exactly one
      `admin` membership for the requester
- [ ] Lock (`suspended`) and archive (`archived`) as distinct, reversible, platform-owner-only
      operations — suspended is expected back and blocks sign-in; archived is finished and stays
      readable by its members
- [ ] Delete only from `archived`, name typed to confirm, `platform_audit` row written **before**
      the cascade so the trail survives its subject
- [ ] Suspension enforced in every policy via `account_is_live()`, not only at sign-in — a live
      session must stop working immediately

### Memberships

- [ ] `organisation_members` (person × account × role × company); roles admin, internal,
      consultant, client
- [ ] `project_members` (person × project × project role: project_admin | member) — distinct from
      `project_people`, which is the directory snapshot and may have no login
- [ ] Account `admin` and `internal` see every project in their account with no `project_members`
      row; consultants and clients see only their rows

### Invitations — one table, two scopes

- [ ] `invitations` with `scope` organisation | project, token, 14-day expiry, accepted-at,
      revoked-at, and the shape constraints per scope — membership created only on accept
- [ ] Organisation scope: account `admin` only; brings a person into the account; may name
      initial `project_ids`
- [ ] Project scope: account `admin` or that project's `project_admin`; **the invitee must
      already hold membership of the account that owns the project** — checked at issue *and*
      re-checked at accept, because membership can be revoked while a token is live
- [ ] Never match on email: typing an address grants nothing

### Project creation and project-level administration

- [ ] **Only an account `admin` may create a project** — enforced by the insert policy on
      `projects`, not by hiding a button; an `internal`, a `project_admin` and a consultant are
      all refused at the database
- [ ] A `project_admin` may add and remove people on their own project, drawn only from that
      account's members; removal leaves the account membership and other projects intact
- [ ] A `project_admin` cannot widen the account — bringing a new firm or person into the
      tenancy stays an account admin's decision

### The platform owner

- [ ] `platform_owners` table and `is_platform_owner()`; every select policy on account-scoped
      tables gains `or is_platform_owner()`
- [ ] Accounts view: list every account, review/amend/approve/reject requests, lock, archive,
      delete, set modules and tier
- [ ] **People view: every login on the platform**, including logins with zero memberships, with
      email, confirmation state, sign-up date, last seen, and the accounts they belong to — these
      people appear in no other list in the product
- [ ] `platform_audit`, separate from the per-account change log, with no update or delete policy
      for anyone including platform owners
- [ ] No account admin can see this layer or that it exists

### The landing page

- [ ] Personal landing page for every signed-in person, whatever their memberships
- [ ] **My accounts** tab — always present, even at one row; carries account settings, the member
      directory, and "Request an account" plus request status when empty
- [ ] **Projects** tab — every project this person can reach across every account, each labelled
      with its account, each a link into the project UI; `my_projects()`
- [ ] Account isolation: the labelling is derived from the viewer's own memberships and never
      names an account they are not in

### Entitlements and billing seam

- [ ] `module_on(project_id, key)`; `projects.modules_override` merged over the account's map
- [ ] Billing not built. Leave `subscription_tier` and `modules` as the fields it will price
      against; no money on `organisations` itself

### Tests

- [ ] Port the full assertion list at the end of handover §1b — in particular: a new sign-up sees
      empty tabs and no errors; approving a request creates exactly one admin membership; a
      suspended account stops a live session; an account cannot be deleted unless archived; a
      non-admin's direct `insert` into `projects` is refused; a project invite to a non-member is
      refused at issue; an invite whose target lost membership is refused at accept; a host admin
      cannot list other accounts and the platform owner can list every login

## Phase 2 — Projects, directory, disciplines, master catalogue

*Reference: handover §3. Open `docs/dmp-prototype.html` at Directory and Master catalogue.*

- [ ] Projects, scoped to `organisation_id` — creation restricted to account `admin` by the
      insert policy built in phase 1
- [ ] Master catalogue of companies/people per host; a project takes a **copy** on selection,
      independent from then on; catalogue edits never rewrite a live project; a project can push a
      correction back
- [ ] `company_disciplines` table and `companies_for_discipline(project, code)` function
- [ ] Appointment documents per company (competency statement, CVs, appointment, scope of work)
      with approved flags; status derived
- [ ] People carry role, email, phone, primary-contact flag; name is a link to their card
- [ ] Tests: a discipline held by two companies returns both; held by none returns none and shows
      as a DRM gap; catalogue edits don't change project copies

## Phase 3 — Responsibility matrix (DRM)

*Reference: handover DRM section + standard library JSON. Open prototype at Responsibility matrix.*

- [ ] Host-level standard library (reference, category, item, default lead discipline, CDP flag,
      note); project loads a versioned snapshot
- [ ] Project item: lead discipline, coordination/input roles, applicable flag, note
- [ ] Gap = applicable item with no lead, or a lead discipline no company on the project holds —
      hi-vis yellow, the only use of that colour in the app
- [ ] `lead_companies()` live lookup
- [ ] Tests: reassigning a lead updates `lead_companies()` immediately; an item whose lead
      discipline nobody holds is a gap; dashboard gap count equals matrix gap count

## Phase 4 — Programme and the date spine

*Reference: handover programme section + import template. Open prototype at Programme.*

- [ ] CSV import (uid, description, type, start, finish, percent complete); header validation,
      preview, rejected rows returned as CSV
- [ ] Re-import updates by uid, marks missing lines as removed (never deletes), reports what moved
- [ ] One `due_date(uid, offset, anchor, override)` function, used everywhere a date appears
- [ ] Line inspector listing everything dated from it
- [ ] Tracking: a person can track a line and is notified when it moves
- [ ] Tests: slipping a finish date moves every anchored due date with no write to those records; a
      removed line flags its dependents rather than orphaning them; inspector count equals sum of
      dependents across all modules

## Phase 5 — Drawing register, packs, transmittals

*Reference: handover register, packs, transmittals sections. Open prototype at Documents and Transmittals.*

- [ ] Planned and delivered drawings are the same row; naming follows BEP convention with
      originator code per company; construction status, due, overdue, register sync all derived
- [ ] Packs: named reusable groups, references not copies; may link to a programme line as a
      resource only — enforce in review that no date query joins pack-to-programme
- [ ] Transmittals: reason, method, recipients, distribution list; selecting a pack expands to
      drawings at current revision (never stores the pack); distribution empty = whole project,
      populated = those people + host + raiser + owner
- [ ] Tests: a pack reflects a retitled drawing; linking a pack to a line changes no due date;
      revising a drawing after a transmittal shows "revised since issue" on the pack

## Phase 6 — Tasks, RFIs, meetings, comments, evidence

*Reference: handover issues, meetings, comments, evidence sections.*

- [ ] One issues store, `source` column distinguishes tasks/RFIs/comment-raised actions/meeting
      items — never a parallel table
- [ ] Comments: polymorphic (`entity_type`, `entity_id`), may attach a file or a live register
      link; a task can be raised from any comment carrying its origin
- [ ] Evidence: one polymorphic table (named file or live register link), `reviewed_by`,
      `reviewed_at`, revision at review; derived state awaiting/reviewed/revised-since-review — a
      later revision reopens review with no write
- [ ] Meetings: agenda items can become tasks; distribution list follows the transmittal rule
- [ ] Tests: a comment's drawing link shows current revision; revising an evidence drawing flips
      its state with no write; an RFI and a task are rows in the same table

## Phase 7 — Change log, exports, the shell

*Reference: handover §5 (change log trigger), §8 (theming). Open prototype Settings.*

- [ ] Postgres trigger writes every insert/update to a change log (entity, id, field, from, to,
      who, when)
- [ ] Exports page: CSV per module + full-project JSON, honouring visibility
- [ ] Shell: lifecycle nav (My work pinned; Pre-construction, Set up, Design, Compliance,
      Commercial, Handover; Admin last), collapsible groups, brand-colour sidebar with hi-vis
      active item
- [ ] Tenant theming from host record: name, logo, one brand colour with derived contrast text,
      light/dark — semantic colours (gap, ok, warn, stop) are fixed, not customisable
- [ ] Panel kinds (evidence, discussion, commercial, compliance) each with a tinted header;
      discussion threads chat-shaped
- [ ] Module entitlements read from host record; a page whose module is off says so, doesn't render
- [ ] Tests: brand colour reaches the stylesheet with auto contrast text; no setting exists for
      semantic colours; switching a module off removes its nav entry and its page refuses

## Phase 8 — Consultant front and the project dashboard

*Reference: handover dashboard and consultant-front sections. Open prototype as consultant, then admin.*

- [ ] Consultant lands on their own front: due from us, asked of us, our instalments, what we lead
      on the matrix, our tracked programme lines, missing appointment documents, decisions waiting
      on us — nothing that isn't theirs
- [ ] Host dashboard: decision queue for signed-in person (change requests to decide, changes to
      classify, RFIs to answer, instalments to agree, invoices to certify); "gone quiet" (open +
      untouched 3 weeks, from comments/change log); consultant health (one row per company, worst
      first, sort order not grade); programme timeline strip; HRB stop-works count
- [ ] Tests: a consultant's front lists only their company's documents; decision queue differs per
      account; the client is never asked to agree instalments

## Phase 9 — Compliance tier: one tracked-item engine

*Reference: handover §1a "one tracked-item engine" + planning, BC, scope, checklists sections. Open prototype at each.*

- [ ] One `tracked_items` table with `kind` column — planning conditions, BC items, scope lines,
      six checklists are the same record; kind-specific fields in a small `ext` JSON
- [ ] Templates as host assets forked from a published default (**five** checklist templates —
      pre-construction pre-assessment, client requirements, handover, highways, utilities, one
      table not five — plus scope templates and planning/BC import templates); a project loads a
      copy, editing a template never rewrites a live project
- [ ] Pre-assignment from template's discipline only where exactly one company holds it; otherwise
      blank
- [ ] Template rows struck out (`required = false`, drops from every denominator, stays visible),
      never deleted; project-added (`custom = true`) rows may be deleted
- [ ] `response` field holds the actual answer, not just a status — this is the field a future AI
      would populate for the pre-assessment; if that's built, keep provenance visible (a
      machine-suggested answer must be distinguishable from a person's)
- [ ] Utilities rows carry their own sequence columns (supplier, quote reference/value, enquiry/
      quote/acceptance dates) rather than a generic status — the one asymmetry in the checklist
      engine, kept because a connection's lead time only becomes visible if those dates exist
- [ ] Scope templates applied as a selection: core standard + disciplines the company holds,
      pre-checked, others addable; dedup on (company, template, reference)
- [ ] Import for planning/BC follows the same contract as every other import
- [ ] Tests: no seeded company holds a discipline template it doesn't hold the discipline for;
      editing a template leaves loaded projects untouched; a struck-out row stays in the
      denominator; re-import updates rather than duplicates

## Phase 10 — Building safety (higher-risk buildings)

*Reference: handover building-safety section. Open prototype at Building safety and a change request on the demo project.*

- [ ] Project-level HRB flag; non-HRB projects never see this
- [ ] Change request classification (recordable/notifiable/major) — only Principal Designer (BSA)
      discipline or admin may classify, enforced by policy not UI; app never suggests a category;
      store who/when/basis
- [ ] "May work proceed" as a view (never a column) covering all ten states; objection/
      determination periods are host-configurable fields, not constants
- [ ] Golden thread: designation on register rows + baseline stamped at Gateway 2; report what's
      moved since and what was designated but never issued
- [ ] Mandatory occurrence reports: own table, separate from risks
- [ ] Gateway checklist as a checklist template, not a separate module
- [ ] Tests: a synthetic classification event from a non-PDB user is refused; work-status function
      returns correct state for all ten cases; objection window follows host setting

## Phase 11 — BREEAM

*Reference: handover BREEAM section. Open prototype at BREEAM.*

- [ ] Tables start empty (licensed content). Scheme = version (e.g. UKNC 2018 v7.1); project can
      hold several, switch between them
- [ ] Sections, weightings per building type, rating thresholds, issues, credits, minimum
      standards loaded via three import templates
- [ ] Section credits summed from credit rows, never typed; a stated total is a cross-check flagged
      when it disagrees
- [ ] An unverified prerequisite excludes every credit under its issue from the verified score
- [ ] Minimum standards structured (credits required per rating) so the report can name which issue
      caps a rating and by how much; show score-only and post-minimum-standards ratings side by
      side
- [ ] Tests: port `breeam.js` hand-worked arithmetic — target 100%, blocked issue, released
      prerequisite, the capping case, building-type switching

## Phase 12 — Commercial tier

*Reference: handover fees, pre-construction, risk, change requests, warranties, materials sections. Open prototype at each.*

- [ ] Fees and cashflow: fees + variations per company; negotiated payment schedule
      (proposed/agreed, who/when), instalments programme-anchored; invoices mapped to instalments;
      cashflow curve derived; evidence + discussion on every fee/instalment/invoice
- [ ] Pre-construction budget: host-only (including from the quoting consultant); budget lines by
      discipline/survey; quotes with named adjustments; preferred quote; one outward link (fee
      names its source budget lines)
- [ ] Risk and opportunity: owned by a person (the one deliberate discipline exception); visibility
      closed by default (raiser, owner, named people, admin override); impact band derived from
      cost; expected value (never gross total) in summaries; realised risk becomes a task; template
      library loads with no owner/date
- [ ] Change requests: party-to-party, any direction; hold no money (link to a variation instead);
      approval ≠ implementation — approved request lists amendments, stays open until each ticked
      off by name; approved-with-nothing-listed is flagged
- [ ] Warranties: linked to DRM reference, never a company; owner resolved live through DRM lead —
      no `company_id` column
- [ ] Material samples: every submission round is a row; a rejection stays on record after a later
      approval; decisions restricted to design manager
- [ ] Tests: port `changereq.js`, `newmodules.js`, and the risk sections of `bsa.js`

## Phase 13 — Reports

*Reference: handover reports section. Open prototype at Reports as each role.*

- [ ] Three audiences, one engine, three pages, nothing stored
- [ ] Internal: full picture, admin/internal only
- [ ] Client: no fees, no risk register, no consultant health, no BSA classification, no occurrence
      content; footer states what's withheld
- [ ] Consultant: scoped to own company, locked when generating
- [ ] Page two reframes "waiting on me" as "waiting on this audience"; page one itemises every
      tracked-item type
- [ ] Print to PDF via browser
- [ ] Tests: port `reports.js`, especially the negative assertions

## Phase 14 — Portfolio dashboards and snapshots

*Reference: brief §6 (portfolio dashboards).*

- [ ] Nightly job writes one row per project to `snapshots` — the only stored derived values, and
      only for trends
- [ ] Host home: every live project as a row, worst first, each a link — stage, programme position,
      overdue documents, DRM gaps, decisions waiting, HRB stop-works count, client requirements
      confirmed
- [ ] Consultant health summed across every project that company is appointed on
- [ ] Decision queue across every project the signed-in person is on
- [ ] Trend charts from snapshots only (register burn-up, expected risk value over time)
- [ ] Tests: no live figure is ever read from a snapshot; a project on the host home is one the
      signed-in person is a member of

## Phase 15 — Marketing site and sign-up

*Reference: `docs/landing-page-reference.html`, brief §5.*

- [ ] Public site, separate from the application, same design tokens: home, product, pricing,
      about, contact, sign up
- [ ] Sign-up creates a pending host for platform-owner approval (phase 1)
- [ ] Company name is a placeholder ("Spine") to be replaced

## Phase 16 — Email and notifications

- [ ] Invitations (phase 1)
- [ ] Assignment and overdue notifications
- [ ] Monday digest per person ("My week" as an email)
- [ ] All templates honour visibility — nothing in an email the recipient couldn't see in the app

## Phase 17 — Energy modelling (later, not now)

- [ ] Not in scope yet. Do not build placeholder screens. See `[[u-value-calculator-tool]]` /
      the U-value calculator project for the standalone tool this will eventually bolt on.
