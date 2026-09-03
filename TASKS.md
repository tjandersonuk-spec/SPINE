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
