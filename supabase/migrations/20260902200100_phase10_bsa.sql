-- Phase 10, part two -- the Building Safety Act regime.
--
-- Switched on per project. Everything here is inert unless projects.hrb is
-- true, so an ordinary scheme never sees any of it.
--
-- A caveat carried from the notes into the code: the categories, the periods
-- and the reporting threshold are regulatory matters that move. Whoever holds
-- the Principal Designer (BSA) duty should review this before it is used on a
-- live scheme, and the periods must stay editable rather than becoming
-- constants in a later refactor.

alter table projects
  add column hrb boolean not null default false,
  add column hrb_reason text,
  add column g2_reference text,
  add column g2_approved_date date,
  add column commencement_notified date,
  -- CONFIGURABLE, not constants. The notifiable objection window is quoted as
  -- both ten working days and fourteen days across published sources, and a
  -- major determination as four to six weeks extendable by agreement. Hardcode
  -- either and the app is confidently wrong on somebody's scheme.
  add column hrb_notify_days int not null default 14,
  add column hrb_major_weeks int not null default 6;

alter table change_requests
  add column bsa_controlled boolean not null default false,
  -- Never computed, never defaulted, never recommended. Recordable, notifiable
  -- or major is a duty-holder judgement made by the client, the principal
  -- designer and the principal contractor together. The app stores who decided,
  -- when, and on what written basis -- and nothing else.
  add column bsa_class text check (bsa_class in ('Recordable','Notifiable','Major')),
  add column bsa_class_by uuid references profiles(id) on delete set null,
  add column bsa_class_at timestamptz,
  add column bsa_class_note text,
  add column bsa_notified_at date,
  add column bsa_objected boolean not null default false,
  add column bsa_objection_note text,
  add column bsa_app_reference text,
  add column bsa_app_submitted date,
  add column bsa_app_decided date,
  add column bsa_app_outcome text
    check (bsa_app_outcome is null or bsa_app_outcome in ('Approved','Rejected')),
  -- A classification is a person, a moment and a reason together. Any two
  -- without the third is not a classification.
  add constraint change_request_classification_is_whole
    check ((bsa_class is null)
           or (bsa_class_by is not null and bsa_class_at is not null
               and btrim(coalesce(bsa_class_note,'')) <> ''));

alter table drawing_register
  -- The golden thread is a designation plus a baseline, not a document store.
  add column golden_thread boolean not null default false,
  -- Stamped once, at Gateway 2 approval. Never recalculated -- the whole point
  -- is to answer "what has moved since".
  add column g2_revision text;

-- Mandatory occurrence reporting.
--
-- Its own table, deliberately. A risk is prospective and an occurrence has
-- happened; they have different clocks and different audiences, and merging
-- them would put a statutory reporting duty into a commercial register.
create table occurrences (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,
  title text not null check (btrim(title) <> ''),
  description text,
  kind text,
  status text not null default 'Under assessment'
    check (status in ('Under assessment','Reportable','Not reportable','Reported','Closed')),
  -- An occurrence assessed as NOT reportable still stores its reasoning. That
  -- is the record somebody asks for afterwards.
  assessment text,
  occurred_at date,
  discovered_at date,
  reported_at date,
  person_id uuid references project_people(id) on delete set null,
  company_id uuid references companies(id) on delete set null,
  raised_by uuid references profiles(id) on delete set null,
  raised_at timestamptz not null default now(),
  visibility jsonb not null default '{"mode":"internal"}'::jsonb
    check (visibility_is_valid(visibility)),
  unique (project_id, reference),
  -- A decision either way needs its reasoning written down.
  constraint occurrence_assessment_is_reasoned
    check (status not in ('Reportable','Not reportable')
           or btrim(coalesce(assessment,'')) <> '')
);
create index on occurrences (project_id, status);
