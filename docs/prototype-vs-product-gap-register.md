# Prototype vs product — gap register

One row per module. **Proven** means the behaviour exists in `dmp-prototype.html` and is covered by an automated test that can be ported. **Product needs** is what must be built beyond the prototype. The last column is where to read the rules.

Legend for the test column: `test.js` renders every page and modal for every role; `behaviour.js` drives real clicks through the shell; `audit-static.js` / `audit-dynamic.js` confirm every control reaches a handler and nothing throws when clicked. Module-specific suites are named.

---

## Platform layer — not in the prototype at all

| Feature | Prototype | Product needs | Where |
|---|---|---|---|
| Marketing site | — | Home, product, pricing, about, contact, sign-up. Same design tokens. | Brief §5, `landing-page-reference.html` |
| Sign-up | — | Creates a pending host; platform owner approves. | Handover §1b, prompt 1 |
| Authentication | Demo login picker, six accounts | Supabase Auth. One login per person regardless of hosts. | Handover §1b |
| Hosts (tenants) | Single host implied | `organisations` with subscription, module entitlements, brand, logo, theme. | Handover §1a, §1b |
| Memberships | Per-project roles | Person × host × role × company. Several per person. Host isolation absolute. | Handover §1b |
| Invitations | Directory add only | Invite button on add → email → accept from own login → membership. Consent-based; email match grants nothing. | Handover §1b |
| Platform owner | — | Above all hosts: create, approve, suspend, set entitlements, see everything. Own RLS bypass, own audit table. | Handover §1b |
| File storage | Filenames only | Supabase Storage; evidence and comment attachments reference storage paths. | Handover §6 |
| Email | "Monday summary" page, no sending | Invitations, assignment and overdue notices, Monday digest. Every template honours visibility. | Handover §7, prompt 16 |
| Snapshots | Capture button on Settings, one project | Nightly job, every project. Trends read only from here. | Handover §1a snapshots, prompt 14 |
| Portfolio dashboards | — | Host home (projects worst-first), consultant health across projects, decision queue across projects, trends. | Brief §6, prompt 14 |
| Energy modelling module | — | Future bolt-on, entitled per host. Do not stub. | Prompt 17 |

---

## Core tier — always on

| Module | Proven in prototype | Test | Product needs | Where |
|---|---|---|---|---|
| Projects | Create, edit, switch; HRB flag and gateway dates | `test.js` | `organisation_id` on every project. | Handover §3 |
| Directory and disciplines | Companies hold disciplines; parent/sub companies; appointment documents with derived status; person cards; a login's person cannot be deleted | `test.js`, `behaviour.js`, `audit-dynamic.js` | Invite button and flow (above). | Handover §3 |
| Master catalogue | Copy-on-select; push corrections back; project independence | `test.js` | Per host, never shared across hosts. | Handover §1a |
| Responsibility matrix | Standard library snapshot; lead/coordinate/input; gaps in hi-vis; `leadCompanies()` live lookup | `test.js`, `behaviour.js` | Library as host asset forked from published default. | Handover DRM section |
| Programme | Template import with validation, preview, rejects; re-import reschedules everything; removed lines flagged; line inspector; tracking | `behaviour.js` (slip test) | Nothing structural. Consider live sync to Asta/P6/MSP later, keeping the template as the spine. | Handover programme section |
| Drawing register | Planned and delivered are one row; naming convention; derived construction status and sync; audit tab | `test.js`, `behaviour.js` | Storage paths for the files themselves. | Handover register section |
| Drawing packs | References not copies; pack-to-programme as resource only; issue a pack on a transmittal; "revised since issue" | `behaviour.js` | Nothing structural. Enforce in review: no date query joins pack-to-programme. | Handover packs section |
| Transmittals | Recipients, distribution rule, pack expansion at current revisions | `behaviour.js` | Email delivery of the transmittal itself. | Handover transmittals section |
| Tasks, RFIs, meetings | One issues store, many views; raise from any comment; agenda items become tasks; distribution rule | `test.js`, `behaviour.js` | Nothing structural. | Handover issues section |
| Comments and evidence | Polymorphic; live register links; review reopens on revision | `behaviour.js` | Storage paths. | Handover comments/evidence sections |
| Change log | Every edit appended; viewable; exported | `test.js` | Postgres trigger rather than application code. | Handover §5 |
| Exports | CSV per module, full JSON, all honouring visibility | `audit-dynamic.js` (190+ downloads confirmed) | Nothing structural. | — |
| Shell and theming | Lifecycle nav, collapsible groups, brand colour with derived contrast, dark mode, locked semantic colours, panel kinds, module entitlements | `shell.js` | Entitlements read from host record. | Handover §8 |
| Consultant front | Own deliverables, asks, instalments, leads, tracked lines, warranties owed, decisions | `shell.js`, `newmodules.js` | Nothing structural. | Handover consultant-front section |
| Project dashboard | Decision queue, gone quiet, consultant health, timeline strip, HRB stop-works | `shell.js` | Roll-up to portfolio (above). | Handover dashboard section |
| Reports | Three audiences, three pages, sensitivity rules, itemised compliance rows, print | `reports.js` (negative assertions) | Optional server-side PDF; otherwise nothing. | Handover reports section |

---

## Compliance tier

| Module | Proven in prototype | Test | Product needs | Where |
|---|---|---|---|---|
| Planning conditions | Tracker with phases, evidence, discussion; CSV import | `test.js`, `newmodules.js` | **Fold into one `tracked_items` table** (§1a). | Handover §1a, tracker import section |
| Building control | Parts and sections; tracker; CSV import | `test.js`, `newmodules.js` | Same table as above. | Same |
| Building safety (HRB) | Project flag; change-control classification restricted to PDB/admin by handler not UI; "may proceed" derived for all ten cases; configurable periods; golden thread designation and baseline; occurrence register; gateway checklist; duty-holder table | `bsa.js` | Policy-level enforcement of the classification guard. | Handover building-safety section |
| BREEAM | Empty scheme, versioned; three imports; credits summed not stated; prerequisites block; structured minimum standards; both ratings | `breeam.js` (hand-worked arithmetic) | Nothing structural. **Ship nothing licensed.** | Handover BREEAM section |
| Scope of service | Named templates (core + six disciplines); apply as a selection pre-checked by discipline; dedup by template+ref; template CRUD; licensed schedule import per appointment | `scope.js` | Same `tracked_items` table; templates as host asset. | Handover scope section |
| Checklists (six) | One engine; 515 template items; pre-assign where unambiguous; strike out not delete; response field; utilities carry quotation dates | `checklists.js` | Same table; templates as host asset; the pre-assessment `response` field is where a future AI populates answers — keep provenance visible. | Handover checklists section |

---

## Commercial tier

| Module | Proven in prototype | Test | Product needs | Where |
|---|---|---|---|---|
| Fees and cashflow | Fees and variations; negotiated payment schedule with agreement recorded; invoices mapped to instalments; cashflow derived; context windows with evidence | `behaviour.js` | Nothing structural. | Handover fees section |
| Pre-construction budget | Host-only; budget lines; quotes with named adjustments; preferred; one link outward to a fee | `behaviour.js` | Nothing structural. RLS: host roles only, including from the quoting consultant. | Handover pre-con section |
| Risk and opportunity | Person-owned; closed visibility with admin override; derived band and expected value; heat grid; realised → task; template library loads with no owner | `bsa.js` (visibility), `newmodules.js` (templates) | Nothing structural. `internal` role decision outstanding. | Handover risk section |
| Change requests | Any direction; no money; approval ≠ implementation with a named amendment list; two dates; BSA classification overlay | `changereq.js`, `bsa.js` | Nothing structural. | Handover change-request section |
| Warranties | DRM-linked, owner resolved live through the lead discipline — no company column; same gap as the matrix; template library; consultant front panel | `newmodules.js` (reassign-follows test) | `warranty_owner()` function; RLS through it. **Do not add `company_id`.** | Handover warranties section |
| Material samples | Rounds never overwritten; rejection survives later approval; decisions restricted | `newmodules.js` | `material_submissions` child table. | Handover materials section |

---

## Structural changes the product should make that the prototype does not

These are in handover §1a and should be done as the modules are built, not retrofitted.

| Change | Why | Affects |
|---|---|---|
| One `tracked_items` table with a `kind` | Planning, BC, scope, BREEAM credits and checklists are the same record; five tables is five places to fix the next bug. | Prompt 9 |
| One `visibility` primitive and one `can_see()` function | Four different rules today (tasks, risks, change requests, pre-con). Thirty policies to get subtly wrong. | Every RLS policy |
| Templates as host assets forked from a published default | The 515 checklist items, the DRM library, the scope templates, the risk and warranty libraries are the licensable IP. | Prompts 3, 9, 12 |
| Organisation above project; membership per host | Cross-host consultants with one login. | Prompt 1 |
| Entitlements on the host record | One codebase, modules per host. | Prompts 1, 7 |

---

## Things proven by the audits that are easy to lose in a rebuild

- A person who holds a login cannot be removed from the directory (crashed the prototype once; now guarded and tested).
- Every reference to another record is a link, resolved by one function; new entity types are added in one place.
- Every "Add" control refuses empty input with a message rather than creating a blank row.
- Every "already on this project" loader says so rather than duplicating.
- A tab clicked while active is a no-op, not a re-render.
- Exports fire on every role that can see the page, and honour that role's visibility.
- The client role can never select the internal report audience; a consultant can never select another company's.
- The BSA classification guard holds at the handler, not just the markup — a synthetic event from the wrong role is refused.
