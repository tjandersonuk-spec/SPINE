-- The sample project gets its rooms, and deliberately not a conversation.
--
-- Every other section of the seed fills a page with something to disagree
-- about. This one cannot, and the reason is worth stating rather than leaving
-- as an omission somebody later "fixes".
--
-- A room message has an author, and an author is a `profiles` row -- a login.
-- The sample project's directory is thirty people with no login at all, which
-- is the normal case for a consultant's staff and is the whole point of the
-- directory being separate from membership. So the only person the seed could
-- write messages as is the account admin who ran it, and a facade coordination
-- thread in which one person says nine things to themselves is a worse fiction
-- than an empty room: it teaches the reader that this is what the module looks
-- like in use.
--
-- What the seed can do honestly is the part that is structural: the rooms
-- themselves, with the audiences a real job would have -- one the whole
-- project reads, and one only the contractor's own staff do. The page then
-- shows the list, the audience sentence at the top of each and the composer,
-- and every message written into it afterwards is real.
create or replace function seed_sample_rooms(p_project uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_by uuid; v_n int;
begin
  -- Tops up rather than refusing, like every other section: run it on an empty
  -- project and it fills everything, run it again and it fills only what is
  -- missing.
  if exists (select 1 from chat_rooms where project_id = p_project) then
    return 'Rooms already present; left as they are.';
  end if;

  -- Whoever is seeding. They are an account admin by the time this runs --
  -- seed_sample_data() checks it -- so they read both rooms either way.
  v_by := auth.uid();
  if v_by is null then return 'No signed-in person to open a room as.'; end if;

  insert into chat_rooms (project_id, name, purpose, visibility, created_by) values
    (p_project, 'Facade coordination',
     'Cladding interfaces, parapets and the unitised procurement route.',
     '{"mode":"project"}'::jsonb, v_by),
    (p_project, 'Commercial — internal',
     'Fee positions and consultant performance. Never leaves HBC.',
     '{"mode":"internal"}'::jsonb, v_by);

  select count(*) into v_n from chat_rooms where project_id = p_project;
  return format('Opened %s rooms, with no conversation in them on purpose.', v_n);
end;
$$;

revoke execute on function seed_sample_rooms(uuid) from public, anon, authenticated;

-- Into the one entry point. The per-area functions hold no grant of their own,
-- because a caller who could invoke them directly would be seeding a project
-- they may not be an admin of.
create or replace function seed_sample_data(p_project uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_out text[];
begin
  select organisation_id into v_org from projects where id = p_project;
  if v_org is null then raise exception 'no such project' using errcode = 'P0002'; end if;
  if not is_account_admin(v_org) then
    raise exception 'Only an account admin may load sample data' using errcode = '42501';
  end if;

  v_out := array[
    seed_sample_project(p_project),
    format('Loaded %s programme lines.', seed_sample_programme(p_project)),
    seed_sample_setup(p_project),
    seed_sample_design(p_project),
    seed_sample_materials(p_project),
    seed_sample_work(p_project),
    seed_sample_compliance(p_project),
    seed_sample_commercial(p_project),
    seed_sample_changes(p_project),
    seed_sample_rooms(p_project)
  ];

  -- The change log is written by a trigger, so seeding a two-year project in
  -- one transaction leaves three hundred entries all stamped the same second.
  -- That makes the change log page useless and, worse, makes every issue look
  -- touched today -- so gone_quiet() finds nothing however old the discussion
  -- is. Each entry is moved back to the date its own record carries. This is
  -- the seed correcting the timestamps on its own fiction, and it is the only
  -- place in the product that writes to change_log at all: no role holds
  -- insert, update or delete on it, and nothing outside this function reaches
  -- it except the trigger.
  update change_log l set created_at = e.at
  from (
    select 'issues' as t, id, raised_at as at from issues where project_id = p_project
    union all select 'drawing_register', id, added_on::timestamptz from drawing_register where project_id = p_project
    union all select 'companies', id, created_at from companies where project_id = p_project
    union all select 'project_people', id, created_at from project_people where project_id = p_project
    union all select 'drm_items', id, created_at from drm_items where project_id = p_project
    union all select 'meetings', id, created_at from meetings where project_id = p_project
    union all select 'transmittals', id, created_at from transmittals where project_id = p_project
    union all select 'drawing_packs', id, created_at from drawing_packs where project_id = p_project
  ) as e
  where l.project_id = p_project and l.entity_type = e.t and l.entity_id = e.id;

  -- One snapshot, for today, computed from the data above exactly as the
  -- nightly job would. Backdating a series would be fabricating figures about
  -- days that never happened, and a trend line drawn from them would be a
  -- stored number nobody could check -- which is the one thing that nightly
  -- table exists to avoid. The trend fills in from tomorrow.
  perform take_snapshot(p_project);

  -- Each section carries its own counter forward as it writes, because
  -- realise_risk() asks for a task number mid-run. This is the backstop, and it
  -- only ever raises a counter.
  perform sample_seq(p_project, 'TSK',
    (select count(*) from issues where project_id = p_project and reference like 'TSK-%'));
  perform sample_seq(p_project, 'RFI',
    (select count(*) from issues where project_id = p_project and reference like 'RFI-%'));
  perform sample_seq(p_project, 'CHG',
    (select count(*) from change_requests where project_id = p_project));
  perform sample_seq(p_project, 'PK',
    (select count(*) from drawing_packs where project_id = p_project));
  perform sample_seq(p_project, 'TX',
    (select count(*) from transmittals where project_id = p_project));
  perform sample_seq(p_project, 'RSK',
    (select count(*) from risks where project_id = p_project and reference like 'RSK-%'));
  perform sample_seq(p_project, 'OPP',
    (select count(*) from risks where project_id = p_project and reference like 'OPP-%'));
  perform sample_seq(p_project, 'WTY',
    (select count(*) from warranties where project_id = p_project));

  return array_to_string(v_out, ' ');
end;
$$;
