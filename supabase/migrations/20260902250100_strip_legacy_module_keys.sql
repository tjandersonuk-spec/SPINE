-- Clear out module keys that were never modules.
--
-- The approval form used to map a tier onto `{compliance, commercial}` — those
-- were nav GROUP TITLES, not modules, and nothing has ever read them. They sat
-- in live `organisations.modules` rows meaning nothing, and after the catalogue
-- became the one registry they did two visible kinds of harm:
--
--   * the owner's account card counted raw `false` values, so a core-tier
--     account reported "2 switched off" while every checkbox on the editor was
--     ticked — the editor renders the catalogue, and these are not in it;
--   * `assert_module_keys()` now refuses them, so the editor's draft (seeded
--     from the stored map) failed on save with "No module called compliance" —
--     a confusing error about a key the owner never chose.
--
-- Stripping them is not a loss: no page, policy or function has ever read a key
-- outside module_keys(), and module_on() returns false for one regardless. An
-- account left with `{}` has the complete product, which is what a tier map of
-- meaningless keys was always describing.
--
-- Only unknown keys go. A `true` on a project override is left alone even
-- though set_project_modules() would now refuse an admin writing one: it may
-- have been set deliberately by the platform owner, and silently removing a
-- working entitlement would be a worse surprise than the one being fixed.

update organisations o
   set modules = coalesce((
         select jsonb_object_agg(k.key, o.modules -> k.key)
         from jsonb_object_keys(o.modules) as k(key)
         where k.key = any(module_keys())
       ), '{}'::jsonb)
 where o.modules is not null
   and exists (
     select 1 from jsonb_object_keys(o.modules) as k(key)
     where not (k.key = any(module_keys())));

update projects p
   set modules_override = (
         select case when count(*) = 0 then null
                     else jsonb_object_agg(k.key, p.modules_override -> k.key) end
         from jsonb_object_keys(p.modules_override) as k(key)
         where k.key = any(module_keys())
       )
 where p.modules_override is not null
   and exists (
     select 1 from jsonb_object_keys(p.modules_override) as k(key)
     where not (k.key = any(module_keys())));

-- A count of what a map actually says, for the owner's account list.
--
-- Derived from the catalogue rather than from the stored map's own values,
-- because "how many are off" is a question about the product's modules and not
-- about whatever happens to be in the column. A key the catalogue does not
-- know is not a module that is off; it is not a module.
create or replace function modules_off_count(p_modules jsonb)
returns int
language sql
immutable
as $$
  select count(*)::int
  from unnest(module_keys()) k
  where (coalesce(p_modules, '{}'::jsonb) ->> k) = 'false';
$$;

grant execute on function modules_off_count(jsonb) to authenticated;
