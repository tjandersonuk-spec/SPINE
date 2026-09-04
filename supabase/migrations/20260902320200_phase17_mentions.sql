-- Phase 17: being named in a room.
--
-- Phase 16 left this out deliberately -- "comment @mentions do not notify;
-- that belongs with rooms, where mentions will matter most". This is that.
--
-- A room is a place people talk past each other by default. Naming somebody is
-- the one act in it that is addressed, and an addressed message that reaches
-- nobody is the reason the conversation goes back to WhatsApp.

alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('invitation','assignment','overdue','digest','mention'));

-- Unlike an invitation, this one is a preference: being named in a room is
-- work correspondence, not consent, and somebody in forty rooms has a real
-- reason to turn it off.
alter table notification_preferences
  add column mentions boolean not null default true;

grant update (assignments, overdue, digest, mentions, paused)
  on notification_preferences to authenticated;

create or replace function wants_notification(p_profile uuid, p_kind text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_kind = 'invitation' then true
    else coalesce(
      (select not p.paused and case p_kind
         when 'assignment' then p.assignments
         when 'overdue'    then p.overdue
         when 'digest'     then p.digest
         when 'mention'    then p.mentions
         else false end
       from notification_preferences p where p.profile_id = p_profile),
      p_kind in ('assignment','overdue','digest','mention'))
  end;
$$;

-- The row type gains a column, so the old function is dropped rather than
-- replaced: PostgreSQL refuses to change the shape of an existing one.
drop function if exists my_notification_preferences();

create or replace function my_notification_preferences()
returns table (assignments boolean, overdue boolean, digest boolean,
               mentions boolean, paused boolean)
language sql stable security definer set search_path = public as $$
  select coalesce(p.assignments, true), coalesce(p.overdue, true),
         coalesce(p.digest, true), coalesce(p.mentions, true),
         coalesce(p.paused, false)
  from (select auth.uid() as id) me
  left join notification_preferences p on p.profile_id = me.id
  where me.id is not null;
$$;

grant execute on function my_notification_preferences() to authenticated;

drop function if exists set_notification_preferences(boolean, boolean, boolean, boolean);

create or replace function set_notification_preferences(
  p_assignments boolean, p_overdue boolean, p_digest boolean,
  p_mentions boolean, p_paused boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  insert into notification_preferences
    (profile_id, assignments, overdue, digest, mentions, paused)
  values (auth.uid(), p_assignments, p_overdue, p_digest, p_mentions, p_paused)
  on conflict (profile_id) do update set
    assignments = excluded.assignments, overdue = excluded.overdue,
    digest = excluded.digest, mentions = excluded.mentions,
    paused = excluded.paused, updated_at = now();
end;
$$;

grant execute on function set_notification_preferences(
  boolean, boolean, boolean, boolean, boolean) to authenticated;

/** One message per person named, per message. Bounded to the last week so
 *  switching the job on does not mail out every mention the product has ever
 *  recorded; the dedupe key stops it going twice after that. */
create or replace function queue_mentions()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0;
begin
  insert into notifications (profile_id, email, kind, subject, body, project_id, dedupe_key)
  select
    m.who, pr.email, 'mention',
    a.name || ' named you in ' || r.name,
    jsonb_build_object('project', p.name, 'room', r.name, 'author', a.name,
                       'said', left(c.body, 500))::text,
    c.project_id,
    'mention:' || c.id || ':' || m.who
  from comments c
  cross join lateral unnest(c.mentions) as m(who)
  join chat_rooms r on r.id = c.entity_id
  join projects p on p.id = c.project_id
  join profiles a on a.id = c.author_id
  join profiles pr on pr.id = m.who
  where c.entity_type = 'room'
    and c.deleted_at is null
    and c.created_at > now() - interval '7 days'
    and pr.email is not null
    -- Naming yourself is not a message.
    and m.who <> c.author_id
    and wants_notification(m.who, 'mention')
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function queue_mentions() from public, anon, authenticated;

create or replace function queue_notifications(p_date date default null)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'invitations', queue_invitations(),
    'assignments', queue_assignments(),
    'overdue',     queue_overdue(),
    'mentions',    queue_mentions(),
    'digests',     queue_digests(p_date));
$$;

revoke execute on function queue_notifications(date) from public, anon, authenticated;
grant execute on function queue_notifications(date) to service_role;
