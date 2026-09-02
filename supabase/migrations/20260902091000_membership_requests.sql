-- Adding someone to an account, asked for from below.
--
-- Two directions, and they are not the same act.
--
-- Top down: an account admin invites someone. They hold the commercial
-- relationship, so the invitation goes straight out.
--
-- Bottom up: anyone working on a project knows who is missing from it long
-- before an admin does, and should be able to say so. But a new member may
-- change what the account is billed for, so the person asking is proposing, not
-- deciding. The request lands with the account's admins, and only their
-- approval issues the invitation.
--
-- Note what this is not: it does not create a membership, and it does not
-- create an invitation either. Nothing reaches the person being discussed until
-- an admin approves, and even then the consent step is unchanged — they still
-- accept for themselves.

create table membership_requests (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  project_id      uuid references projects(id) on delete set null,
  email           text not null,
  person_name     text,
  proposed_role   text not null check (proposed_role in ('admin','internal','consultant','client')),
  proposed_project_role text check (proposed_project_role in ('project_admin','member')),
  note            text,
  requested_by    uuid not null references profiles(id) on delete cascade,
  status          text not null default 'pending'
                  check (status in ('pending','approved','declined','withdrawn')),
  reviewed_by     uuid references profiles(id),
  reviewed_at     timestamptz,
  review_note     text,
  invitation_id   uuid references invitations(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index membership_requests_org_idx on membership_requests (organisation_id, status);
-- One live request per address per account; answered ones may repeat.
create unique index membership_requests_one_pending
  on membership_requests (organisation_id, lower(email)) where status = 'pending';

alter table membership_requests enable row level security;

-- Visible to the account's admins (who must act on it) and to whoever raised it
-- (who is owed an answer). Not to the rest of the account, and never to the
-- person being proposed — they have not agreed to anything yet.
create policy membership_requests_select on membership_requests for select to authenticated
using (is_account_admin(organisation_id) or requested_by = auth.uid());

-- Raised only through request_membership(), which carries the guards.
create policy membership_requests_withdraw on membership_requests for update to authenticated
using (requested_by = auth.uid() and status = 'pending')
with check (requested_by = auth.uid() and status in ('pending','withdrawn'));

-- A table created after the grants migration receives nothing from it: `grant
-- on all tables` applies to the tables that exist when it runs. Every migration
-- that adds a table must state its own grants, and only the columns it means.
grant select on membership_requests to authenticated;
grant update (status) on membership_requests to authenticated;
-- No insert grant: requests are raised through request_membership() alone.

-- ---------------------------------------------------------------------------

create or replace function request_membership(
  p_project uuid, p_email text, p_role text,
  p_project_role text default 'member',
  p_person_name text default null, p_note text default null
) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_org uuid; v_id uuid;
begin
  select organisation_id into v_org from projects where id = p_project;
  if not found then raise exception 'no such project'; end if;

  -- anyone who works on the project may ask
  if not (is_account_staff(v_org)
          or exists (select 1 from project_members
                     where project_id = p_project and profile_id = auth.uid())) then
    raise exception 'not permitted';
  end if;
  if not account_is_live(v_org) then raise exception 'account is not active'; end if;
  if coalesce(trim(p_email), '') = '' then raise exception 'email is required'; end if;

  if exists (select 1 from organisation_members m join profiles pr on pr.id = m.profile_id
             where m.organisation_id = v_org and lower(pr.email) = lower(trim(p_email))) then
    raise exception 'that person is already a member of this account';
  end if;

  insert into membership_requests (organisation_id, project_id, email, person_name,
                                   proposed_role, proposed_project_role, note, requested_by)
  values (v_org, p_project, lower(trim(p_email)), nullif(trim(coalesce(p_person_name,'')),''),
          p_role, p_project_role, p_note, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Approval takes the reviewed role, not the proposed one: the admin decides what
-- the person costs, which is the whole reason the request exists.
create or replace function approve_membership_request(
  p_request uuid, p_role text default null, p_project_role text default null
) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare r membership_requests; v_role text; v_project_role text; v_invite uuid;
begin
  select * into r from membership_requests where id = p_request and status = 'pending';
  if not found then raise exception 'no pending request'; end if;
  if not is_account_admin(r.organisation_id) then raise exception 'not permitted'; end if;
  if not account_is_live(r.organisation_id) then raise exception 'account is not active'; end if;

  v_role := coalesce(p_role, r.proposed_role);
  v_project_role := coalesce(p_project_role, r.proposed_project_role, 'member');

  insert into invitations (scope, organisation_id, email, role, project_ids,
                           token, invited_by)
  values ('organisation', r.organisation_id, r.email, v_role,
          case when r.project_id is null then '{}'::uuid[] else array[r.project_id] end,
          new_invitation_token(), auth.uid())
  returning id into v_invite;

  update membership_requests set status = 'approved', reviewed_by = auth.uid(),
    reviewed_at = now(), invitation_id = v_invite,
    proposed_role = v_role, proposed_project_role = v_project_role
  where id = p_request;

  return v_invite;
end $$;

create or replace function decline_membership_request(p_request uuid, p_reason text)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare r membership_requests;
begin
  select * into r from membership_requests where id = p_request and status = 'pending';
  if not found then raise exception 'no pending request'; end if;
  if not is_account_admin(r.organisation_id) then raise exception 'not permitted'; end if;
  update membership_requests set status = 'declined', reviewed_by = auth.uid(),
    reviewed_at = now(), review_note = p_reason
  where id = p_request;
end $$;

-- What an admin has waiting, across every account they administer — this is what
-- the landing page shows them.
create or replace function my_membership_requests()
returns table (
  id uuid, organisation_id uuid, account_name text, project_name text,
  email text, person_name text, proposed_role text, proposed_project_role text,
  note text, requested_by_name text, created_at timestamptz
) language sql stable security definer
set search_path = public, pg_temp as $$
  select mr.id, mr.organisation_id, o.name, p.name, mr.email, mr.person_name,
         mr.proposed_role, mr.proposed_project_role, mr.note, asker.name, mr.created_at
  from membership_requests mr
  join organisations o on o.id = mr.organisation_id
  left join projects p on p.id = mr.project_id
  left join profiles asker on asker.id = mr.requested_by
  where mr.status = 'pending'
    and is_account_admin(mr.organisation_id)
    and o.status = 'active'
  order by mr.created_at
$$;

grant execute on function request_membership(uuid, text, text, text, text, text) to authenticated;
grant execute on function approve_membership_request(uuid, text, text) to authenticated;
grant execute on function decline_membership_request(uuid, text) to authenticated;
grant execute on function my_membership_requests() to authenticated;
