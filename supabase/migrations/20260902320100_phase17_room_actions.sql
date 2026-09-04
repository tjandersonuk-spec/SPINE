-- Phase 17: what a room does.
--
-- The previous migration is the audience. This is posting, reading, catching
-- up, and the one thing that makes a chat room part of the product rather than
-- a chat window bolted to it: turning an exchange into a task.

-- ------------------------------------------------------------ catching up
-- Where each person got to. Private to them: a room that showed who had read
-- what would change how people write in it, and read receipts are not a
-- record of anything.
create table room_reads (
  profile_id   uuid not null references profiles(id) on delete cascade,
  room_id      uuid not null references chat_rooms(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (profile_id, room_id)
);

alter table room_reads enable row level security;

create policy room_reads_own on room_reads
  for select to authenticated using (profile_id = auth.uid());
create policy room_reads_insert on room_reads
  for insert to authenticated with check (profile_id = auth.uid());
create policy room_reads_update on room_reads
  for update to authenticated using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

grant select, insert on room_reads to authenticated;
grant update (last_read_at) on room_reads to authenticated;

create or replace function mark_room_read(p_room uuid)
returns void language sql security definer set search_path = public as $$
  insert into room_reads (profile_id, room_id, last_read_at)
  select auth.uid(), p_room, now()
  where auth.uid() is not null and can_see_room(p_room)
  on conflict (profile_id, room_id) do update set last_read_at = now();
$$;

grant execute on function mark_room_read(uuid) to authenticated;

-- ------------------------------------------------------------- the rooms
/** Every room this person can read, with enough to draw the list: the last
 *  thing said, and how much of it they have not seen. */
create or replace function project_rooms(p_project uuid)
returns table (
  id uuid, name text, purpose text, mode text, archived boolean,
  last_message_at timestamptz, last_author text, last_body text, unread int)
language sql stable security invoker set search_path = public as $$
  select
    r.id, r.name, r.purpose,
    coalesce(r.visibility->>'mode', 'project'),
    r.archived_at is not null,
    m.last_at, m.last_author,
    -- A withdrawn message is not what the room last said.
    case when m.last_deleted then null else m.last_body end,
    coalesce((
      select count(*)::int from comments c
      where c.entity_type = 'room' and c.entity_id = r.id
        and c.author_id <> auth.uid()
        and c.created_at > coalesce(
          (select rr.last_read_at from room_reads rr
           where rr.room_id = r.id and rr.profile_id = auth.uid()),
          '-infinity'::timestamptz)), 0)
  from chat_rooms r
  left join lateral (
    select c.created_at as last_at, p.name as last_author,
           c.body as last_body, c.deleted_at is not null as last_deleted
    from comments c join profiles p on p.id = c.author_id
    where c.entity_type = 'room' and c.entity_id = r.id
    order by c.created_at desc limit 1) m on true
  where r.project_id = p_project
  order by r.archived_at nulls first, m.last_at desc nulls last, r.name;
$$;

grant execute on function project_rooms(uuid) to authenticated;

/** The messages themselves. Invoker, so the room's audience is applied by the
 *  select policy rather than by this function remembering to. */
create or replace function room_messages(p_room uuid, p_limit int default 200)
returns table (
  id uuid, author_id uuid, author text, body text, parent_id uuid,
  created_at timestamptz, edited_at timestamptz,
  deleted_at timestamptz, deleted_by text, mentions uuid[])
language sql stable security invoker set search_path = public as $$
  select c.id, c.author_id, a.name, c.body, c.parent_id,
         c.created_at, c.edited_at, c.deleted_at, d.name, c.mentions
  from comments c
  join profiles a on a.id = c.author_id
  left join profiles d on d.id = c.deleted_by
  where c.entity_type = 'room' and c.entity_id = p_room
  order by c.created_at
  limit greatest(1, least(p_limit, 1000));
$$;

grant execute on function room_messages(uuid, int) to authenticated;

-- ------------------------------------------------------------- posting
/** Post into a room. A definer only because `mentions` is outside the insert
 *  grant: a mention has to name somebody who can actually read the room, and
 *  that is checked here rather than trusted from the client. */
create or replace function post_message(
  p_room uuid, p_body text, p_parent uuid default null,
  p_mentions uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_id uuid; v_mentions uuid[];
begin
  select project_id into v_project from chat_rooms where id = p_room;
  if v_project is null or not can_see_room(p_room) then
    raise exception 'Room not found' using errcode = 'P0002';
  end if;
  if not can_post_to_room(p_room) then
    raise exception 'This room is archived' using errcode = '42501';
  end if;
  if btrim(coalesce(p_body, '')) = '' then
    raise exception 'A message needs something in it' using errcode = '22023';
  end if;

  -- Somebody who cannot read the room is not mentioned in it: the message
  -- would be a notification about something they then could not open, which
  -- is worse than not being told. Asked through the room's own predicate
  -- rather than a membership query that would agree with it only by accident.
  select coalesce(array_agg(distinct x), '{}')
    into v_mentions
  from unnest(coalesce(p_mentions, '{}')) x
  where can_see_room_as(p_room, x);

  insert into comments (project_id, entity_type, entity_id, author_id, body,
                        parent_id, mentions)
  values (v_project, 'room', p_room, auth.uid(), btrim(p_body), p_parent, v_mentions)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function post_message(uuid, text, uuid, uuid[]) to authenticated;

-- ------------------------------------------------------- exchange to task
-- The real workflow is not "this message is a task". It is "this whole
-- exchange is now an RFI", which is why the control takes a selection and the
-- quoted text goes into the task: the point of raising it is that the
-- conversation stops being the only place the decision lives.
alter table issues drop constraint issues_source_kind_check;
alter table issues add constraint issues_source_kind_check
  check (source_kind in ('irs','comment','rfi','meeting','chat'));

create or replace function raise_from_room(
  p_room uuid, p_messages uuid[], p_title text,
  p_kind text default 'chat', p_person uuid default null,
  p_task_uid text default null, p_offset int default 0,
  p_anchor text default 'finish', p_priority int default 50,
  p_rfi_question text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_project uuid; v_room_name text; v_quote text; v_first uuid; v_result jsonb;
begin
  select project_id, name into v_project, v_room_name from chat_rooms where id = p_room;
  if v_project is null or not can_see_room(p_room) then
    raise exception 'Room not found' using errcode = 'P0002';
  end if;
  if coalesce(array_length(p_messages, 1), 0) = 0 then
    raise exception 'Choose the messages this is about' using errcode = '22023';
  end if;
  if p_kind not in ('chat','rfi') then
    raise exception 'A room raises a task or an RFI' using errcode = '22023';
  end if;

  -- Only messages actually in this room, and only ones the caller can read --
  -- the ids arrive from a client and a selection spanning two rooms would
  -- quote a conversation the reader was never in.
  select string_agg(
           to_char(c.created_at, 'YYYY-MM-DD HH24:MI') || '  ' || a.name || E'\n' ||
           case when c.deleted_at is not null then '(withdrawn)' else c.body end,
           E'\n\n' order by c.created_at),
         min(c.id::text)::uuid
    into v_quote, v_first
  from comments c join profiles a on a.id = c.author_id
  where c.entity_type = 'room' and c.entity_id = p_room and c.id = any(p_messages);

  if v_quote is null then
    raise exception 'Those messages are not in this room' using errcode = 'P0002';
  end if;

  -- The earliest of the selection, not the lowest id: `origin_comment_id` is
  -- where the exchange started.
  select c.id into v_first from comments c
  where c.entity_type = 'room' and c.entity_id = p_room and c.id = any(p_messages)
  order by c.created_at limit 1;

  v_result := raise_issue(
    p_project := v_project, p_title := p_title, p_kind := p_kind,
    p_description := 'From the room "' || v_room_name || '":' || E'\n\n' || v_quote,
    p_person := p_person, p_task_uid := p_task_uid, p_offset := p_offset,
    p_anchor := p_anchor, p_priority := p_priority,
    p_rfi_question := p_rfi_question, p_origin_comment := v_first);

  -- Linked both ways: the task quotes the exchange, and the room says where
  -- the exchange went. Without this the conversation carries on underneath a
  -- task nobody in the room knows exists.
  insert into comments (project_id, entity_type, entity_id, author_id, body)
  values (v_project, 'room', p_room, auth.uid(),
          (v_result->>'reference') || ' was raised from this exchange: ' || btrim(p_title));

  return v_result;
end;
$$;

grant execute on function raise_from_room(
  uuid, uuid[], text, text, uuid, text, int, text, int, text) to authenticated;

-- --------------------------------------------------------------- the module
-- A bolt-on like every other: one catalogue row, a nav entry with the same
-- key, a RequireModule around the page. The owner's editor and project
-- settings render from the catalogue and need no change.
create or replace function module_catalogue()
returns table (key text, label text, "group" text, sort int)
language sql immutable as $$
  select * from (values
    ('preassessment', 'Pre-assessment',            'Pre-construction', 10),
    ('precon',        'Fee budget',                'Pre-construction', 11),
    ('client',        'Client requirements',       'Pre-construction', 12),
    ('directory',     'Directory',                 'Set up',           20),
    ('drm',           'Responsibility matrix',     'Set up',           21),
    ('scope',         'Scope of service',          'Set up',           22),
    ('bep',           'BEP',                       'Set up',           23),
    ('programme',     'Programme',                 'Set up',           24),
    ('docs',          'Drawing register',          'Design',           30),
    ('tx',            'Packs and transmittals',    'Design',           31),
    ('materials',     'Material samples',          'Design',           32),
    ('crs',           'Change requests',           'Design',           33),
    ('rooms',         'Project rooms',             'Collaboration',    35),
    ('planning',      'Planning conditions',       'Compliance',       40),
    ('bc',            'Building control',          'Compliance',       41),
    ('bsa',           'Building safety',           'Compliance',       42),
    ('breeam',        'BREEAM',                    'Compliance',       43),
    ('highways',      'Highways',                  'Compliance',       44),
    ('utilities',     'Utilities',                 'Compliance',       45),
    ('fees',          'Fees and cashflow',         'Commercial',       50),
    ('budget',        'Pre-construction budget',   'Commercial',       51),
    ('risk',          'Risk and opportunity',      'Commercial',       52),
    ('warranties',    'Warranties',                'Handover',         60),
    ('handover',      'Handover checklist',        'Handover',         61),
    ('gateways',      'Gateways',                  'Handover',         62),
    ('reports',       'Period reports',            'Reporting',        70),
    ('audit',         'Audit',                     'Reporting',        71)
  ) as t(key, label, "group", sort);
$$;

-- ------------------------------------------------------------- live delivery
-- Realtime, not a second piece of infrastructure. RLS is applied to the
-- replicated rows, so a subscriber is told about a message only if the room's
-- audience already lets them read it. The publication does not exist on a bare
-- Postgres, which is what the tests run against.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public'
         and tablename = 'comments') then
    alter publication supabase_realtime add table comments;
  end if;
end $$;
