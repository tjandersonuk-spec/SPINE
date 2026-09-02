# Build brief — Design Management Platform

**For:** Lovable (with Supabase)
**From:** HBC Construction, design management
**Accompanies:** `dmp-prototype.html` (the working reference), `lovable-handover-notes.md` (the schema and rules), `lovable-prompt-sequence.md` (what to ask Lovable, in order), `prototype-vs-product-gap-register.md` (every module, what is proven, what is missing), `landing-page-reference.html` (the marketing site reference)

Read this document first. It says what the product is, what the prototype already proves, and what has to be built that the prototype does not show. Then use the prompt sequence.

---

## 1. What this is

A design management platform for main contractors who take on design responsibility. It sits **above** the common data environment (Asite, Aconex, Viewpoint) rather than replacing it: the CDE holds the files; this holds what is due, who owns it, what slips when the programme moves, and what nobody has been given.

It is built on two ideas that every module inherits, and that any implementation must preserve:

**Two spines.** Nothing is assigned to a company; it is assigned to a *discipline*, and companies hold disciplines. And no date is ever typed; every date is a *programme line plus an offset*. Re-import the programme and the whole project reschedules.

**Derive, never store.** Construction status, due dates, overdue counts, cashflow curves, risk exposure, warranty ownership, BREEAM scores, whether a change may proceed — all computed on read. Anything stored that could disagree with reality eventually will, silently. The one exception is a nightly snapshot table, which stores facts *about a date* for trend charts, never the live position.

Three more rules the prototype enforces and the product must keep: licensed third-party content (BREEAM criteria, BG6, CIC) never ships — tables are empty and loaded per project by whoever holds the licence; hi-vis yellow means exactly one thing, an unallocated gap; and every reference to another record is a working link, never printed text.

---

## 2. Who uses it, and the identity model

This is the first and most consequential design decision. Get it right in the first prompt.

**A host** is a main contractor who has an account: HBC, then whoever you license to. A host owns organisations (its own), projects, and its own copies of templates and the master catalogue.

**A person** is one human with one login. They may be a host's staff, or a consultant, or a client. A consultant works for HBC on one job and for another contractor on the next — with the *same* login.

**Membership** is the link: a person is a member of a host, with a role (`admin`, `internal`, `consultant`, `client`), via a company. A person can hold several memberships across several hosts. Each host sees only its own projects; a person sees each host's projects only through that host's membership, and never sees that another host exists.

**Invitation is how membership is created, and it must be consent-based.** Adding someone to a host's directory creates an *Invite* button. The invite goes by email. The person accepts from their own login (creating one if they have none) — and *that* creates the membership. Merely typing an address into a directory grants nothing. This matters for two reasons: anyone who knows a consultant's email must not be able to pull them into a project they never agreed to join, and the consultant's existing employer must not discover that happened after the fact. The link outcome you want — one person seeing projects across two hosts — is exactly what happens once they accept both invites. The consent step is not a barrier to that; it is what makes it defensible.

**A platform owner** sits above every host. That is you: able to create hosts, manage their subscriptions and modules, see every organisation. No host admin sees this layer. It needs its own RLS bypass and its own audit trail, because it is the account that can see everything.

The prototype demonstrates roles and per-project visibility completely, and demonstrates the *effect* of cross-host membership in the consultant front and the sensitivity rules. It does **not** demonstrate sign-up, invitations, cross-host membership itself, or the platform-owner layer. Those are product work, specified in full in handover §1b.

---

## 3. What is licensed, and how it is packaged

One codebase. Modules are **entitlements per host**, not separate applications. The core cannot be turned off, because nothing works without the directory and the programme. Everything else is a module a host can have or not, which is both how a licence is tiered and how a toolkit is phased in — HBC can switch modules on per project.

| Tier | What it contains | Prototype status |
|---|---|---|
| **Core — always on** | Projects, directory and disciplines, master catalogue, responsibility matrix, programme and Gantt, drawing register and packs, transmittals, tasks, RFIs, meetings, comments, evidence, audit log, reports | Fully prototyped and tested |
| **Compliance** | Planning conditions, building control, building safety (higher-risk buildings), BREEAM, scope of service, the six checklists | Fully prototyped and tested |
| **Commercial** | Fees and cashflow, payment schedules, invoices, pre-construction budget, risk and opportunity, change requests, warranties, material samples | Fully prototyped and tested |
| **Energy modelling** | The U-value and building energy concept tool being developed separately | Not in this prototype; a future bolt-on |

The prototype's Settings page shows the entitlement switches working. The product needs those switches to be per host and set from the platform-owner layer, with a subscription record behind them.

---

## 4. What the prototype proves, and what it does not

The prototype is a single self-contained HTML file with in-memory data. It is the **source of truth for behaviour**: how every derivation works, what every page shows to each role, what every button does. It is not the source of truth for structure — the schema in the handover notes is, and §1a of that document says explicitly where the product should be shaped differently from the prototype.

Ten automated test suites and two button audits back it. Together they cover: every page and modal rendering for every role; every derivation checked against arithmetic worked by hand; every visibility rule checked from the wrong side (that a person who should not see something does not); every rendered control reaching a handler; and every control physically clicked on every page for every role without an exception. The assertions in those suites are what should be ported as tests — not the code.

**Proven in the prototype, to be reproduced:** everything in the three tiers above; role-based visibility including the closed-by-default risk register and the admin override; brand theming with locked semantic colours; the lifecycle navigation; the consultant front; three-audience period reports with their sensitivity rules; the import discipline (template, header validation, preview, rejected rows returned) for programme, register, BREEAM, checklists, planning and building control.

**Required in the product, not in the prototype:**

1. The marketing site and sign-up (§5).
2. Authentication, hosts, memberships, invitations, cross-host identity (§2).
3. The platform-owner layer: host management, subscriptions, module entitlements per host, cross-host audit.
4. File storage — the prototype holds filenames; the product holds files (Supabase Storage), with the evidence and comment tables pointing at storage paths.
5. Email — invitations, the Monday digest, notifications on assignment and overdue.
6. The nightly snapshot job for trend charts.
7. **Portfolio dashboards** — across every project in a host's account: the same inferences the project dashboard makes (decisions waiting, gone quiet, consultant health, stop-works on HRBs, client requirements confirmed), rolled up by project and by company across projects. The prototype has one project; the product has many.
8. The energy modelling module, later.
9. Two structural simplifications the handover notes ask for that the prototype does not do: one tracked-item table instead of five, and one visibility primitive instead of four rules.

---

## 5. The marketing site

A public site for the software company, separate from the application. Placeholder company name **Spine** — chosen because the two spines are the product's defining idea — to be replaced.

Pages: home (hero, the two-spines pitch, three benefits), product (the three tiers, what each contains), pricing (per host, tiered by module; a placeholder structure, figures to be set), about, contact, and **sign up**. Sign-up creates a host account pending platform-owner approval, then the host admin logs in and builds their directory.

`landing-page-reference.html` shows the intended look: the application's own design tokens, the brand-colour nav, the same restraint. It is a reference for tone and layout, not a finished site.

---

## 6. Portfolio dashboards

Once a host has more than one project, the account needs a view above them. This is new work; the prototype's dashboard is per project.

**Host home:** every live project as a row — stage, today's position on the programme strip, documents overdue, DRM gaps, decisions waiting, stop-works count on HRBs, client requirements confirmed. Worst first. Each is a link into the project.

**Across projects, by company:** the consultant-health row, but summed across every project that company is appointed on. A consultant who is fine on one job and behind on three is a conversation the per-project view cannot start.

**Across projects, by person:** the decision queue, project-wide — everything waiting on this person across every project they are on. This is what a design manager running four jobs actually opens on a Monday.

**Trends:** from the snapshot table only — register burn-up, expected risk value over time, per project and across the portfolio.

All derived from the same functions the project dashboard uses; the only new code is the roll-up, and the only new data is the snapshot table already in the schema.

---

## 7. Sequence

The prompt sequence in `lovable-prompt-sequence.md` is ordered so that each step is usable on its own and nothing has to be rebuilt later. Identity and hosts first, because it is the hardest thing to change. Then the two spines. Then modules in tier order. Then the marketing site and portfolio views, which need everything else to exist.

Do not let Lovable build the modules before the spines exist. Every module hangs off the directory and the programme; a module built without them will be rebuilt.

---

## 8. What to hand to Lovable, and when

| Step | Give Lovable |
|---|---|
| Before anything | This brief, and §1a and §1b of the handover notes |
| Prompt 1 | Handover §1b in full; the marketing-site brief |
| Each module prompt | That module's section of the handover notes, and the prototype open in a browser for reference |
| Every prompt | The prototype's test assertions for that area, to port as tests |
| Design | `landing-page-reference.html`; the theming section of the handover notes (§8) |

The prototype itself is the reference for *what it should do*. Lovable can open it, click through it, and see every state. It should not copy the code.
