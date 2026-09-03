-- An account can fork all five libraries, and edit the fork it owns.
--
-- Two things stood between an account and its own templates. There was no fork
-- function for the risk or warranty libraries, so those two could only ever be
-- read from the published set. And none of the five tables carried an UPDATE
-- grant, so even a forked row could be inserted and deleted but never edited --
-- which makes "your templates" a list you can burn down and retype rather than
-- one you can correct.
--
-- The policies were already right and are untouched: every write policy reads
-- `organisation_id is not null and is_account_admin(organisation_id)`, so a
-- tenant reaches its own fork and never the published rows, whatever grant sits
-- above it.
--
-- The grants are column-level on purpose. RLS decides rows; GRANTs decide
-- columns, and the column an account admin has no business writing is
-- `organisation_id` -- writing it would move a template into somebody else's
-- account, which the row policy would happily allow because it checks the row
-- they are writing rather than the one they started from. `id` is out for the
-- same reason. Everything else is the template's content and is theirs.

-- ---------------------------------------------------------------- forks
create or replace function fork_risk_templates(p_org uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not is_account_admin(p_org) then
    raise exception 'Only an account admin may take a copy' using errcode = '42501';
  end if;
  insert into risk_templates (organisation_id, reference, kind, title, description,
                              category, likelihood, sort_order)
  select p_org, t.reference, t.kind, t.title, t.description, t.category,
         t.likelihood, t.sort_order
  from risk_templates t
  where t.organisation_id is null
    -- Idempotent: forking twice brings in what is new and leaves the rest,
    -- including any edit already made to the fork.
    and not exists (select 1 from risk_templates f
                    where f.organisation_id = p_org and f.reference = t.reference);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function fork_warranty_templates(p_org uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not is_account_admin(p_org) then
    raise exception 'Only an account admin may take a copy' using errcode = '42501';
  end if;
  insert into warranty_templates (organisation_id, reference, drm_ref, title, description,
                                  period_years, beneficiary, form, sort_order)
  select p_org, t.reference, t.drm_ref, t.title, t.description, t.period_years,
         t.beneficiary, t.form, t.sort_order
  from warranty_templates t
  where t.organisation_id is null
    and not exists (select 1 from warranty_templates f
                    where f.organisation_id = p_org and f.reference = t.reference);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function fork_risk_templates(uuid) to authenticated;
grant execute on function fork_warranty_templates(uuid) to authenticated;

-- ---------------------------------------------------------------- read
-- The same "your fork, or the published set if you have none" rule the other
-- libraries already state once. Reading it in two places is how the two
-- eventually disagree about which library a project is loading from.
create or replace function account_risk_templates(p_org uuid)
returns setof risk_templates language sql stable security definer
set search_path = public as $$
  select * from risk_templates t
  where (case when exists (select 1 from risk_templates f where f.organisation_id = p_org)
              then t.organisation_id = p_org
              else t.organisation_id is null end)
  order by t.sort_order, t.reference;
$$;

create or replace function account_warranty_templates(p_org uuid)
returns setof warranty_templates language sql stable security definer
set search_path = public as $$
  select * from warranty_templates t
  where (case when exists (select 1 from warranty_templates f where f.organisation_id = p_org)
              then t.organisation_id = p_org
              else t.organisation_id is null end)
  order by t.sort_order, t.reference;
$$;

grant execute on function account_risk_templates(uuid) to authenticated;
grant execute on function account_warranty_templates(uuid) to authenticated;

-- ---------------------------------------------------------------- edit
-- Content columns only. `organisation_id` and `id` are deliberately absent.
grant update (type, reference, heading, title, prompt, discipline, sort_order)
  on checklist_templates to authenticated;

grant update (name, discipline, is_core)
  on scope_templates to authenticated;

grant update (reference, heading, description, riba_stage)
  on scope_template_items to authenticated;

grant update (reference, kind, title, description, category, likelihood, sort_order)
  on risk_templates to authenticated;

grant update (reference, drm_ref, title, description, period_years, beneficiary, form, sort_order)
  on warranty_templates to authenticated;
