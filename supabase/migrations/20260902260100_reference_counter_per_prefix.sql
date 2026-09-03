-- One counter per prefix, which is what the rule always said.
--
-- `next_reference(project, kind, prefix)` keyed its counter on the *kind*, and
-- two callers reach it with different kinds and the same prefix:
--
--   raise_issue()    next_reference(p, 'issue_TSK', 'TSK')
--   realise_risk()   next_reference(p, 'TSK',       'TSK')
--
-- So a project could raise twelve tasks, reach TSK-012, then realise a risk and
-- be handed TSK-001 from a counter that had never been used -- which is not a
-- confusing number, it is a unique-constraint violation and a failed button.
-- The same shape sits under 'change'/'CHG', 'pack'/'PK' and
-- 'transmittal'/'TX': each happens to have one caller today, and each would
-- collide the moment it gained a second.
--
-- The fix is to key on the prefix, since the prefix is what has to be unique.
-- The `p_kind` argument stays in the signature and is no longer read: removing
-- it would mean re-bodying the five functions that call it, and a documented
-- vestigial argument is cheaper and safer than five rewrites that could each
-- go wrong. Callers may pass anything; only the prefix decides the counter.

-- Existing counters first, or the change hands out numbers that are already
-- taken. Each old key folds into its prefix, keeping the higher value.
insert into project_sequences (project_id, kind, last_value)
select s.project_id, m.prefix, max(s.last_value)
from project_sequences s
join (values
  ('issue_TSK','TSK'), ('issue_RFI','RFI'),
  ('transmittal','TX'), ('pack','PK'), ('change','CHG')
) as m(old_kind, prefix) on m.old_kind = s.kind
group by s.project_id, m.prefix
on conflict (project_id, kind) do update
  set last_value = greatest(project_sequences.last_value, excluded.last_value);

delete from project_sequences
where kind in ('issue_TSK','issue_RFI','transmittal','pack','change');

create or replace function next_reference(p_project uuid, p_kind text, p_prefix text)
returns text language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  -- Keyed on the prefix. p_kind is accepted and ignored: see the migration
  -- header. Two callers using one prefix now share one counter, which is the
  -- only way the reference they produce can be unique.
  insert into project_sequences (project_id, kind, last_value)
  values (p_project, p_prefix, 1)
  on conflict (project_id, kind)
    do update set last_value = project_sequences.last_value + 1
  returning last_value into v_n;
  return p_prefix || '-' || lpad(v_n::text, 3, '0');
end;
$$;
