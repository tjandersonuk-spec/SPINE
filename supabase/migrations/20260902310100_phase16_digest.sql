-- The rule that governs this whole phase, made structural.
--
-- "Nothing in an email the recipient could not see in the app" is easy to say
-- and hard to keep, because the usual way to build a digest is a job running
-- with full database access that assembles the message and is careful about
-- what it includes. Careful is a promise. One forgotten join later it is a
-- consultant reading a rival's overdue drawings in their inbox.
--
-- So no email is assembled that way. `my_week()` is an ordinary invoker
-- function keyed on auth.uid(), exactly like the pages: it is what the signed
-- in person can see, because RLS says so. `build_digest()` then becomes that
-- person -- role and claim both -- and calls it. The email is not a careful
-- copy of what they can see; it is the same query.
--
-- It also means anybody can read their own digest in the application before it
-- is sent, from the same function, and a test can assert the two are identical.

-- ------------------------------------------------------------- my week
-- Invoker on purpose. A definer here would run as the owner, RLS would be off,
-- and the guarantee above would be a comment rather than a mechanism.
create or replace function my_week()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'generated_at', now(),
    -- What is waiting on me, across every project I am on. Keyed on auth.uid()
    -- in its own right, which is the opposite of report_attention() and is
    -- correct here: a digest is read by the person it is addressed to.
    'waiting', coalesce((
      select jsonb_agg(jsonb_build_object(
               'project', d.project_name, 'project_id', d.project_id,
               'kind', d.kind, 'reference', d.reference, 'title', d.title,
               'due', d.due) order by d.urgency desc, d.due nulls last)
      from my_decisions() d), '[]'::jsonb),
    -- Anything of mine that has gone past its date. The same view the issues
    -- page reads, so the two cannot disagree about what "overdue" means.
    'overdue', coalesce((
      select jsonb_agg(jsonb_build_object(
               'project_id', i.project_id, 'reference', i.reference,
               'title', i.title, 'due', i.due) order by i.due)
      from v_issues i
      join project_people pp on pp.id = i.person_id
      where i.status = 'Open' and i.overdue and pp.profile_id = auth.uid()), '[]'::jsonb),
    -- An invitation is the one thing in here that is not about a project, and
    -- the one thing that cannot be switched off.
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'account', v.account_name, 'token', v.token))
      from my_pending_invitations() v), '[]'::jsonb)
  );
$$;

grant execute on function my_week() to authenticated;

-- ------------------------------------------------------------- as them
-- The impersonation, and the reason it is built the way it is.
--
-- The obvious approach -- a security definer function that does `set role
-- authenticated` -- is not available: PostgreSQL refuses to let a
-- security-definer function change the role at all. And a definer owned by the
-- superuser is exactly what must be avoided here, because RLS does not apply
-- to it: every policy would be bypassed and the digest would quietly contain
-- rows the recipient cannot see.
--
-- So the function is owned by a role that RLS *does* apply to. `notifier` is a
-- member of `authenticated`, holds no BYPASSRLS and owns no table, so every
-- policy written `to authenticated` matches it and is enforced against it. The
-- claim is set so auth.uid() answers as the recipient, and what comes back is
-- what that person could load in the application -- not because the query was
-- careful, but because the same policies ran.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'notifier') then
    create role notifier nologin inherit;
  end if;
  grant authenticated to notifier;
  -- Handing a function to another role requires being able to `set role` to
  -- it: PostgreSQL 16 refuses the `alter ... owner to` below with "must be
  -- able to SET ROLE" otherwise. A local database runs migrations as a
  -- superuser, for which this is redundant; the hosted SQL editor runs as
  -- `postgres`, which is not one, and the migration fails at that line
  -- without this. `current_user` rather than a named role so it holds
  -- wherever the migration is applied from.
  execute format('grant notifier to %I', current_user);
end $$;

create or replace function build_digest(p_profile uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_out jsonb;
begin
  -- Only the claim. No role switch: see above, and the owner below is what
  -- makes the policies apply.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_profile)::text, true);
  select my_week() into v_out;
  return v_out;
end;
$$;

-- The whole guarantee rests on this line. Owned by the superuser, this
-- function bypasses RLS and the digest becomes a promise rather than a
-- mechanism.
--
-- Handing an object over also requires the incoming owner to hold `create` on
-- the schema it sits in, which `notifier` has no other reason to hold: it owns
-- nothing and creates nothing. So it is granted for the one statement and
-- taken straight back. Ownership, once set, does not depend on it -- including
-- for the `create or replace` above when this migration is re-run, which
-- succeeds because the runner is a member of the owning role rather than
-- because the role can still create.
grant create on schema public to notifier;
alter function build_digest(uuid) owner to notifier;
revoke create on schema public from notifier;

revoke execute on function build_digest(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------- queueing
-- Everything below writes to the ledger and nothing sends: the sender reads
-- the queue. Splitting it this way means a provider outage loses no message,
-- and a message is composed exactly once however many times the job runs.

/** One digest per person who wants one and has something in it. */
create or replace function queue_digests(p_date date default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_day date := coalesce(p_date, current_date);
  v_n int := 0;
  r record;
  v_digest jsonb;
begin
  for r in
    select p.id, p.email, p.name from profiles p
    where p.email is not null and wants_notification(p.id, 'digest')
  loop
    v_digest := build_digest(r.id);

    -- Nothing waiting and nothing overdue is not worth an email. A weekly
    -- message that is usually empty teaches people to ignore the one that is
    -- not.
    continue when jsonb_array_length(v_digest -> 'waiting') = 0
              and jsonb_array_length(v_digest -> 'overdue') = 0;

    insert into notifications (profile_id, email, kind, subject, body, dedupe_key)
    values (
      r.id, r.email, 'digest',
      'Your week: ' || jsonb_array_length(v_digest -> 'waiting') || ' waiting, '
        || jsonb_array_length(v_digest -> 'overdue') || ' overdue',
      v_digest::text,
      'digest:' || r.id || ':' || v_day)
    on conflict (dedupe_key) do nothing;

    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;

/** The emailed half of an invitation. Phase 1 built the record and the accept
 *  page; this is the message that was never sent. It obeys no preference: see
 *  the comment on notification_preferences. */
create or replace function queue_invitations()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0;
begin
  insert into notifications (profile_id, email, kind, subject, body, dedupe_key)
  select
    p.id, i.email, 'invitation',
    'You have been invited to ' || o.name || ' on Spine',
    jsonb_build_object(
      'organisation', o.name, 'token', i.token,
      'role', i.role, 'project_role', i.project_role,
      'expires_at', i.expires_at,
      'invited_by', (select name from profiles where id = i.invited_by))::text,
    'invitation:' || i.id
  from invitations i
  join organisations o on o.id = i.organisation_id
  -- The addressee may have no login at all, which is the normal case for the
  -- first person at a consultant. The row is still queued; profile_id is null.
  left join profiles p on lower(p.email) = lower(i.email)
  where i.accepted_at is null and i.revoked_at is null and i.declined_at is null
    and i.expires_at > now()
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

/** Something has been given to you. Keyed on the record and the person, so it
 *  is sent when the assignment happens and not again -- and again if it is
 *  later reassigned to somebody else, which is a different message. */
create or replace function queue_assignments()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0;
begin
  insert into notifications (profile_id, email, kind, subject, body, project_id, dedupe_key)
  select
    pp.profile_id, pr.email, 'assignment',
    i.reference || ' — ' || i.title,
    jsonb_build_object('project', p.name, 'reference', i.reference,
                       'title', i.title, 'due', i.due)::text,
    i.project_id,
    'assignment:' || i.id || ':' || pp.profile_id
  from v_issues i
  join project_people pp on pp.id = i.person_id
  join profiles pr on pr.id = pp.profile_id
  join projects p on p.id = i.project_id
  where i.status = 'Open'
    and pr.email is not null
    and wants_notification(pp.profile_id, 'assignment')
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

/** Past its date. The due date is in the key, so moving the programme and
 *  missing the new date is a new message rather than a silence. */
create or replace function queue_overdue()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0;
begin
  insert into notifications (profile_id, email, kind, subject, body, project_id, dedupe_key)
  select
    pp.profile_id, pr.email, 'overdue',
    'Overdue: ' || i.reference || ' — ' || i.title,
    jsonb_build_object('project', p.name, 'reference', i.reference,
                       'title', i.title, 'due', i.due)::text,
    i.project_id,
    'overdue:' || i.id || ':' || pp.profile_id || ':' || i.due
  from v_issues i
  join project_people pp on pp.id = i.person_id
  join profiles pr on pr.id = pp.profile_id
  join projects p on p.id = i.project_id
  where i.status = 'Open' and i.overdue and i.due is not null
    and pr.email is not null
    and wants_notification(pp.profile_id, 'overdue')
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

/** What the sender asks for, and what it reports back. Both definer, both
 *  closed to `authenticated`: a person who could mark their own notification
 *  sent could stop it being sent at all. */
create or replace function pending_notifications(p_limit int default 200)
returns setof notifications language sql security definer set search_path = public as $$
  select * from notifications
  where sent_at is null and failed_at is null
  order by queued_at
  limit greatest(1, least(p_limit, 1000));
$$;

create or replace function resolve_notification(p_id uuid, p_error text default null)
returns void language sql security definer set search_path = public as $$
  update notifications set
    sent_at   = case when p_error is null then now() end,
    failed_at = case when p_error is null then null else now() end,
    error     = p_error
  where id = p_id and sent_at is null;
$$;

/** One call for the scheduled job, so the order lives here rather than in the
 *  Edge Function, where it would be a second place to change it. */
create or replace function queue_notifications(p_date date default null)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'invitations', queue_invitations(),
    'assignments', queue_assignments(),
    'overdue',     queue_overdue(),
    'digests',     queue_digests(p_date));
$$;

revoke execute on function queue_digests(date), queue_invitations(), queue_assignments(),
  queue_overdue(), queue_notifications(date), pending_notifications(int),
  resolve_notification(uuid, text)
  from public, anon, authenticated;

-- And granted back to the one caller that needs them. Revoking from `public`
-- removes the default execute every role had, `service_role` included -- so
-- without this the scheduled sender is refused by its own database, and
-- nothing says so until the job runs against a real project.
--
-- Only the three the Edge Function calls directly. The four queue_* functions
-- underneath are reached through queue_notifications(), which is a definer and
-- runs as its owner, so they stay closed to everybody.
grant execute on function queue_notifications(date), pending_notifications(int),
  resolve_notification(uuid, text) to service_role;
