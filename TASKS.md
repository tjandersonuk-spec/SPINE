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

- [x] `profiles` (people) — one row per human, one login, created on sign-up
- [x] Email confirmation required; an unconfirmed login reaches the confirmation screen and
      nothing else. Enforced in `RequireAuth`, not left to the project's Auth settings — a
      dashboard toggle is invisible from the code, and this gate covers every route.
- [x] Sign-up creates **no** organisation, **no** membership and **no** request — a login on its
      own grants nothing
- [x] A confirmed login with zero memberships can sign in and lands on the personal landing page;
      every data query returns empty rather than erroring

### Accounts and requests

- [x] `organisations` (accounts) with `status` pending/active/suspended/archived and the
      lifecycle columns (approved/suspended/archived by and at, suspend reason)
- [x] `account_requests` — raised from the landing page by any confirmed login; visible to its
      requester and the platform owner only; status pending/approved/rejected/withdrawn with a
      review note the requester can read
- [x] `approve_account_request()` as one transaction taking the **reviewed** values, so a name or
      tier can be corrected before the account exists; creates the account active and exactly one
      `admin` membership for the requester
- [x] Lock (`suspended`) and archive (`archived`) as distinct, reversible, platform-owner-only
      operations — suspended is expected back and blocks sign-in; archived is finished and stays
      readable by its members
- [x] Delete only from `archived`, name typed to confirm, `platform_audit` row written **before**
      the cascade so the trail survives its subject
- [x] Suspension enforced in every policy via `account_is_live()`, not only at sign-in — a live
      session must stop working immediately

### Memberships

- [x] `organisation_members` (person × account × role × company); roles admin, internal,
      consultant, client
- [x] `project_members` (person × project × project role: project_admin | member) — distinct from
      `project_people`, which is the directory snapshot and may have no login
- [x] Account `admin` and `internal` see every project in their account with no `project_members`
      row; consultants and clients see only their rows

### Invitations — one table, two scopes

- [x] `invitations` with `scope` organisation | project, token, 14-day expiry, accepted-at,
      revoked-at, and the shape constraints per scope — membership created only on accept
- [x] Organisation scope: account `admin` only; brings a person into the account; may name
      initial `project_ids`
- [x] Project scope: account `admin` or that project's `project_admin`; **the invitee must
      already hold membership of the account that owns the project** — checked at issue *and*
      re-checked at accept, because membership can be revoked while a token is live
- [x] Never match on email: typing an address grants nothing
- [x] Pending invitations appear on the landing page with Accept and Decline, so an invitation
      does not depend on an email arriving; declining is recorded and cannot later be accepted
- [x] Bottom-up `membership_requests`: anyone on a project may propose someone with a full
      account role; it lands in the admins' landing area and only their approval issues the
      invitation, with the role editable at that point
- [x] Editing: a person edits their own name and phone, and changes their address through Auth
      (never by writing profiles.email); an account admin edits the account name and brand and
      their projects' name and code; the platform owner edits accounts but cannot read projects

### Project creation and project-level administration

- [x] **Only an account `admin` may create a project** — enforced by the insert policy on
      `projects`, not by hiding a button; an `internal`, a `project_admin` and a consultant are
      all refused at the database
- [x] A `project_admin` may add and remove people on their own project, drawn only from that
      account's members; removal leaves the account membership and other projects intact
- [x] A `project_admin` cannot widen the account — bringing a new firm or person into the
      tenancy stays an account admin's decision

### The platform owner

- [x] `platform_owners` table and `is_platform_owner()`; every select policy on account-scoped
      tables gains `or is_platform_owner()`
- [x] Accounts view: list every account, review/amend/approve/reject requests, lock, archive,
      delete, set modules and tier
- [x] **People view: every login on the platform**, including logins with zero memberships, with
      email, confirmation state, sign-up date, last seen, and the accounts they belong to — these
      people appear in no other list in the product
- [x] `platform_audit`, separate from the per-account change log, with no update or delete policy
      for anyone including platform owners
- [x] No account admin can see this layer or that it exists

### The landing page

- [x] Personal landing page for every signed-in person, whatever their memberships
- [x] **My accounts** tab — always present, even at one row; carries account settings, the member
      directory, and "Request an account" plus request status when empty
- [x] **Projects** tab — every project this person can reach across every account, each labelled
      with its account, each a link into the project UI; `my_projects()`
- [x] Account isolation: the labelling is derived from the viewer's own memberships and never
      names an account they are not in

### Entitlements and billing seam

- [x] `module_on(project_id, key)`; `projects.modules_override` merged over the account's map
- [x] Billing not built. Leave `subscription_tier` and `modules` as the fields it will price
      against; no money on `organisations` itself

### Tests

- [x] Port the full assertion list at the end of handover §1b — in particular: a new sign-up sees
      empty tabs and no errors; approving a request creates exactly one admin membership; a
      suspended account stops a live session; an account cannot be deleted unless archived; a
      non-admin's direct `insert` into `projects` is refused; a project invite to a non-member is
      refused at issue; an invite whose target lost membership is refused at accept; a host admin
      cannot list other accounts and the platform owner can list every login

### Remaining in this phase

- [ ] Email confirmation switched on in the Supabase project's Auth settings. Not code, and the
      only item here nobody but the account holder can do. The app no longer depends on it —
      `RequireAuth` refuses an unconfirmed session either way — but leaving it off means
      Supabase issues a session to an unverified address in the first place.
- [x] Platform-owner console: accounts view (review, amend, approve, reject, lock, archive,
      delete, set modules and tier) and the people view listing every login
- [x] Account-admin screens: member directory, issue and revoke invitations, create a project
- [x] Project-admin screens: add and remove people on a project
- [ ] Playwright click-through tests. Blocked on a reachable Supabase: the app talks to GoTrue
      and PostgREST, which the local PostgreSQL harness does not provide, so these need the
      hosted project (or Docker, for `supabase start`)
- [x] Column-level grants, so a policy that permits a row edit cannot permit an entitlement or
      email change with it

## Phase 2 — Projects, directory, disciplines, master catalogue

*Reference: handover §3. Open `docs/dmp-prototype.html` at Directory and Master catalogue.*

- [x] Projects, scoped to `organisation_id` — creation restricted to account `admin` by the
      insert policy built in phase 1
- [x] Master catalogue of companies/people per host; a project takes a **copy** on selection,
      independent from then on; catalogue edits never rewrite a live project; a project can push a
      correction back
- [x] `company_disciplines` table and `companies_for_discipline(project, code)` function
- [x] Appointment documents per company (competency statement, CVs, appointment, scope of work)
      with approved flags; status derived
- [x] People carry role, email, phone, primary-contact flag; name is a link to their card
- [x] Tests: a discipline held by two companies returns both; held by none returns none and shows
      as a DRM gap; catalogue edits don't change project copies

### Remaining in this phase

- [x] Appointment document upload. The `project-files` bucket is private and path-scoped
      (`project/company/slot/filename`), so a consultant reads and writes only their own company
      tree and cannot see a rival's fee scope on the same project. Links are signed and expire;
      a replacement supersedes rather than overwrites, so there is no update policy at all.
- [x] Editing a forked discipline list from the UI, including pulling in disciplines the
      published set has gained since the fork was taken
- [ ] Playwright click-through, still blocked on a reachable GoTrue and PostgREST

## Phase 3 — Responsibility matrix (DRM)

*Reference: handover DRM section + standard library JSON. Open prototype at Responsibility matrix.*

- [x] Host-level standard library (reference, category, item, default lead discipline, CDP flag,
      note); project loads a versioned snapshot
- [x] Project item: lead discipline, coordination/input roles, applicable flag, note
- [x] Gap = applicable item with no lead, or a lead discipline no company on the project holds —
      hi-vis yellow, the only use of that colour in the app
- [x] `lead_companies()` live lookup
- [x] Tests: reassigning a lead updates `lead_companies()` immediately; an item whose lead
      discipline nobody holds is a gap; dashboard gap count equals matrix gap count

### Remaining in this phase

- [x] `drm_roles` — the supporting, reviewing, contributing, approving and informed disciplines
      beside the lead, edited from the item panel. A discipline holds one role on an item or
      none: it cannot both review and approve, which is the distinction the codes exist for.
- [x] Editing the forked DRM library from the UI, and bespoke project items
- [x] `transfers_at_stage`, `cdp_package` and `level_of_information` shown and editable

## Phase 4 — Programme and the date spine ✅

*Reference: handover programme section + import template. Open prototype at Programme.*

- [x] CSV import (uid, description, type, start, finish, percent complete); header validation,
      preview, rejected rows returned as CSV
- [x] Re-import updates by uid, marks missing lines as removed (never deletes), reports what moved
- [x] One `due_date(uid, offset, anchor, override)` function, used everywhere a date appears
- [x] Line inspector listing everything dated from it
- [x] Tracking: a person can track a line and is notified when it moves
- [x] Tests: slipping a finish date moves every anchored due date with no write to those records; a
      removed line flags its dependents rather than orphaning them; inspector count equals sum of
      dependents across all modules

`due_date()` takes the **project** as well as the uid. `task_uid` is unique per project only, so
the signature in the handover notes would resolve against whichever project happened to share the
planner's numbering — the same fault `drm_leads` had before it was scoped.

Import is a `security definer` function rather than an Edge Function: equally server-side, atomic
by construction, and unbypassable because no role holds insert or update on `programme_tasks`.

### Remaining in this phase

- **Notification when a tracked line moves.** Tracking works and the import knows exactly what
  moved; the email itself waits on Phase 16, which is where transactional email is built. Until
  then a tracked line is visible on the programme page but nothing is sent.
- **Gantt** — built as plain SVG rather than from a library, because every commercial Gantt
  brings its own date engine and that would be a second opinion about dates in a product whose
  whole point is that there is only one. Summary bars show the rolled-up span, so a summary
  cannot disagree with what sits under it.
- `programme_dependents()` now reaches `drawing_register`, added by Phase 5 in the same migration
  that gave drawings their anchor columns. The Phase 4 test fails the build if a table gains
  `programme_task_uid` and `offset_days` without a matching branch — and equally if a table that
  only *links* to a line, like `drawing_pack_programme`, ever appears in it.

## Phase 5 — Drawing register, packs, transmittals ✅

*Reference: handover register, packs, transmittals sections. Open prototype at Documents and Transmittals.*

- [x] Planned and delivered drawings are the same row; naming follows BEP convention with
      originator code per company; construction status, due, overdue, register sync all derived
- [x] Packs: named reusable groups, references not copies; may link to a programme line as a
      resource only — enforce in review that no date query joins pack-to-programme
- [x] Transmittals: reason, method, recipients, distribution list; selecting a pack expands to
      drawings at current revision (never stores the pack)
- [x] Tests: a pack reflects a retitled drawing; linking a pack to a line changes no due date;
      revising a drawing after a transmittal shows "revised since issue" on the pack

The BEP has no phase of its own in this list but the register depends on it — construction status
comes from `bep_revision_rules`, naming compliance from `bep_fields`, and the originator code from
the directory — so it is built here.

The pack-to-programme rule is no longer only "enforce in review": `drawing_pack_programme` carries
`programme_task_uid` **without** the anchor columns, and `phase4.test.ts` fails the build if a
table shaped like that ever appears in `programme_dependents()`. A pack cannot start influencing a
date without the suite saying so.

`revised_since_issue` is computed per drawing against that drawing's most recent transmittal, not
against the last issue of the whole pack. A pack usually contains something not yet delivered, so
it may never have gone out as a complete set, and a figure that only appeared in that case would
never appear at all.

### Remaining in this phase

- **Transmittal recipients** — picked from the project directory, grouped by firm, each marked
  for action or information. A recipient is always a named person: `person_id` sits in the
  primary key, so Postgres makes it NOT NULL whatever the column says, and that is right — a
  drawing is distributed to someone, not to a firm in the abstract.
- **BEP editor** — fields, their permitted codes, revision rules and suitability codes. The
  Originator field has no editor and never will: its codes are the project's companies read
  live, and a second list would let the BEP and the directory disagree.
- **Drawing anchor editing** — a form with no date field in it. A drawing is due so many days
  either side of a programme line; the override is there for the case the spine cannot express
  and says plainly that it stops following the programme.
- **CDE URL** — editable on any register row, and the number becomes a link once it is set.

Nothing outstanding in this phase.

## Phase 6 — Tasks, RFIs, meetings, comments, evidence ✅

*Reference: handover issues, meetings, comments, evidence sections.*

- [x] One issues store, `source_kind` distinguishes tasks/RFIs/comment-raised actions/meeting
      items — never a parallel table
- [x] Comments: polymorphic (`entity_type`, `entity_id`), may attach a file or a live register
      link; a task can be raised from any comment carrying its origin
- [x] Evidence: one polymorphic table (named file or live register link), `reviewed_by`,
      `reviewed_at`, revision at review; derived state awaiting/reviewed/revised-since-review — a
      later revision reopens review with no write
- [x] Meetings: agenda items can become tasks; attendance is the distribution list
- [x] Tests: a comment's drawing link shows current revision; revising an evidence drawing flips
      its state with no write; an RFI and a task are rows in the same table

**One `visibility` primitive, not a table per module.** The handover notes give `issue_distribution`
its own table, with more to follow for risks and change requests. Four tables meaning almost the
same thing is four chances for "who can see this" to differ subtly, and the difference only ever
surfaces as a leak — so §1a's decision wins: one jsonb column, one `can_see()`, four modes. The
raiser and the owner are never locked out of their own item, and a mode nothing understands is
refused at write time rather than falling through to "everyone".

**Both revisions are stamped by trigger, never passed in.** The reviewer states that they reviewed
it; which revision that was is a fact about the register, not their opinion. `reviewed_by`,
`reviewed_at` and `revision_at_review` are outside the update grant entirely, so nobody can mark
their own submission reviewed by writing the column.

**A reference sequence is keyed on the prefix, not the kind.** Three kinds share `TSK` — typed,
comment-raised and meeting-raised — so keying the sequence on the kind gives each its own counter
and they collide at `TSK-001`. Caught by the tests rather than by a user.

### Remaining in this phase

- **Evidence has a schema, a derived state and an API, but only one place to reach it.** It hangs
  off any entity; the panels that show it are added as each module that needs it is built —
  planning conditions and building control in Phase 10, fees in Phase 12.
- **Comment attachments upload only register links, not files.** The bucket and the policies are
  there and `comment_attachments.storage_path` is ready; the file picker is not, because the same
  control belongs beside evidence and is worth building once.
- **Distribution on an issue is set when it is raised, not edited afterwards.** `visibility` is in
  the update grant so the owner may change it; there is no screen for it yet.

## Phase 7 — Change log, exports, the shell ✅

*Reference: handover §5 (change log trigger), §8 (theming). Open prototype Settings.*

- [x] Postgres trigger writes every insert/update to a change log (entity, id, field, from, to,
      who, when)
- [x] Exports page: CSV per module + full-project JSON, honouring visibility
- [x] Shell: lifecycle nav (My work pinned; Pre-construction, Set up, Design, Compliance,
      Commercial, Handover; Admin last), collapsible groups, brand-colour sidebar with hi-vis
      active item — built earlier, before Phase 4
- [x] Tenant theming from host record: name, logo, one brand colour with derived contrast text,
      light/dark — semantic colours (gap, ok, warn, stop) are fixed, not customisable
- [x] Panel kinds (evidence, discussion, commercial, compliance) each with a tinted header
- [x] Module entitlements read from host record; a page whose module is off says so, doesn't render
- [x] Tests: brand colour reaches the stylesheet with auto contrast text; no setting exists for
      semantic colours; switching a module off removes its nav entry and its page refuses

**The trigger, not the code.** Application-side logging records what the developer remembered to
log. A trigger records what actually happened, including the edit somebody made straight through
PostgREST — and a test asserts exactly that case. One row per field that genuinely moved, so a
write changing nothing logs nothing and the trail stays readable. No role holds insert, update or
delete on `change_log`: it cannot be edited afterwards by anybody, which is the only thing that
makes it worth keeping.

**The derived ink uses pure black, not the structural ink, and the difference is load-bearing.**
Solving for the brand equidistant from white and black puts the worst case at 4.58 — past AA.
Using `#14181B` as the dark option drops it enough that a band of mid-luminance colours clears
neither: `#C25E00` gives 4.29 against white and 4.16 against the near-black. The test sweeps the
whole colour space rather than a hand-picked list, because no list I would have written contained
the orange that failed.

**My work and Admin are `core`, not modules.** A project with no settings page and no change log
is not a cheaper product, it is a broken one. `src/theme.test.ts` asserts both directions: every
gated nav key exists in `module_keys()` — an unknown key can never be switched on by anyone and
would simply never appear — and no core key is a module.

**A module that is off is absent, not dimmed.** Showing a locked door tells a consultant what
their client has and has not paid for, which is not theirs to know.

### Remaining in this phase

- **Logo upload.** `organisations.logo_path` is read by the shell and the sign-in page; the
  upload control is not built, so a logo is set by putting a file in the bucket. The same file
  picker is wanted for evidence and comment attachments and is worth building once.
- **Account-level module editing.** `set_modules()` exists and is tested; the screen edits the
  project override only. An account admin wanting to change the default for every project does it
  in SQL for now.
- **PDF export.** The exports page does CSV and JSON. jsPDF with a populated title block belongs
  with Phase 13's reports, which is where the layout is decided.

## Phase 8 — Consultant front and the project dashboard ✅

*Reference: handover dashboard and consultant-front sections. Open prototype as consultant, then admin.*

- [x] Consultant lands on their own front: due from us, asked of us, what we lead on the matrix,
      our tracked programme lines, missing appointment documents, decisions waiting on us —
      nothing that isn't theirs
- [x] Host dashboard: decision queue for the signed-in person; "gone quiet" (open + untouched
      three weeks, from comments and the change log); consultant health (one row per company,
      worst first, sort order not grade); programme timeline strip
- [x] Tests: a consultant's front lists only their company's documents; the decision queue
      differs per person; consultant health never leaves the contractor's own staff

**No new tables.** Everything is a question asked of records that already exist, which is why a
consultant's front cannot drift out of step with the pages: it is the same rows, filtered by the
same policies.

**`my_company_tree()` recurses.** A consultant who appointed a specialist under them is
answerable for that specialist's work, so their front shows it — a two-level appointment is
normal and three is not unheard of.

**One timeline function, called twice.** `programme_timeline()` is the dashboard's now and Phase
13's period report later. The notes are explicit that there should not be two, because two would
eventually draw different pictures of the same project.

**Consultant health is a sort order, not a grade.** A letter or a percentage invites an argument
about the mark rather than about the facts under it, and the facts are what someone can act on.
Open items are deliberately not in the score: a busy consultant is not a worrying one, a late or
a silent one is.

**Gone quiet is about silence, not age.** "Touched" means a comment or a change-log entry, so an
item being old is not the finding — an item nobody has said anything about is. A comment makes it
loud again with no write to the issue.

### Remaining in this phase

- **Instalments and invoices** are named in the original line for both pages and belong to Phase
  12, which builds the commercial tier. The consultant front has the panel shape ready for them.
  The assertion "the client is never asked to agree instalments" is Phase 12's to prove, since
  there is nothing to agree yet.
- **HRB stop-works count** waits on Phase 10, which builds the Building Safety Act module.
- **The decision queue covers RFIs, assigned tasks and unreviewed evidence.** Change requests to
  decide, changes to classify, instalments to agree and invoices to certify join it as Phases 10
  and 12 create them; the function is a union and each is one more branch.

## Phase 9 — Compliance tier: one tracked-item engine ✅

*Reference: handover §1a "one tracked-item engine" + planning, BC, scope, checklists sections. Open prototype at each.*

- [x] One `tracked_items` table with `kind` column — planning conditions, BC items, scope lines,
      six checklists are the same record; kind-specific fields in a small `ext` JSON
- [x] Templates as host assets forked from a published default (five checklist templates in one
      table, plus scope templates); a project loads a copy, editing a template never rewrites a
      live project
- [x] Pre-assignment from template's discipline only where exactly one company holds it; otherwise
      blank
- [x] Template rows struck out (`required = false`, drops from every denominator, stays visible),
      never deleted; project-added (`custom = true`) rows may be deleted
- [x] `response` field holds the actual answer, not just a status, with provenance — a
      machine-suggested answer is visibly distinguishable from a person's and must be accepted
      before it counts as one
- [x] Utilities rows carry their own sequence columns (supplier, quote reference/value, enquiry/
      quote/acceptance dates), held in `ext` and validated so it cannot become a junk drawer
- [x] Scope templates applied as a selection: core standard + disciplines the company holds,
      pre-checked; dedup on (company, template, reference)
- [x] Tests: no seeded company holds a discipline template it doesn't hold the discipline for;
      editing a template leaves loaded projects untouched; a struck-out row leaves the
      denominator and stays on the page

**One line in the old checklist contradicted itself and is corrected above.** It read "a
struck-out row stays in the denominator", while the bullet directly above it — and the handover
notes, twice — say `required = false` *drops* the row from every denominator. What a struck-out
row keeps is its **visibility**, not its place in the total. `supabase/tests/phase9.test.ts`
asserts both halves so the distinction cannot be lost again.

**`ext` is typed by constraint, not by convention.** A check constraint names the permitted keys
for `checklist:utilities` and for `breeam`, so the escape hatch cannot quietly become a junk
drawer. §1a's rule stands: if a kind's `ext` grows past six or seven keys it has earned a side
table.

**The scope bug that shipped once cannot recur.** Templates are named rows, not one flat list, and
`suggested_scope_templates()` returns the core standard plus only the disciplines a company
actually holds — tested from both sides, so a mechanical engineer can never be offered
architectural production-information duties.

**Pre-assignment refuses to guess.** One holder means assigned; two means blank. A wrong default
gets accepted silently where a blank gets asked about.

### Remaining in this phase

- **Import for planning and building control.** The engine, the RLS and the page are built and
  items can be added by hand; the CSV importer with column mapping follows the same contract as
  the programme and CDE imports and is the next thing to add. The "re-import updates rather than
  duplicates" assertion belongs with it — the unique key `(project_id, kind, reference)` is
  already the thing that will make it true.
- **BREEAM** shares this table and its `ext` shape is already declared and validated, but the
  scheme tables, weightings and the scoring arithmetic are Phase 11.
- **A scope-template apply screen.** `suggested_scope_templates()` and `apply_scope_templates()`
  are built and tested; the picker that pre-checks the suggestions sits with the appointment UI.

## Phase 10 — Building safety (higher-risk buildings) ✅

*Reference: handover building-safety section. Open prototype at Building safety and a change request on the demo project.*

- [x] Project-level HRB flag; non-HRB projects never see this
- [x] Change request classification (recordable/notifiable/major) — only Principal Designer (BSA)
      discipline or admin may classify, enforced by policy not UI; app never suggests a category;
      store who/when/basis
- [x] "May work proceed" as a view (never a column) covering every state; objection/determination
      periods are host-configurable fields, not constants
- [x] Golden thread: designation on register rows + baseline stamped at Gateway 2; report what's
      moved since and what was designated but never issued
- [x] Mandatory occurrence reports: own table, separate from risks
- [x] Tests: a synthetic classification event from a non-PDB user is refused; work-status returns
      the correct state for every case; the objection window follows the host setting

**`change_requests` arrives here rather than in Phase 12.** The classification hangs off it and
cannot be built without it, so the table lands in the shape the notes give it, minus the money —
`variation_id` references `fees`, which is Phase 12's to create.

**The classification columns are outside the update grant entirely.** `classify_change()` is the
only way to set them and it checks `can_classify()` server-side, so a synthetic event from
someone senior who does not hold the duty is refused by the database rather than by a hidden
button. The test drives the function directly for exactly that reason. **Internal staff
deliberately cannot classify** — it is a named statutory duty, not a seniority.

**Twelve states, every one tested, and a test that fails if a thirteenth appears untested.** The
notes name six; enumerating honestly produced twelve, including "marked decided with no outcome
recorded", which nobody designed and which stops rather than guessing which way it went.

**The periods are settings.** The notifiable objection window is quoted as both ten working days
and fourteen across published sources, and a major determination as four to six weeks. A test
widens the window and watches the same change move from *clear* back to *in the window*.

**The Phase 4 anchor guard was extended, and it needed to be.** `change_requests` carries two
anchor pairs named `decision_*` and `effective_*`; the guard only knew `programme_task_uid` and
would have let both through. It now matches any `<x>_task_uid` with an offset beside it, checks
every anchored **column** rather than every table, and was verified by deleting one branch and
watching it name the missing column.

### Remaining in this phase

- **The gateway checklist** is a checklist template, which is Phase 9's engine — it needs the
  template rows written, not code. Add them to `checklist_templates` with `type = 'handover'` or
  a new type when the gateway content is agreed with whoever holds the duty.
- **Raising and editing change requests** has schema, RLS and the derived view, but the create
  and edit screens belong with Phase 12, where the commercial half (variations, amendments
  ticked off by name) is built. The building-safety page reads them today.
- **Occurrence entry** is read-only on the page; the form is small and follows.

**A caveat carried from the notes into the build.** The categories, the periods and the reporting
threshold are regulatory matters that move. Everything here should be reviewed by whoever holds
the PDB duty before it is used on a live scheme, and the periods must stay editable rather than
becoming constants in a later refactor.

## Phase 11 — BREEAM ✅

*Reference: handover BREEAM section. Open prototype at BREEAM.*

- [x] Tables start empty (licensed content). Scheme = version (e.g. UKNC 2018 v7.1); project can
      hold several, switch between them
- [x] Sections, weightings per building type, rating thresholds, issues, credits, minimum
      standards loaded via three import templates
- [x] Section credits summed from credit rows, never typed; a stated total is a cross-check flagged
      when it disagrees
- [x] An unverified prerequisite excludes every credit under its issue from the verified score
- [x] Minimum standards structured (credits required per rating) so the report can name which issue
      caps a rating and by how much; show score-only and post-minimum-standards ratings side by
      side
- [x] Tests: port `breeam.js` hand-worked arithmetic — target 100%, blocked issue, released
      prerequisite, the capping case, building-type switching

**A credit is a tracked item.** §1a folds `breeam_credits` into `tracked_items`, so this phase adds
no credits table: it adds `breeam_issue_id` — a real foreign key, not an `ext` string, because a
reference to another record must cascade and must be joinable — constrained to be present exactly
when `kind = 'breeam'`, and a partial unique on `(issue, title)` so a re-import updates the credit
that is there rather than adding a second beside it. The reference is `<issue code>.<ordinal>`
counted across the **project**, because a project holds several schemes and two may both carry
`Man 01`.

**`ext` is typed by value now, not only by key.** Phase 9 named the permitted keys; Phase 11 is
what reads the numbers, so the validator also refuses a string where a number belongs and refuses
targeted or achieved above available. The constraint was dropped and re-added rather than
validated, because Postgres treats VALIDATE on an already-valid check as a no-op and replacing the
function body re-checks nothing.

**`ext` left the `tracked_items` update grant.** The credit numbers are the score, and
`set_breeam_credit()` is the only way they move — it refuses more than the credit offers and refuses
a prerequisite outright. This also closes the utilities dates to a direct PATCH; when the utilities
UI arrives it needs a `set_utilities_dates()` definer, not a re-grant.

**The scoring basis is outside the update grant too.** `sections`, `weightings`, `ratings` and
`min_standards` are loaded by `breeam_import_apply()` and never by a PATCH that happens to carry a
weightings object: a member who could rewrite the weightings could change every figure in the
report without a single credit moving.

**Derived from end to end.** `v_breeam_credits` → `v_breeam_issues` (a prerequisite that is not
Verified zeroes the issue and names itself in `blocked_by`) → `v_breeam_sections` (available
summed from the rows; `stated_gap` non-zero exactly when the tracker disagrees with itself) →
`breeam_totals()` (both ratings, and whether each is capped). The tracker's state ladder is one
function, `breeam_credit_state()`, exposed on the view so the page reads it rather than
reimplementing it.

**A divergence from the prototype, deliberate.** The prototype failed a zero-credit minimum
standard unconditionally — it tested a `met` flag nothing ever set — which made the achieved rating
permanently unreachable on any scheme carrying one. Here a zero-credit standard is a criterion: it
fails only when a prerequisite under that issue is outstanding, and is otherwise listed by
`breeam_advisory_standards()` and does not cap. A cap the software cannot justify is worse than no
cap.

**The import trap from the notes is enforced.** A weighting file carries one row per section per
building type, so a section repeats; a later row that leaves name or stated total blank does not
erase what an earlier row supplied. Also: `jsonb_set` will not create an intermediate object, so
the building type's own key is created before a section weighting is set inside it — without that
every weighting silently failed to load.

**The first building type loaded becomes the active one.** A scheme with a null type weights every
section zero and reports the whole framework as scoring nothing, which reads as a broken import
rather than a missing choice.

### Remaining in this phase

- **Evidence and comments on a credit** attach through the Phase 6 polymorphic tables already —
  the tracker does not yet show or add them. Same gap as `TrackedList`; fix both together.
- **Rating thresholds are import-only.** The sections template carries weightings but not the
  rating minimums; the prototype has an add-a-threshold control on Scheme setup. Small, follows.
- **Playwright**: the tab no-op, the empty-input refusals and the consultant's read-only view are
  asserted at the database and unit level; the click-through waits on the shared harness.

## Phase 12 — Commercial tier ✅

*Reference: handover fees, pre-construction, risk, change requests, warranties, materials sections. Open prototype at each.*

- [x] Fees and cashflow: fees + variations per company; negotiated payment schedule
      (proposed/agreed, who/when), instalments programme-anchored; invoices mapped to instalments;
      cashflow curve derived; evidence + discussion on every fee/instalment/invoice
- [x] Pre-construction budget: host-only (including from the quoting consultant); budget lines by
      discipline/survey; quotes with named adjustments; preferred quote; one outward link (fee
      names its source budget lines)
- [x] Risk and opportunity: owned by a person (the one deliberate discipline exception); visibility
      closed by default (raiser, owner, named people, admin override); impact band derived from
      cost; expected value (never gross total) in summaries; realised risk becomes a task; template
      library loads with no owner/date
- [x] Change requests: party-to-party, any direction; hold no money (link to a variation instead);
      approval ≠ implementation — approved request lists amendments, stays open until each ticked
      off by name; approved-with-nothing-listed is flagged
- [x] Warranties: linked to DRM reference, never a company; owner resolved live through DRM lead —
      no `company_id` column
- [x] Material samples: every submission round is a row; a rejection stays on record after a later
      approval; decisions restricted to design manager
- [x] Tests: port `changereq.js`, `newmodules.js`, and the risk sections of `bsa.js`

**A bug in the Phase 6 visibility primitive, found by the risk register's own test.** `can_see()`
returned true for all account **staff** — admin and internal together — before it looked at the
mode at all. For `internal` mode that is the mode's definition and is right; for `named` mode it
handed every internal member of the contractor every restricted record on the project. The notes
say the risk override "names `admin` only, not `internal`", and CLAUDE.md says the same. The
override is now an account admin or that project's own admin, `internal` mode keeps its own
branch, and an unknown mode is **closed** rather than falling through to everyone. Six phases of
tests passed either way, which is why it survived: nothing had asserted it. Six tests now do.

**Two deliberate exceptions to the discipline rule, and they are the only two.** A **fee** belongs
to a company, because an appointment is a contract with a firm. A **risk owner is a person**,
because a live risk is somebody personally chasing something down and a risk owned by "structures"
is a risk nobody is holding. Both are commented at the column. Everything else still assigns to a
discipline.

**Proposed and approved are never one figure.** `fee_position()` returns them in separate columns
and the only total called a total is the approved one. `schedule_gap` is the second silent check —
a schedule that does not add up to the approved fee, almost always an approved variation nobody
added to the schedule — and `due_uninvoiced` is the first.

**A proposed instalment still counts in the planned cashflow.** It is the consultant's stated
expectation, and leaving it out makes the curve optimistic; the agreed subtotal is carried
separately so the optimism is visible rather than assumed. No instalment date is stored anywhere,
so re-importing a programme revision redraws the whole curve with no writes — there is a test that
moves a programme line and reads the new date back.

**Nothing about risk exposure is stored.** The likelihood percentage, the impact band (derived from
the cost, never chosen), the score and the expected value are all computed; a finished item's
expected value is zero because it is no longer exposure. `risk_totals()` returns `gross` as well,
but only so a page can label it as what it is — what everything would cost if it all happened —
and never as exposure.

**A realised risk becomes one task.** `realise_risk()` writes one `issues` row with the risk's
audience copied across and a priority derived from the score, then points the risk at it. It is
idempotent, because two people pressing the button must not produce two tasks for one risk, and the
constraint refuses `status = 'Realised'` with no task behind it.

**Warranties have no `company_id` and there is a test that says so.** It reads
`information_schema` and fails if the column ever appears. Ownership resolves live through
`drm_items.lead_discipline`; reassigning the matrix reassigns every warranty under it with no write
here, and two holders of the lead discipline surface as two rather than being resolved by picking
one. Nobody holding it is the same hi-vis gap the matrix shows.

**A decided submission round is frozen by trigger and undeletable by grant.** A correction is a new
round. That is what makes "was this rejected before?" answerable after a later approval — the trail
is just what the table already is. Deciding is `can_decide_material()`, the same shape as the BSA
classification guard: refused by the database, not by a hidden button, and `internal` is not the
design manager either.

**Approval is not implementation, and there is no trigger anywhere that acts on approval.** A test
reads `pg_trigger` and fails if one appears. `set_change_status()` refuses `Implemented` while any
amendment is outstanding and refuses it outright when nothing was ever listed; un-ticking an item
knocks the status back from `Implemented` to `Approved`. A decision due after the effective date is
**reported, never blocked** — sometimes that is genuinely the situation, and refusing the save would
only mean the dates get fudged into something that reads as fine.

**`change_requests.variation_id` finally exists**, and a check constraint refuses a base fee:
pointing at one would put a whole appointment on a single change request. The register still holds
no value column and never will.

**The pre-construction budget is host staff only, and that deliberately excludes a project admin** —
who may be the very firm that quoted. It also excludes the `client` role: what the contractor
forecast for its own consultants is not the client's business.

**One export needed its own visibility question.** RLS *filters rows* rather than refusing a query,
so a consultant exporting the pre-construction budget would have got `[]` — which reads as "there
is no budget", the exact false claim CLAUDE.md forbids. `ModuleExport.visible` asks
`can_see_precon()` first and marks the section withheld instead.

**Four tables gained anchor columns, so `programme_dependents()` gained four branches** — each
filtered by its own module's audience, so a consultant clicking a programme line cannot learn that
a rival has an instalment against it. One replacement of the function rather than four; the Phase 4
guard is what actually enforces completeness.

### Remaining in this phase

- **`ext` on `tracked_items` left the update grant in Phase 11**, so when the utilities dates get a
  UI they need a `set_utilities_dates()` definer function, not a re-grant.
- **Evidence and comment threads** on fees, instalments and invoices attach through the Phase 6
  polymorphic tables and the `has_document` flag reads them, but the pages do not yet let you add
  one. Same gap as `TrackedList` and the BREEAM tracker; fix all three together.
- **The published risk and warranty libraries ship empty.** The loaders, the fork-on-creation
  pattern and the skip-on-title-match are all tested; the default rows are content, and the
  prototype's twenty-odd risks and sixteen warranties should be entered by whoever owns them.
- **`payment-schedule-template.csv`** is the third route into a schedule (type, upload, agree). Type
  and agree are built; the CSV upload reuses the Phase 11 import shape and follows.
- **Playwright** for the click-through: the tab no-op, the empty-input refusals and every
  permission boundary are asserted at the database level, but not yet through a browser.

## Phase 13 — Reports ✅

*Reference: handover reports section. Open prototype at Reports as each role.*

- [x] Three audiences, one engine, three pages, nothing stored
- [x] Internal: full picture, admin/internal only
- [x] Client: no fees, no risk register, no consultant health, no BSA classification, no occurrence
      content; footer states what's withheld
- [x] Consultant: scoped to own company, locked when generating
- [x] Page two reframes "waiting on me" as "waiting on this audience"; page one itemises every
      tracked-item type
- [x] Print to PDF via browser
- [x] Tests: port `reports.js`, especially the negative assertions

**Nothing is stored, and a test proves it.** There is no report table anywhere — the test reads
`information_schema` and fails if one appears. A report is a query over a date range plus an
audience filter, rendered on request, so there is never a stale copy to reconcile against the live
project.

**The audience decides content in one place.** Every exclusion the client report makes is made in
`report_metrics`, `report_compliance_rows`, `report_attention` and `report_activity` — not
sprinkled through a template. `ReportsPage.tsx` contains no `audience === 'client'` test except to
pick a heading: if a section is missing from a client report it is because the query returned
nothing, which is the only way the rule and what is rendered cannot drift apart.

**The lock is server-side, and the tampering test is the point.** `report_scope()` returns the
company a report is scoped to and **raises** rather than quietly substituting. A consultant asking
for a rival's report gets `42501`, not their own figures under someone else's name — which would
hide the attempt and look like it worked. A company id passed to a project-wide report is refused
rather than ignored, because a caller who thinks they are scoping something is wrong.

**Page two is a separate function from the dashboard's, deliberately.** `decision_queue()` is keyed
on `auth.uid()` and answers "what is waiting on me". `report_attention()` answers "what is waiting
on this audience" — and a test asserts its source contains no `auth.uid()` at all, plus that the
same audience report generated by two different people is byte-identical. A client's copy silently
being about whoever pressed the button is the failure this avoids.

**Three sections are gated independently of everything else.** Consultant health is internal only,
matching the live dashboard. Gone-quiet is internal (everything) and consultant (their own items,
so it reads as self-accountability rather than a callout) and **withheld from the client entirely**
— flagging a stall is a tone judgement for a person, not a fact for an automated document.
"Coming up" is identical for all three: a date is not commercially sensitive.

**Every tracked-item type gets its own row.** `report_compliance_rows()` returns one row per kind
with its own done/total/overdue, never a rollup — "which one is behind?" is the first question
anybody asks of a compliance section and a merged total cannot answer it. Client excludes the
pre-construction pre-assessment and the scope of service; consultant scopes by company and emits
**no row at all** for a type they hold nothing on, because six empty rows are noise rather than a
finding.

**One `programme_timeline()`, called from the dashboard and from here** — a test counts the
functions matching `%timeline%` and fails at two, because two would eventually draw different
pictures.

**The period is computed server-side**, both ends inclusive: a week is a rolling seven days, a
month a rolling calendar month. An unknown kind falls back to a week rather than erroring — a
report that refused to render because of a typo in a dropdown would be worse than one showing the
default period.

**PDF is `window.print()`** against the print stylesheet in `index.css`: `@page { size: A4 }`,
`.report-sheet` breaking after each page, `.noprint` on the shell and controls, and
`page-break-inside: avoid` on rows and blocks. No server-side rendering — a second templating path
would be a second place for the figures to be wrong.

### Remaining in this phase

- **The client exclusion list needs a human review before go-live.** It is a commercial and
  liability judgement rather than a permissions one, and `report_exclusions()` says so in a
  comment. Whoever owns that decision should read the list in
  `20260902230100_phase13_report_page1.sql` and sign it off; it must not drift by feature addition
  without the same review.
- **The tenant logo** is not yet drawn on the report header. `account_branding()` already carries
  it; the header block has the slot.
- **Occurrence content** is excluded from the client report by never being included — there is no
  occurrence section on any audience yet. When one is added to the internal report, the client
  gate has to be written at the same time.
- **Playwright**: the audience picker, the print action and the three-sheet layout are asserted at
  the database level only.

## Phase 14 — Portfolio dashboards and snapshots ✅

*Reference: brief §6 (portfolio dashboards).*

- [x] Nightly job writes one row per project to `snapshots` — the only stored derived values, and
      only for trends
- [x] Host home: every live project as a row, worst first, each a link — stage, programme position,
      overdue documents, DRM gaps, decisions waiting, HRB stop-works count, client requirements
      confirmed
- [x] Consultant health summed across every project that company is appointed on
- [x] Decision queue across every project the signed-in person is on
- [x] Trend charts from snapshots only (register burn-up, expected risk value over time)
- [x] Tests: no live figure is ever read from a snapshot; a project on the host home is one the
      signed-in person is a member of

**"No live figure from a snapshot" is enforced structurally.** The test scans `pg_proc` for any
function whose source names the table and asserts the list is exactly `take_snapshot`,
`project_trend` and `portfolio_trend`. A second test writes a snapshot full of obviously wrong
figures and reads the live portfolio, which disagrees with it — so the guard holds even if
somebody adds a reader the scan somehow misses. The failure it protects against is a future
function reaching for the stored number because it is faster: that would put a figure up to a day
old on a live page, and the staleness would surface only as an argument about whose screen was
right.

**Which projects appear is `my_projects()`, and the rule is not restated.** Account staff see every
project in their account; everybody else sees the ones they are a member of. Bellweather is
appointed on two projects in the test but Cara is a member of one, and she sees one — being your
firm's job is not the same as being yours.

**Nobody can write a snapshot by hand.** There is no insert, update or delete policy on the table
at all, and `take_snapshot()`/`take_daily_snapshots()` are `security definer` with execute revoked
from `authenticated`. A stored figure that could be edited is a stored figure that could be edited
into agreeing with an argument. The job runs as the service role from a scheduled Edge Function.

**A suspended account is skipped; an archived one is not.** The trend on a finished job is exactly
what somebody looks at afterwards, but a flat line through a suspension reads as a project that
stalled rather than one that was switched off.

**The job is safely re-runnable.** `take_snapshot()` upserts on `(project, date)` and the Edge
Function accepts a date, so a missed night can be backfilled. A job that cannot be retried is one
that eventually leaves a hole in a chart.

**The roll-up is the only new code.** Every figure on the portfolio page is the one a project page
already computes — the programme position comes from the single `programme_timeline()`, the gaps
from the same predicate the matrix uses, consultant health from `consultant_health()` itself (so
its internal-only rule is inherited rather than restated). `portfolio_summary()` is deliberately
live rather than read from today's snapshot row, even though the two would usually agree:
"usually" is how a dashboard starts being a day behind without anybody noticing.

**A firm on four jobs is one row, gathered by catalogue entry.** `companies` is per-project, so the
same consultant is several rows; matching on name would merge two genuinely different firms that
share one and split one that was typed twice.

**`my_decisions()` is personal, and correctly so.** It is keyed on `auth.uid()` through
`decision_queue()` — the opposite of `report_attention()`, because a dashboard is read by the
person looking at it and a report by somebody else.

**Two bugs the guards caught.** The token guard rejected `bg-ink` on the programme strip: `--ink`
is defined but never exposed as `--color-ink`, so the class would have produced no CSS and the
"today" marker would have been invisible. And running the full suite surfaced an **unscoped update
in the Phase 13 test** — `where reference = 'CHG-001'` reached into Phase 14's fixture and turned
its stop-work off, because a reference is unique per project and not globally. That is the same
mistake the product's own schema is shaped to prevent, made in a test.

### Remaining in this phase

- **The cron job is documented, not scheduled.** `supabase/README.md` carries the
  `cron.schedule(...)` call and the deploy command; somebody has to run them against the hosted
  project once, and check `snapshots` has rows the next morning.
- **Per-project trend charts** have their function (`project_trend`) and the chart component, but
  no page yet — they belong on the project dashboard beside the timeline.
- **Portfolio filtering by account** is in every function as `p_org` and is not yet a control on
  the page; it matters once somebody works across two accounts.
- **Playwright**: the worst-first ordering and the membership scoping are asserted at the database
  level only.

## Interlude — one shell, and entitlements as bolt-ons ✅

*Not a numbered phase. Done between 14 and 15 because the sign-in and request work of Phase 1
had left a second landing page outside the product, and because the upsell model needed the
entitlement lever to be the platform owner's rather than the customer's.*

- [x] One `AppShell` for every signed-in screen; the plain `Shell` is deleted
- [x] Project switcher top-left, grouped by account, with Portfolio and New project (admin
      accounts only; the insert policy is the guard, the menu is a courtesy)
- [x] Person top-right: accounts, invitations and requests awaiting consent (badged), light or
      dark, sign out; platform pages offered to an owner
- [x] `/` decides: no projects → accounts page; one → straight in; several → portfolio
- [x] `module_catalogue()` is the one registry; `module_keys()` derives from it; the nav guard
      reads it
- [x] `set_modules()` platform owner only, audited; `set_project_modules()` narrows only
- [x] Owner's module editor on the platform Accounts page (at approval and afterwards); project
      settings shows "not on this account" rather than a checkbox that always fails
- [x] Tests: `entitlements.test.ts` — admin cannot widen at either level, owner can, off ≠
      deleted, one registry, non-module keys refused everywhere

**The gap this closed.** Phase 7's `set_modules()` accepted an account admin. In an upsell model
that is the customer holding the price list. The account map is now the owner's alone, and the
project override — which could previously carry a `true` and so widen past the account — only
narrows. Both are refused by the database; `ModuleSettings` and the owner's editor merely stop
offering what would fail.

**`compliance` and `commercial` were never modules.** The approval form mapped a tier onto two
keys that were nav group titles, and `{"commercial": true}` sat in live rows for six phases
meaning nothing — the same class of bug CLAUDE.md already records from the Phase 1 test. The
validator is now shared (`assert_module_keys()`) and every writer calls it, so an account cannot
be created with an entitlement nothing reads. The approval form names modules explicitly,
defaulting to everything on.

**And the stale keys had to be cleared, not just refused.** Reported from the live owner's page:
an account said "2 switched off" with every checkbox on the editor ticked. The editor renders the
catalogue, so the legacy keys had no checkbox — but the count was reading raw `false` values from
the stored map, and those two were `false`. Worse, the editor's draft was seeded from that map, so
pressing Save sent `compliance` to `assert_module_keys()` and failed with "No module called
compliance" — a confusing error about a key the owner never chose.
`20260902250100_strip_legacy_module_keys.sql` clears any key outside `module_keys()` from
`organisations.modules` and `projects.modules_override` (nothing has ever read one, and
`module_on()` returns false for one regardless), and `modules_off_count()` counts against the
catalogue so a key that is not a module is not a module that is off. A `true` on a project
override is deliberately left alone: it may have been set by the platform owner, and silently
removing a working entitlement would be a worse surprise than the one being fixed.

**Entitlements stay packaging, deliberately.** Turning a module off hides its nav entry and its
page refuses; the data is untouched because RLS never asked. Enforcing entitlements at the row
level would break exports and reports that read across modules, and would leave gaps when a
module was bought back. If API-level refusal is ever wanted, it is a separate decision to take
knowingly, not a drift.

### Remaining

- **Tier is a label.** `subscription_tier` is recorded on the contract but nothing derives from
  it; the modules are what is sold. Billing (Phase 16 territory) will decide whether a tier
  should imply a default map.
- **The logo** is not yet drawn in the sidebar outside a project; `account_branding()` carries
  `logo_path` and the slot is there.
- **Playwright** for the switcher, the menu and the `/` decision is still outstanding.

## Interlude — luminous glass ✅

The restyle, and only the restyle: no business logic, model, schema relationship or state flow
moved. Dark obsidian is the default presentation with light as the override; every container is
the one `glass` utility; tables lose their zebra and gain a monospace eyebrow header; badges are
luminous capsules; the shell is a frosted header and sidebar with the brand as the active accent;
the report title block is an engineering HUD strip; figures are `Stat` tiles. The tenant brand
still flows through `applyBrand()` — cyan is the new default, not a fixed accent — and the
semantic hues are unchanged, with shades that follow the ground. One migration
(`20260902260000_theme_default_dark`) moves `organisations.theme` to `'dark'`, which no screen had
ever written.

## Interlude — the sample project, and two bugs it found ✅

`seed_sample_data()` used to stop after the directory and the programme, so everything from phase 5
onward could only be looked at. It now fills every module of Kingsmead Wharf Block C: the
responsibility matrix and the scope of service, a 53-row drawing register with packs and
transmittals, material samples and their submission rounds, tasks, RFIs and meetings, the planning,
building control, client, handover, highways and utilities checklists, an occurrence, a fictional
scoring scheme, the pre-construction budget, fees, cashflow, invoices, risks, warranties and eight
change requests covering seven of the twelve work-status states. Every dated row anchors to the
programme; nothing is typed.

Writing it against the real schema found two product bugs, each fixed in its own migration with a
test:

- `20260902260100_reference_counter_per_prefix` — `raise_issue()` keyed its counter on `issue_TSK`
  and `realise_risk()` on `TSK`. Two counters, one prefix: realising a risk on a project that had
  reached TSK-012 was a unique-violation, not a confusing number.
- `20260902260200_breeam_score_is_a_percentage` — `report_metrics()` multiplied the score by 100
  while `breeam_totals()` compared the same value straight against the rating thresholds. A project
  on course for 74 per cent reported "7430%".

## Interlude — the last three greyed-out pages ✅

Monday summary, Gateways and Audit were the only nav entries with no page behind them. They
rendered permanently dimmed, which reads as a module somebody has switched off rather than one
nobody has built — the exact confusion a dimmed entry must never cause. All three are now built,
and none of them adds a derivation: every figure on them is one another page already computes.

- **Monday summary** (`/summary`, core) — what is waiting on you, what is late, what falls due in
  the next fortnight, what changed in the last week. Gone-quiet appears only for the contractor's
  own staff.
- **Gateways** (`/gateways`) — gateway 1, 2 and 3 read off the planning conditions, the building
  control checklist, the golden thread derivations and the change-control classification. It lists
  what is standing in the way rather than counting it, and says plainly when a building is not
  higher-risk.
- **Audit** (`/audit`) — every silent check in one place: unallocated duties and disciplines,
  incomplete appointments, warranties with no owner, numbers that break the convention, drawings
  never issued, golden thread findings, changes approved with work outstanding, unowned risks,
  instalments due with nothing claimed, and fee schedules that do not total.

`src/theme.test.ts` now fails the build for a nav entry with `to: null` or a target with no route,
so this cannot recur silently.

## Interlude — template editing, and the seed where you can find it ✅

Two gaps that both read as "the feature is missing" from the outside.

**An account had nowhere to change its templates.** The DRM library had an editor; the other four
did not, and two of them (risk, warranty) had no fork function at all, so they could only ever be
read from the published set. None of the five carried an UPDATE grant either, so even a forked row
could be inserted and deleted but never corrected. Now: `fork_risk_templates()` and
`fork_warranty_templates()`, `account_risk_templates()` and `account_warranty_templates()` stating
the fork-or-published rule once each, column-level UPDATE grants that deliberately exclude
`organisation_id`, and a Templates tab on the account page covering all four libraries.

**The sample data was reachable from one place that disappeared.** The button lived only on an
empty directory page, so a project seeded before the rest of the sample data existed had a
directory and no way to ask for the other eleven modules — `seed_sample_project()` raised rather
than returning, which made `seed_sample_data()` fail on its first step. It now returns, the whole
seed is idempotent end to end, and it reaches from project settings.

`supabase/tests/templates.test.ts` holds the boundary: a tenant edits its fork, cannot touch a
published row or another account's, and cannot move a template between accounts.

## Phase 15 — Marketing site and sign-up ✅

*Reference: `docs/landing-page-reference.html`, brief §5.*

- [x] Public site, separate from the application, same design tokens: home, product, pricing,
      about, contact, sign up
- [x] Sign-up creates a pending host for platform-owner approval (phase 1)
- [x] Company name is a placeholder ("Spine") to be replaced

**One address, two answers — and a third for the site itself.** `/` is the marketing home to a
signed-out visitor and the application's landing decision to a signed-in one. The public home
page also answers at `/welcome`, which every session can reach: without it a signed-in person
could not open the public site at all, and the wordmark in the shell had nowhere to send them.
The wordmark points at `/welcome` because it is the company rather than the workspace, and the
public header offers "Back to your projects" to anybody carrying a session. Both had to be at the top of the domain: a
marketing page at `/welcome` is one nobody links to, and a signed-in person must never be shown a
sales page for a product they have already bought. `/product`, `/pricing`, `/about` and `/contact`
are public and sit outside `RequireAuth` — a test reads the route block and fails if a guard ever
appears around them.

**The tokens are the application's own, not the reference's.** `docs/landing-page-reference.html`
is the old light palette; what was kept from it is the tone and the layout, and the colours are
the current luminous-glass set, because the two are one product and a site that looks like a
different company is a promise the first screen after sign-up breaks. The hero is a real slice of
the matrix with a hi-vis gap row in it, which is the most recognisable thing the product does.

**The brief's sign-up flow was superseded and this follows CLAUDE.md.** §5 says sign-up creates a
pending host; the identity model says a login and an account are separate things, and that anyone
may sign up while only a platform owner's approval creates an account. "Start a trial" therefore
goes to sign-up, then confirmation, then `/request-account` — which is the flow phase 1 built.

**Figures are absent on purpose.** The brief calls the pricing a placeholder structure with
figures to be set, so the cards say POA and a test fails the build if a currency figure ever
appears — a placeholder number on a public page is a number somebody quotes back at you.

**No auth screen is a dead end.** Sign in, sign up and the confirmation wall all carry a way
back to the public site — somebody who cannot get past sign-in, because they have no account yet
or are waiting on an approval, was otherwise stuck on it with the site they arrived from
unreachable. A test asserts each of those screens keeps a way off it.

**The project URL absorbs the one setup mistake worth absorbing.** The Supabase dashboard shows
the address twice — bare in Project Settings, and as the REST endpoint on the API pages, which is
the one on screen while somebody is copying values into Netlify. Pasting it produced a deployed
site that refused to start. The endpoint suffixes are now trimmed; anything else still fails the
check, with the value actually typed quoted back.

### Remaining in this phase

- **A contact form with nowhere to post.** Sending mail is Phase 16, so the form composes a real
  `mailto:` from what was typed rather than silently discarding it. Replace it when there is an
  address to post to, and change `TO` off the `.example` domain.
- **The name.** "Spine" is still a placeholder, and the footer says so out loud — a test asserts
  it keeps saying so, because a working name nobody labels becomes the name by default.
- **Playwright**: that `/` differs signed in and signed out is asserted structurally here, and
  the click-through belongs with the rest of the outstanding Playwright work.

## Phase 16 — Email and notifications ✅

- [x] Invitations (phase 1)
- [x] Assignment and overdue notifications
- [x] Monday digest per person ("My week" as an email)
- [x] All templates honour visibility — nothing in an email the recipient couldn't see in the app

**The visibility rule is a mechanism, not a promise.** The usual way to build a digest is a job
with full database access that assembles the message and is careful about what it includes —
and careful is a promise that one forgotten join breaks, at which point a consultant is reading
a rival's overdue drawings in their inbox. So no email is assembled that way. `my_week()` is an
ordinary invoker function keyed on `auth.uid()`, exactly like the pages. `build_digest()` sets the
claim and calls it, and is **owned by `notifier`** — a role that holds no `BYPASSRLS` and owns no
table, so every policy written `to authenticated` is enforced against it. The email is not a
careful copy of what the recipient can see; it is the same query. A test asserts the impersonated
digest is identical to what that person loads, and asserts the owner, because a later migration
that recreates the function without the owner line would silently undo the whole thing.

PostgreSQL refuses to let a `security definer` function change the role at all, so the obvious
`set role authenticated` approach is not available — the owning role is what makes RLS apply.

**Composing and sending are separate.** `queue_notifications()` writes to the `notifications`
ledger; the Edge Function sends what is in it. A provider outage loses nothing, and a `dedupe_key`
means a message is composed once however often the job runs. An overdue key carries the due date,
so a moved programme and a missed new date is a fresh message rather than a silence.

**There is no invitation preference, on purpose.** An invitation is how somebody consents to join
an account; one they could mute is a consent they have silently lost the ability to give, and it
frequently goes to a person with no login at all. `paused` does not cover it either, and the
settings page says so rather than leaving it to be found out.

**Somebody can read their own email before it is sent.** The profile page previews the week from
the same function that builds the message, and lists what has been sent to them. Nobody else can
read that ledger — not an account admin: the body of a digest is that person's own view of their
own projects, and a mailbox somebody else can open is not a mailbox.

### Remaining in this phase

- **No provider is configured.** `RESEND_API_KEY` absent is a dry run: messages queue and are not
  sent, which is the right default for a half-configured job but means nothing has been sent
  against a real provider yet. Verify a domain, set the secret, and watch the first run.
- **The cron job is documented, not scheduled** — the same position as the nightly snapshot.
  `supabase/README.md` carries the statement.
- **Comment mentions do not notify.** `@` in a comment is the obvious next event and is not wired;
  it belongs with rooms in Phase 17, which is where mentions will matter most.
- **Playwright** for the preferences screen and the preview.

## Phase 17 — Project rooms

Correspondence that has not found its record yet. Every conversation in the product today has to
hang off something — an issue, a drawing, a matrix duty — and the ones that do not are happening
on WhatsApp, where the golden thread cannot see them, nobody can search them, and they leave with
the person who leaves the company. Pulling that inside a Building Safety Act tool is the point of
the module, not a convenience.

*Depends on Phase 16: rooms consume notifications, so those have to exist first.*

**Rooms, never direct messages. Decided, and the wording carries it.** `can_see()` grants an
account admin and that project's admin past every visibility mode, so a private message between
two people is not achievable without giving chat its own branch that the override does not cross
— and a channel in this product where two people can agree something and leave no trace is a
liability rather than a feature. So nothing here is private, the module says so, and every room
shows who can read it at the top. A two-person room is still a room.

- [ ] `chat_rooms`: project, name, purpose, `visibility` (the existing primitive — `project` for
      the whole team, `named` for a few people, `parties` for a company tree). No `*_members`
      table: the audience is the visibility column, like every other record with one.
- [ ] Messages reuse `comments` with `entity_type = 'room'`. It is already a threaded message
      table with an author, a parent, a visibility and an `edited_at` — a chat room is what it
      was always shaped for, and a second message table would be a second place for a message to
      be.
- [ ] Live delivery through Supabase Realtime. No new infrastructure.
- [ ] Convert to task: extend `issues.source_kind` with `'chat'`, and make the control work on a
      **selected range** of messages rather than one, because the real workflow is "this whole
      exchange is now an RFI". Quote the messages into the task and link both ways. Raising from
      a single message already works — `origin_comment_id` and `canRaiseTask` are built.
- [ ] A bolt-on like every other: one `module_catalogue()` row, a nav entry with the same key, a
      `RequireModule` around the page.

### What it must not do

- [ ] **No change-log trigger.** Chat volume would drown a log whose whole value is that it is
      readable. `comments` carries no trigger either; same precedent, same reason.
- [ ] **Chatter is not "touched".** Only a message linked to a record counts towards gone-quiet,
      or a room full of banter makes a stalled item look active and the finding stops being
      found.
- [ ] **Delete tombstones, never removes.** "The trail is not yours to edit" is on the public
      site. WhatsApp-style delete-for-everyone would contradict it; an edit shows as edited.
- [ ] **Client reports and exports exclude it** unless a room's own visibility says otherwise —
      the same `report_scope()` and exclusion list as everything else.

## Phase 18 — Energy modelling (later, not now)

- [ ] Not in scope yet. Do not build placeholder screens. See `[[u-value-calculator-tool]]` /
      the U-value calculator project for the standalone tool this will eventually bolt on.
