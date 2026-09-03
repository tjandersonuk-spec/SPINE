-- Phase 7, part one -- the change log.
--
-- One row per field that changed, written by a trigger rather than by the code
-- that made the change. Application-side logging records what the developer
-- remembered to log; a trigger records what actually happened, including the
-- edit somebody made straight through PostgREST.

create table change_log (
  id bigserial primary key,
  project_id uuid not null references projects(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null check (action in ('insert','update','delete')),
  -- Null on an insert or a delete: the row as a whole is the event, and
  -- listing forty columns of "from nothing" is noise.
  field text,
  value_from text,
  value_to text,
  created_at timestamptz not null default now()
);
create index on change_log (project_id, created_at desc);
create index on change_log (entity_type, entity_id, created_at desc);

-- Columns nobody wants to read a diff of. Timestamps that move on every write
-- would bury the field that actually changed.
create or replace function change_log_is_noise(p_field text)
returns boolean
language sql
immutable
as $$
  select p_field in (
    'id', 'created_at', 'updated_at', 'last_synced', 'edited_at',
    'imported_at', 'added_at', 'watched_at', 'last_import_id');
$$;

-- The generic trigger. TG_ARGV[0] names the column holding the project, so the
-- same function serves every table rather than one near-identical copy each.
create or replace function log_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project uuid;
  v_col text := coalesce(tg_argv[0], 'project_id');
  v_old jsonb;
  v_new jsonb;
  k text;
  v_from text;
  v_to text;
begin
  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_project := (v_old ->> v_col)::uuid;
    if v_project is not null then
      insert into change_log (project_id, actor_id, entity_type, entity_id, action)
      values (v_project, auth.uid(), tg_table_name, (v_old->>'id')::uuid, 'delete');
    end if;
    return old;
  end if;

  v_new := to_jsonb(new);
  v_project := (v_new ->> v_col)::uuid;
  if v_project is null then return new; end if;

  if tg_op = 'INSERT' then
    insert into change_log (project_id, actor_id, entity_type, entity_id, action)
    values (v_project, auth.uid(), tg_table_name, (v_new->>'id')::uuid, 'insert');
    return new;
  end if;

  -- UPDATE: one row per field that actually moved. A write that changes nothing
  -- logs nothing, so the trail stays readable.
  v_old := to_jsonb(old);
  for k in select jsonb_object_keys(v_new) loop
    if change_log_is_noise(k) then continue; end if;
    v_from := v_old ->> k;
    v_to := v_new ->> k;
    if v_from is distinct from v_to then
      insert into change_log (project_id, actor_id, entity_type, entity_id,
                              action, field, value_from, value_to)
      values (v_project, auth.uid(), tg_table_name, (v_new->>'id')::uuid,
              'update', k, v_from, v_to);
    end if;
  end loop;
  return new;
end;
$$;

-- Attached to the tables people argue about. Every one carries project_id
-- directly; a join table like drm_roles is logged through its parent when the
-- parent changes, rather than producing rows nobody can read.
do $$
declare t text;
begin
  foreach t in array array[
    'companies', 'project_people', 'drm_items', 'drawing_register', 'drawing_packs',
    'issues', 'meetings', 'evidence', 'transmittals', 'programme_tasks',
    'bep_fields', 'bep_revision_rules'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on %I
       for each row execute function log_changes()', 'log_' || t, t);
  end loop;
end $$;

-- What changed, with the actor's name resolved. A trail showing a uuid is a
-- trail nobody reads.
create or replace view v_change_log as
select
  l.id, l.project_id, l.entity_type, l.entity_id, l.action, l.field,
  l.value_from, l.value_to, l.created_at,
  l.actor_id,
  p.name as actor_name
from change_log l
left join profiles p on p.id = l.actor_id;

alter table change_log enable row level security;

-- Everyone on the project reads it. A change log only some people can see is
-- not a record of what happened, it is a record of what someone was shown.
create policy change_log_select on change_log for select to authenticated
using (can_see_project(project_id));

-- No insert, update or delete policy for anyone, and no grant beyond select:
-- the trail is written by the trigger and cannot be edited afterwards, by
-- anybody, which is the only thing that makes it worth keeping.
grant select on change_log to authenticated;

alter view v_change_log set (security_invoker = on);
grant select on v_change_log to authenticated;
