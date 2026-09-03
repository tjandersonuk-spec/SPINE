-- Phase 6, part three -- meetings.

create table meetings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  reference text not null,
  title text not null check (btrim(title) <> ''),
  meeting_type text not null,
  meeting_date date not null,
  meeting_time time,
  location text,
  call_link text,
  chair_id uuid references project_people(id) on delete set null,
  status text not null default 'Draft' check (status in ('Draft','Issued')),
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, reference)
);
create index on meetings (project_id, meeting_date desc);

create table meeting_agenda_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  position int not null,
  heading text not null check (btrim(heading) <> ''),
  notes text,
  unique (meeting_id, position)
);

-- Who was there, who sent apologies, and who gets the minutes. This is also
-- what decides who can see the meeting: a meeting's audience is not a separate
-- concept from its attendance, so there is no visibility column here.
create table meeting_people (
  meeting_id uuid not null references meetings(id) on delete cascade,
  person_id uuid not null references project_people(id) on delete cascade,
  role text not null check (role in ('attendee','apology','distribution')),
  primary key (meeting_id, person_id)
);

-- Can the caller see this meeting? A person reaches it through the directory
-- row that carries their login, so someone in the directory with no account
-- yet appears on the list without gaining access to anything.
create or replace function can_see_meeting(p_meeting uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from meetings m
    join projects p on p.id = m.project_id
    where m.id = p_meeting
      and can_see_project(m.project_id)
      and (is_account_staff(p.organisation_id)
           or exists (select 1 from meeting_people mp
                      join project_people pp on pp.id = mp.person_id
                      where mp.meeting_id = m.id and pp.profile_id = auth.uid())));
$$;

grant execute on function can_see_meeting(uuid) to authenticated;
