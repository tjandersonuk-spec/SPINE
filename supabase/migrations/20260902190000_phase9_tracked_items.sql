-- Phase 9 -- one tracked-item engine.
--
-- Planning conditions, building control items, scope of service lines, BREEAM
-- credits and every checklist are the same record: a prompt, a heading, an
-- owner, a date off the programme, evidence, a discussion and a strike-out. The
-- prototype has them as separate implementations because they arrived one at a
-- time. Five near-identical tables is the duplication this system exists to
-- remove -- and it makes the sixth checklist a build rather than a template.

-- The kinds this engine answers to. Stated once so a typo becomes an error
-- rather than a row nothing ever reads.
create or replace function tracked_kinds()
returns text[]
language sql
immutable
as $$
  select array[
    'planning', 'bc', 'scope', 'breeam',
    'checklist:precon', 'checklist:client', 'checklist:handover',
    'checklist:highways', 'checklist:utilities'
  ];
$$;

grant execute on function tracked_kinds() to authenticated;

create table tracked_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null,
  reference text not null,
  heading text,
  title text not null check (btrim(title) <> ''),
  prompt text,
  -- The discipline, as everywhere: which company holds it is a live lookup.
  discipline text,
  -- The strike-out. False drops the row from every denominator and renders it
  -- struck through -- but the row survives, because deleting it loses the
  -- decision that it was not needed, which is precisely what somebody asks
  -- about later.
  required boolean not null default true,
  status text not null default 'Not started',
  -- The ANSWER, not just a state. The pre-assessment is 193 questions with an
  -- answer field, and this is the column a model would populate from a tender
  -- pack -- see response_source below.
  response text,
  -- Who wrote the response. A machine-suggested answer must be visibly
  -- distinguishable from one a person wrote, or the checklist stops meaning
  -- anything.
  response_source text not null default 'person'
    check (response_source in ('person', 'suggested')),
  response_by uuid references profiles(id) on delete set null,
  response_at timestamptz,
  company_id uuid references companies(id) on delete set null,
  -- The directory row, not the login: a person named on a project often has no
  -- account, and this matches how issues name an owner. The notes say
  -- profiles(id) here and project_people(id) for issues; one of the two had to
  -- give, and the directory is how a project names people.
  person_id uuid references project_people(id) on delete set null,
  -- The four anchor columns. Their branch in programme_dependents() is added in
  -- 20260902190200_phase9_functions.sql, as the rule requires.
  programme_task_uid text,
  offset_days int not null default 0,
  anchor text not null default 'finish' check (anchor in ('start','finish')),
  due_date_override date,
  -- Added on the project rather than loaded from a template. A template row is
  -- struck out, never deleted; a custom row may be deleted.
  custom boolean not null default false,
  -- Which template gave us this row, and what it was called at the time.
  -- Renaming a template later must not rewrite history on a project that has
  -- already loaded from it, so the name is stored and display-only.
  template_id uuid,
  template_name text,
  -- Kind-specific fields. Small and typed by the constraint below; if a kind's
  -- ext grows past six or seven keys it has earned a side table.
  ext jsonb not null default '{}'::jsonb,
  visibility jsonb not null default '{"mode":"project"}'::jsonb
    check (visibility_is_valid(visibility)),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, kind, reference),
  constraint tracked_items_kind_is_known check (kind = any(tracked_kinds())),
  -- A response written by nobody at no time is not a response.
  constraint tracked_items_response_is_whole
    check ((response is null) or (response_by is not null and response_at is not null))
);
create index on tracked_items (project_id, kind, required);
create index on tracked_items (project_id, programme_task_uid);
create index on tracked_items (project_id, company_id);

-- The utilities asymmetry, held in ext and validated rather than left free.
--
-- A connection is enquiry -> quotation -> acceptance -> energisation, and
-- recording the first two dates is what makes a lead time visible before it
-- becomes a delay. §1a puts them in ext rather than in six columns every other
-- kind would carry as null; this constraint is what keeps ext from becoming a
-- place to put anything.
create or replace function utilities_ext_is_valid(v jsonb)
returns boolean
language sql
immutable
as $$
  select v is null or (
    jsonb_typeof(v) = 'object'
    and not exists (
      select 1 from jsonb_object_keys(v) k
      where k not in ('supplier','quote_reference','quote_value',
                      'date_enquiry','date_quote','date_accepted','date_energised'))
  );
$$;

alter table tracked_items add constraint tracked_items_utilities_ext
  check (kind <> 'checklist:utilities' or utilities_ext_is_valid(ext));

-- BREEAM's ext is the same idea: credits available, targeted and achieved.
-- Stated here so the shape is declared before Phase 11 needs it, rather than
-- discovered by whatever writes the first row.
create or replace function breeam_ext_is_valid(v jsonb)
returns boolean
language sql
immutable
as $$
  select v is null or (
    jsonb_typeof(v) = 'object'
    and not exists (
      select 1 from jsonb_object_keys(v) k
      where k not in ('section','issue','credits_available','credits_targeted',
                      'credits_achieved','weighting','is_prerequisite','minimum_standard'))
  );
$$;

alter table tracked_items add constraint tracked_items_breeam_ext
  check (kind <> 'breeam' or breeam_ext_is_valid(ext));

grant execute on function utilities_ext_is_valid(jsonb) to authenticated;
grant execute on function breeam_ext_is_valid(jsonb) to authenticated;
