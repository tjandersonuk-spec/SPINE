-- Phase 1 — pending invitations on the landing page.
--
-- An emailed link is not the only way to accept. Someone who already holds a
-- confirmed login should find the invitation waiting for them when they sign
-- in, because the email may never arrive, may be filtered, or may simply be
-- older than their patience.
--
-- The interesting part is the account name. Account isolation says a person
-- must never discover an account they are not a member of — but an invitation
-- is that account's admin deliberately naming this person, and consent means
-- nothing if you cannot see what you are consenting to. So the name is
-- disclosed, to the addressee alone, through a definer function rather than by
-- widening the policy on organisations.

alter table invitations add column if not exists declined_at timestamptz;
alter table invitations add column if not exists declined_by uuid references profiles(id);

create or replace function my_pending_invitations()
returns table (
  id uuid,
  scope text,
  token text,
  role text,
  project_role text,
  account_name text,
  project_name text,
  invited_by_name text,
  expires_at timestamptz
) language sql stable security definer
set search_path = public, pg_temp as $$
  select i.id, i.scope, i.token, i.role, i.project_role,
         o.name, pr.name, inviter.name, i.expires_at
  from invitations i
  join organisations o on o.id = i.organisation_id
  left join projects pr on pr.id = i.project_id
  left join profiles inviter on inviter.id = i.invited_by
  where lower(i.email) = (select lower(p.email) from profiles p where p.id = auth.uid())
    and i.accepted_at is null
    and i.revoked_at is null
    and i.declined_at is null
    and i.expires_at > now()
    -- a suspended or archived account cannot recruit
    and o.status = 'active'
  order by i.created_at
$$;

-- §1b: a person can decline or ignore an invite. Declining is recorded so the
-- admin can see it was answered rather than left to rot, and so the row does
-- not come back on the next sign-in.
create or replace function decline_invitation(p_token text)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare v invitations; v_email text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select lower(email) into v_email from profiles where id = auth.uid();

  select * into v from invitations where token = p_token;
  if not found then raise exception 'invitation not found'; end if;
  if lower(v.email) <> v_email then
    raise exception 'invitation was issued to a different address';
  end if;
  if v.accepted_at is not null then raise exception 'invitation already accepted'; end if;

  update invitations set declined_at = now(), declined_by = auth.uid() where id = v.id;
end $$;

-- accept_invitation() gains the declined check. Repeated verbatim otherwise,
-- because create or replace cannot patch a body.
create or replace function accept_invitation(p_token text)
returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare v invitations; v_email text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select email into v_email from profiles where id = auth.uid();

  select * into v from invitations where token = p_token;
  if not found then raise exception 'invitation not found'; end if;
  if v.accepted_at is not null then raise exception 'invitation already accepted'; end if;
  if v.revoked_at is not null then raise exception 'invitation revoked'; end if;
  if v.declined_at is not null then raise exception 'invitation was declined'; end if;
  if v.expires_at < now() then raise exception 'invitation expired'; end if;
  if lower(v_email) <> lower(v.email) then
    raise exception 'invitation was issued to a different address';
  end if;
  if not account_is_live(v.organisation_id) then
    raise exception 'account is not active';
  end if;

  if v.scope = 'organisation' then
    insert into organisation_members (organisation_id, profile_id, role, company_id)
    values (v.organisation_id, auth.uid(), v.role, v.company_id)
    on conflict (organisation_id, profile_id) do nothing;
    if array_length(v.project_ids, 1) is not null then
      insert into project_members (project_id, profile_id, added_by)
      select unnest(v.project_ids), auth.uid(), v.invited_by
      on conflict (project_id, profile_id) do nothing;
    end if;
  else
    -- re-check: the invitee may have left the account since the token was issued
    if not exists (
      select 1 from organisation_members
      where organisation_id = v.organisation_id and profile_id = auth.uid()
    ) then
      raise exception 'invitee is no longer a member of this account';
    end if;
    insert into project_members (project_id, profile_id, project_role, added_by)
    values (v.project_id, auth.uid(), v.project_role, v.invited_by)
    on conflict (project_id, profile_id) do nothing;
  end if;

  update invitations set accepted_at = now(), accepted_by = auth.uid() where id = v.id;
  return v.id;
end $$;

grant execute on function my_pending_invitations() to authenticated;
grant execute on function decline_invitation(text) to authenticated;
