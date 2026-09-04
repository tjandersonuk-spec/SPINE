-- Phase 16: what may be sent, and what was.
--
-- Two tables and one rule. The rule is that an email may never contain
-- something its recipient could not see in the application, and the only way
-- to make that a guarantee rather than a promise a template keeps is to build
-- every message by running the application's own queries as the recipient.
-- That happens in the next migration; this one is the ledger it writes to and
-- the preferences it obeys.

-- ------------------------------------------------------------- preferences
-- An absent row means every default, which is on. These are working emails
-- about work somebody has been given, not marketing, and a product that
-- silently defaults them off is one where a task sits unread for a fortnight.
create table notification_preferences (
  profile_id  uuid primary key references profiles(id) on delete cascade,
  -- Something has been assigned to you, or answered for you.
  assignments boolean not null default true,
  -- Something you hold has gone past its date.
  overdue     boolean not null default true,
  -- The Monday summary, as an email.
  digest      boolean not null default true,
  -- One switch that wins over the other three, for a holiday or a handover.
  paused      boolean not null default false,
  updated_at  timestamptz not null default now()
);

-- There is deliberately no invitation preference.
--
-- An invitation is the one message that cannot be muted: it is how somebody
-- consents to join an account, and a person who has silently switched it off
-- has silently lost the ability to accept. It also frequently goes to somebody
-- with no profile at all, so there would be no row to read. `paused` does not
-- cover it either, and the settings page says so rather than leaving it to be
-- discovered.
comment on table notification_preferences is
  'Per-person email preferences. Invitations are absent on purpose: they cannot '
  'be switched off, because muting one removes the ability to consent.';

-- ------------------------------------------------------------- the ledger
-- Every message queued, sent or failed. Two jobs: nothing goes twice, and a
-- person can see what was sent to them without asking anybody.
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  -- Null for an invitation to somebody who has no login yet, which is the
  -- normal case for the first person at a consultant.
  profile_id  uuid references profiles(id) on delete cascade,
  email       text not null,
  kind        text not null check (kind in ('invitation','assignment','overdue','digest')),
  subject     text not null,
  body        text not null,
  -- What it was about, so a page can link back to it. Kept nullable: an
  -- invitation to an account is about no project.
  project_id  uuid references projects(id) on delete set null,
  -- The guarantee against sending twice. A retry after a provider timeout, a
  -- job that runs at 07:00 and again at 07:05, a backfill of a missed night:
  -- all of them recompute the same key and hit this constraint instead of
  -- mailing somebody the same thing again.
  dedupe_key  text not null unique,
  queued_at   timestamptz not null default now(),
  sent_at     timestamptz,
  failed_at   timestamptz,
  error       text,
  constraint notification_outcome_is_one_thing
    check (sent_at is null or failed_at is null)
);

create index on notifications (profile_id, queued_at desc);
-- The sender's own query: everything queued and not yet resolved, oldest first.
create index on notifications (queued_at) where sent_at is null and failed_at is null;

alter table notification_preferences enable row level security;
alter table notifications enable row level security;

-- ------------------------------------------------------------- policies
-- Your preferences are yours, and nobody else's business — not an account
-- admin's either. Whether somebody wants an email is not project data.
create policy notification_preferences_select on notification_preferences
  for select to authenticated using (profile_id = auth.uid());
create policy notification_preferences_insert on notification_preferences
  for insert to authenticated with check (profile_id = auth.uid());
create policy notification_preferences_update on notification_preferences
  for update to authenticated using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- You may read what was sent to you and nothing else. An administrator has no
-- read here on purpose: the body of a digest is project data belonging to its
-- recipient, and a mailbox somebody else can open is not a mailbox.
create policy notifications_select on notifications
  for select to authenticated using (profile_id = auth.uid());

-- ------------------------------------------------------------- grants
-- RLS decides rows; grants decide columns. A person writes their four
-- preferences and never `profile_id` — writing that would move somebody else's
-- settings, and the row policy would accept it because it checks the row being
-- written rather than the one it started from.
grant select, insert on notification_preferences to authenticated;
grant update (assignments, overdue, digest, paused, updated_at)
  on notification_preferences to authenticated;

-- The ledger is written by the sender alone. No insert, update or delete for
-- anybody: a record of what was sent that its subject could edit is a record
-- of what they would like to have been sent.
grant select on notifications to authenticated;

-- ------------------------------------------------------------- reading
-- One place that answers "does this person want this kind of email", so a
-- caller cannot forget the pause switch or mis-handle the absent row.
create or replace function wants_notification(p_profile uuid, p_kind text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    -- Never mutable, never absent: see the comment on the table.
    when p_kind = 'invitation' then true
    else coalesce(
      (select not p.paused and case p_kind
         when 'assignment' then p.assignments
         when 'overdue'    then p.overdue
         when 'digest'     then p.digest
         else false end
       from notification_preferences p where p.profile_id = p_profile),
      -- No row is not a decision to be left out.
      p_kind in ('assignment','overdue','digest'))
  end;
$$;

grant execute on function wants_notification(uuid, text) to authenticated;

-- The settings page needs the effective values, absent row included, without
-- reimplementing the default and eventually disagreeing with the function above.
create or replace function my_notification_preferences()
returns table (assignments boolean, overdue boolean, digest boolean, paused boolean)
language sql stable security definer set search_path = public as $$
  select coalesce(p.assignments, true), coalesce(p.overdue, true),
         coalesce(p.digest, true), coalesce(p.paused, false)
  from (select auth.uid() as id) me
  left join notification_preferences p on p.profile_id = me.id
  where me.id is not null;
$$;

grant execute on function my_notification_preferences() to authenticated;

create or replace function set_notification_preferences(
  p_assignments boolean, p_overdue boolean, p_digest boolean, p_paused boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  insert into notification_preferences (profile_id, assignments, overdue, digest, paused)
  values (auth.uid(), p_assignments, p_overdue, p_digest, p_paused)
  on conflict (profile_id) do update set
    assignments = excluded.assignments, overdue = excluded.overdue,
    digest = excluded.digest, paused = excluded.paused, updated_at = now();
end;
$$;

grant execute on function set_notification_preferences(boolean, boolean, boolean, boolean)
  to authenticated;
