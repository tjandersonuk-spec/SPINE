-- Entitlements are the platform owner's to sell.
--
-- Phase 7 built modules as packaging: a key per bolt-on, absent means on, a
-- module that is off is absent from the nav and its page refuses, and the data
-- underneath is untouched because RLS never asked. That is the right shape for
-- an upsell model and it stays. What was wrong was WHO could set the map:
-- set_modules() let an account admin write their own account's entitlements,
-- which is a customer switching on a bolt-on nobody sold them.
--
-- Three changes. The catalogue becomes the one registry, so adding a bolt-on
-- later is one row here plus its page. The account-level map is the platform
-- owner's alone. And a project override may only NARROW: an account admin can
-- switch a module off for one difficult job, and can never switch on one the
-- account does not have -- that door was a back way round the first rule.

-- ------------------------------------------------------------- the registry
--
-- One row per module the product can sell. Everything else derives from this:
-- module_keys() for the validators, the platform owner's editor, the project
-- settings screen, and the nav guard in src/theme.test.ts which reads this
-- file. To add a bolt-on: one row here, a RequireModule around its page, and a
-- nav entry with the same key. Nothing else.
create or replace function module_catalogue()
returns table (key text, label text, "group" text, sort int)
language sql
immutable
as $$
  select * from (values
    ('preassessment', 'Pre-assessment',            'Pre-construction', 10),
    ('precon',        'Fee budget',                'Pre-construction', 11),
    ('client',        'Client requirements',       'Pre-construction', 12),
    ('directory',     'Directory',                 'Set up',           20),
    ('drm',           'Responsibility matrix',     'Set up',           21),
    ('scope',         'Scope of service',          'Set up',           22),
    ('bep',           'BEP',                       'Set up',           23),
    ('programme',     'Programme',                 'Set up',           24),
    ('docs',          'Drawing register',          'Design',           30),
    ('tx',            'Packs and transmittals',    'Design',           31),
    ('materials',     'Material samples',          'Design',           32),
    ('crs',           'Change requests',           'Design',           33),
    ('planning',      'Planning conditions',       'Compliance',       40),
    ('bc',            'Building control',          'Compliance',       41),
    ('bsa',           'Building safety',           'Compliance',       42),
    ('breeam',        'BREEAM',                    'Compliance',       43),
    ('highways',      'Highways',                  'Compliance',       44),
    ('utilities',     'Utilities',                 'Compliance',       45),
    ('fees',          'Fees and cashflow',         'Commercial',       50),
    ('budget',        'Pre-construction budget',   'Commercial',       51),
    ('risk',          'Risk and opportunity',      'Commercial',       52),
    ('warranties',    'Warranties',                'Handover',         60),
    ('handover',      'Handover checklist',        'Handover',         61),
    ('gateways',      'Gateways',                  'Handover',         62),
    ('reports',       'Period reports',            'Reporting',        70),
    ('audit',         'Audit',                     'Reporting',        71)
  ) as t(key, label, "group", sort);
$$;

grant execute on function module_catalogue() to authenticated;

-- Derived from the catalogue, so there is exactly one list. Same signature and
-- same contents as before; every constraint and validator keeps working.
create or replace function module_keys()
returns text[]
language sql
immutable
as $$
  select array(select c.key from module_catalogue() c order by c.sort);
$$;

-- The one validator every writer calls. Named once, because four functions
-- had their own copy of the loop and a fifth would eventually forget it.
create or replace function assert_module_keys(p_modules jsonb)
returns void
language plpgsql
immutable
as $$
declare k text;
begin
  if p_modules is null then return; end if;
  if jsonb_typeof(p_modules) <> 'object' then
    raise exception 'Modules must be an object of key: true|false' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_modules) loop
    if not (k = any(module_keys())) then
      raise exception 'No module called "%"', k using errcode = '22023';
    end if;
    if jsonb_typeof(p_modules -> k) <> 'boolean' then
      raise exception 'Module "%" must be true or false', k using errcode = '22023';
    end if;
  end loop;
end;
$$;

grant execute on function assert_module_keys(jsonb) to authenticated;

-- ------------------------------------------------- the account map: owner only
create or replace function set_modules(p_org uuid, p_modules jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_before jsonb;
begin
  -- Not an account admin. A customer switching on a bolt-on nobody sold them
  -- is exactly the write this refuses, and refusing it here rather than in a
  -- hidden checkbox is what makes it a rule.
  if not is_platform_owner() then
    raise exception 'Entitlements are set by the platform owner' using errcode = '42501';
  end if;
  perform assert_module_keys(p_modules);
  select modules into v_before from organisations where id = p_org;
  if not found then raise exception 'No such account' using errcode = 'P0002'; end if;
  update organisations set modules = coalesce(p_modules, '{}'::jsonb) where id = p_org;
  insert into platform_audit (owner_id, organisation_id, action, detail)
  values (auth.uid(), p_org, 'set_modules',
          jsonb_build_object('from', v_before, 'to', coalesce(p_modules, '{}'::jsonb)));
end;
$$;

-- --------------------------------------------- the project override: narrow only
--
-- An account admin may switch a module OFF for one project. They may not
-- switch one ON: a `true` in the override for a module the account does not
-- have would be the account-level rule with a side door. The platform owner may
-- set either, because they could have set it on the account anyway.
create or replace function set_project_modules(p_project uuid, p_override jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_org uuid; k text;
begin
  select organisation_id into v_org from projects where id = p_project;
  if v_org is null then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if not (is_account_admin(v_org) or is_platform_owner()) then
    raise exception 'Only an account admin may change a project''s modules'
      using errcode = '42501';
  end if;
  perform assert_module_keys(p_override);
  if p_override is not null and not is_platform_owner() then
    for k in select jsonb_object_keys(p_override) loop
      if (p_override -> k)::boolean then
        raise exception
          'A project can only switch a module off. "%" is set on the account by the platform owner.',
          k using errcode = '42501';
      end if;
    end loop;
  end if;
  update projects set modules_override = p_override where id = p_project;
end;
$$;

-- ---------------------------------------------- approval and amendment validate
--
-- Both already refuse anyone but the owner. Both now refuse a key that is not a
-- module, so an account cannot be created with an entitlement nothing reads --
-- which is how `compliance: true` sat in a live row for six phases meaning
-- nothing.
create or replace function approve_account_request(
  p_request uuid, p_name text, p_slug text, p_tier text, p_modules jsonb
) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_org uuid; v_req account_requests;
begin
  if not is_platform_owner() then raise exception 'not permitted'; end if;
  perform assert_module_keys(p_modules);
  select * into v_req from account_requests where id = p_request and status = 'pending';
  if not found then raise exception 'no pending request'; end if;

  insert into organisations (name, slug, status, subscription_tier, modules,
                             approved_by, approved_at)
  values (p_name, p_slug, 'active', p_tier, coalesce(p_modules, '{}'::jsonb),
          auth.uid(), now())
  returning id into v_org;

  insert into organisation_members (organisation_id, profile_id, role)
  values (v_org, v_req.requested_by, 'admin');

  update account_requests set status = 'approved', reviewed_by = auth.uid(),
    reviewed_at = now(), organisation_id = v_org where id = p_request;

  insert into platform_audit (owner_id, organisation_id, subject_profile_id,
                              action, detail)
  values (auth.uid(), v_org, v_req.requested_by, 'approve_account_request',
          jsonb_build_object('request_id', p_request, 'name', p_name,
                             'modules', coalesce(p_modules, '{}'::jsonb)));
  return v_org;
end $$;

create or replace function update_account_as_owner(
  p_org uuid, p_name text, p_slug text, p_tier text, p_modules jsonb
) returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_before organisations;
begin
  if not is_platform_owner() then raise exception 'not permitted'; end if;
  perform assert_module_keys(p_modules);
  select * into v_before from organisations where id = p_org;
  if not found then raise exception 'no such account'; end if;

  update organisations set
    name = coalesce(p_name, name),
    slug = coalesce(p_slug, slug),
    subscription_tier = coalesce(p_tier, subscription_tier),
    modules = coalesce(p_modules, modules)
  where id = p_org;

  insert into platform_audit (owner_id, organisation_id, action, detail)
  values (auth.uid(), p_org, 'update_account',
          jsonb_build_object(
            'from', jsonb_build_object('name', v_before.name, 'slug', v_before.slug,
                     'tier', v_before.subscription_tier, 'modules', v_before.modules),
            'to', jsonb_build_object('name', coalesce(p_name, v_before.name),
                     'slug', coalesce(p_slug, v_before.slug),
                     'tier', coalesce(p_tier, v_before.subscription_tier),
                     'modules', coalesce(p_modules, v_before.modules))));
end $$;
