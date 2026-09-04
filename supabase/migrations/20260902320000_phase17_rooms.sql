-- Phase 17: project rooms.
--
-- Correspondence that has not found its record yet. Everything else in this
-- product hangs off something -- an issue, a drawing, a matrix duty -- and the
-- conversations that do not are happening on WhatsApp, where the golden thread
-- cannot see them, nobody can search them, and they leave with the person who
-- leaves the company. Pulling that inside is the point of the module.
--
-- Rooms, never direct messages, and the schema is what makes that true rather
-- than the wording. `can_see()` grants an account admin and a project admin
-- past every visibility mode, so a genuinely private message between two
-- people would need chat to have its own branch that the override does not
-- cross -- and a channel in a Building Safety Act tool where two people can
-- agree something and leave no trace is a liability, not a feature. So chat
-- gets no such branch. A two-person room is still a room, and every room says
-- at the top who can read it.

-- ------------------------------------------------------------------ rooms
create table chat_rooms (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  -- What the room is for, shown under its name. A room called "Facade" with
  -- no purpose becomes three rooms called "Facade" within a month.
  purpose     text,
  -- The existing primitive, not a members table. A room's audience is a
  -- record's audience, and a `chat_room_members` table would be the fifth
  -- visibility rule this product deliberately does not have.
  visibility  jsonb not null default '{"mode":"project"}'::jsonb
              check (visibility_is_valid(visibility)),
  created_by  uuid not null references profiles(id),
  created_at  timestamptz not null default now(),
  -- Finished, not gone. A room is never deleted: closing a conversation must
  -- not remove it, for the same reason a message cannot be deleted.
  archived_at timestamptz,
  unique (project_id, name)
);

create index on chat_rooms (project_id) where archived_at is null;

alter table chat_rooms enable row level security;

-- One predicate for the room and for everything posted in it, so the two can
-- never disagree about who is in the conversation. Definer because the
-- comments policy below has to resolve a room the reader may not be able to
-- select, and reading it inline would recurse through this table's own policy.
create or replace function can_see_room(p_room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from chat_rooms r
    where r.id = p_room
      -- The creator is passed as the raiser: whoever opened a room is never
      -- locked out of it, the same rule every other record with an audience
      -- follows.
      and can_see(r.project_id, r.visibility, r.created_by, null));
$$;

grant execute on function can_see_room(uuid) to authenticated;

/** Readable, and still open. Posting into an archived room is refused; reading
 *  one never is. */
create or replace function can_post_to_room(p_room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from chat_rooms r
    where r.id = p_room and r.archived_at is null)
    and can_see_room(p_room);
$$;

grant execute on function can_post_to_room(uuid) to authenticated;

/**
 * Can somebody *else* read this room?
 *
 * Asked in exactly one place: deciding whether naming a person in a message is
 * a mention or a notification about something they cannot open. The obvious
 * implementation is to reimplement `can_see()` for an arbitrary profile, which
 * is a second copy of the one rule this product states once and is how the two
 * eventually disagree. So it asks the same function, with the claim set to the
 * person being asked about -- the same mechanism Phase 16's digest uses, for
 * the same reason.
 *
 * Not granted to `authenticated`: a probe for whether a named person can read
 * a room is a question about somebody else's access, and answering it to
 * anyone who asks is a small directory of who is in what.
 */
create or replace function can_see_room_as(p_room uuid, p_profile uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_claims text; v_out boolean;
begin
  -- auth.uid() prefers `request.jwt.claim.sub` where it is set, so this would
  -- answer for the caller rather than the person asked about. PostgREST has
  -- not set it since v10 and nothing here does, but a silent wrong answer to
  -- "who can read this" is the worst shape this function could fail in.
  if coalesce(current_setting('request.jwt.claim.sub', true), '') <> '' then
    raise exception 'request.jwt.claim.sub is set; cannot resolve another person''s access'
      using errcode = '0A000';
  end if;

  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_profile)::text, true);
  v_out := can_see_room(p_room);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return v_out;
end;
$$;

revoke execute on function can_see_room_as(uuid, uuid) from public, anon, authenticated;

create policy chat_rooms_select on chat_rooms
  for select to authenticated
  using (can_see(project_id, visibility, created_by, null));

create policy chat_rooms_insert on chat_rooms
  for insert to authenticated
  with check (can_see_project(project_id) and created_by = auth.uid());

-- Whoever opened it, or somebody who can already see everything anyway.
create policy chat_rooms_update on chat_rooms
  for update to authenticated
  using (created_by = auth.uid()
         or exists (select 1 from projects p
                    where p.id = chat_rooms.project_id
                      and (is_account_admin(p.organisation_id) or is_project_admin(p.id))))
  with check (created_by = auth.uid()
              or exists (select 1 from projects p
                         where p.id = chat_rooms.project_id
                           and (is_account_admin(p.organisation_id) or is_project_admin(p.id))));

-- No delete policy at all: a room is archived.
grant select, insert on chat_rooms to authenticated;
-- RLS decides rows; grants decide columns. `project_id` and `created_by` are
-- outside the update grant, because the row policy checks the row being
-- written rather than the one it started from and would happily accept a room
-- moved into another project.
grant update (name, purpose, visibility, archived_at) on chat_rooms to authenticated;

-- --------------------------------------------------------------- messages
-- Messages reuse `comments`. It is already a threaded message table with an
-- author, a parent, a visibility and an `edited_at`; a chat room is what it
-- was always shaped for, and a second message table would be a second place
-- for a message to be.

-- A withdrawal, not a delete. "The trail is not yours to edit" is a claim on
-- the public site, and WhatsApp-style delete-for-everyone would contradict it.
-- The row keeps its author, its time and its text; it gains a mark saying to
-- disregard it. The people who can still open it are exactly the people who
-- had already read it, so nothing is disclosed by keeping it -- what changes
-- is that the conversation now records the retraction as well as the message.
alter table comments
  add column deleted_at timestamptz,
  add column deleted_by uuid references profiles(id),
  -- Who was named in it. Held as ids rather than parsed out of the text at
  -- read time: a name typed into a message is not a person, and a mention
  -- that resolves differently tomorrow is one nobody can act on.
  add column mentions uuid[] not null default '{}';

comment on column comments.deleted_at is
  'Withdrawn. The row and its body survive: this marks it as retracted, and no '
  'role holds update on it.';

-- The three new columns are outside the update grant, which already names only
-- `body` and `edited_at`. withdraw_message() is the only path to them.

-- Room messages carry the room's audience, not their own.
--
-- This is the whole of the visibility question for the module. A message
-- defaults to `{"mode":"project"}` like every comment; left to itself, a
-- message in a `named` room would therefore be readable by the entire project
-- and the room's audience would mean nothing. So for a room row the room
-- decides, and the message's own column is not consulted at all.
drop policy comments_select on comments;
create policy comments_select on comments
  for select to authenticated
  using (
    case when entity_type = 'room' then can_see_room(entity_id)
         else can_see(project_id, visibility, author_id, null) end);

drop policy comments_insert on comments;
create policy comments_insert on comments
  for insert to authenticated
  with check (
    can_see_project(project_id) and author_id = auth.uid()
    and (entity_type <> 'room' or can_post_to_room(entity_id)));

-- An edit still shows as edited; a withdrawn message is finished.
drop policy comments_update on comments;
create policy comments_update on comments
  for update to authenticated
  using (author_id = auth.uid() and deleted_at is null)
  with check (author_id = auth.uid() and deleted_at is null);

-- Delete stays exactly as it was for every other kind of comment, and is
-- refused outright for a room. Nothing here is a UI decision: a delete sent
-- straight through PostgREST is refused by the policy.
drop policy comments_delete on comments;
create policy comments_delete on comments
  for delete to authenticated
  using (
    entity_type <> 'room'
    and (author_id = auth.uid()
         or exists (select 1 from projects p
                    where p.id = comments.project_id
                      and is_account_staff(p.organisation_id))));

create index on comments (entity_id, created_at)
  where entity_type = 'room';

/** Withdraw a message. The author, or somebody who can already see the whole
 *  project: a room needs a way to retract something posted by a person who has
 *  since left, and that is an admin act rather than an impersonation. */
create or replace function withdraw_message(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select c.*, p.organisation_id into r
  from comments c join projects p on p.id = c.project_id
  where c.id = p_id;

  if not found or not can_see_room(r.entity_id) then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;
  if r.entity_type <> 'room' then
    raise exception 'Only a room message is withdrawn; a comment is deleted'
      using errcode = '22023';
  end if;
  if r.deleted_at is not null then
    return;  -- Idempotent: withdrawing twice is not an error, it is a no-op.
  end if;
  if not (r.author_id = auth.uid()
          or is_account_admin(r.organisation_id)
          or is_project_admin(r.project_id)) then
    raise exception 'Not yours to withdraw' using errcode = '42501';
  end if;

  update comments set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
end;
$$;

grant execute on function withdraw_message(uuid) to authenticated;

-- ------------------------------------------------------------ who is here
/**
 * Who can read this room, stated rather than enumerated.
 *
 * The temptation is to return a list of people, which would mean reimplementing
 * `can_see()` for an arbitrary profile rather than the caller -- a second copy
 * of the one rule this product deliberately states once. So the room reports
 * its audience: the mode, the people and companies it names, and who opened
 * it. The page turns that into a sentence.
 *
 * The sentence always ends with administrators, because it is always true and
 * it is the honest half: an account admin and a project admin read every room,
 * which is exactly why this module has rooms and not direct messages.
 */
create or replace function room_audience(p_room uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not can_see_room(p_room) then null else (
    select jsonb_build_object(
      'mode', coalesce(r.visibility->>'mode', 'project'),
      'people', coalesce((
        select jsonb_agg(pr.name order by pr.name)
        from jsonb_array_elements_text(coalesce(r.visibility->'people', '[]'::jsonb)) x
        join profiles pr on pr.id = x.value::uuid), '[]'::jsonb),
      'companies', coalesce((
        select jsonb_agg(c.name order by c.name)
        from jsonb_array_elements_text(coalesce(r.visibility->'companies', '[]'::jsonb)) x
        join companies c on c.id = x.value::uuid
        where c.project_id = r.project_id), '[]'::jsonb),
      'opened_by', (select pr.name from profiles pr where pr.id = r.created_by))
    from chat_rooms r where r.id = p_room) end;
$$;

grant execute on function room_audience(uuid) to authenticated;
