-- Phase 6, part two -- discussion, attachments and evidence.

-- One comments table for every entity that can be discussed. Polymorphic on
-- purpose: a discussion thread is the same thing whether it hangs off a drawing,
-- a matrix item or a fee, and five near-identical tables is five places for the
-- threading to diverge.
create table comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  author_id uuid not null references profiles(id),
  body text not null check (btrim(body) <> ''),
  parent_id uuid references comments(id) on delete cascade,
  visibility jsonb not null default '{"mode":"project"}'::jsonb
    check (visibility_is_valid(visibility)),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index on comments (project_id, entity_type, entity_id, created_at);

-- An attachment is either a named file in the bucket or a live link to a
-- register row -- never a filename someone typed. A drawing referenced in a
-- discussion six months ago should still show its current revision, which a
-- string cannot do.
create table comment_attachments (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references comments(id) on delete cascade,
  name text,
  drawing_id uuid references drawing_register(id) on delete set null,
  storage_path text,
  uploaded_by uuid references profiles(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  -- One or the other. A row that is neither is an attachment to nothing.
  constraint comment_attachment_has_a_target
    check (drawing_id is not null or storage_path is not null)
);
create index on comment_attachments (comment_id);

-- Evidence, generic.
--
-- The {reviewer, reviewed_at, revision_at_review} record built for the
-- compliance trackers fits fees, invoices, instalments, risks and quotes
-- unaltered, so it is one table rather than five near-identical sets of columns.
create table evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  name text,
  drawing_id uuid references drawing_register(id) on delete set null,
  storage_path text,
  -- What the register said when this was attached, so "has it moved since?" is
  -- answerable without a second table.
  revision_at_add text,
  added_by uuid references profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  revision_at_review text,
  constraint evidence_has_a_target
    check (drawing_id is not null or storage_path is not null or name is not null),
  -- A review is a person and a moment together; half of one is not a review.
  constraint evidence_review_is_whole
    check ((reviewed_by is null) = (reviewed_at is null))
);
create index on evidence (project_id, entity_type, entity_id);

-- Record the revision at the moment of attaching, so nothing has to be typed
-- and nothing can be typed wrongly.
create or replace function stamp_revision_at_add()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.drawing_id is not null and new.revision_at_add is null then
    select r.revision into new.revision_at_add
    from drawing_register r where r.id = new.drawing_id;
  end if;
  return new;
end;
$$;

create trigger evidence_stamp_revision
before insert on evidence
for each row execute function stamp_revision_at_add();

-- And at the moment of reviewing. The reviewer states that they reviewed it;
-- which revision that was is a fact about the register, not their opinion.
create or replace function stamp_revision_at_review()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.reviewed_at is not null and old.reviewed_at is null and new.drawing_id is not null then
    select r.revision into new.revision_at_review
    from drawing_register r where r.id = new.drawing_id;
  end if;
  if new.reviewed_at is null then
    new.revision_at_review := null;
  end if;
  return new;
end;
$$;

create trigger evidence_stamp_review
before update on evidence
for each row execute function stamp_revision_at_review();
