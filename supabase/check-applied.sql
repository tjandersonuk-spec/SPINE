-- Which migrations have been applied?
--
-- Applying by hand through the SQL editor leaves no history table, so this
-- checks for one object each migration creates. Paste it into the SQL editor
-- and read the `applied` column; run the migrations still showing false, in the
-- order listed, top to bottom.
--
-- Safe to run at any time: it only reads the catalogue.

with expected(ord, migration, kind, marker) as (values
  (1, '20260902090000_phase1_identity',              'table',    'profiles'),
  (2, '20260902090100_phase1_functions',             'function', 'is_account_admin'),
  (3, '20260902090200_phase1_actions',               'function', 'approve_account_request'),
  (4, '20260902090300_phase1_rls',                   'policy',   'projects_insert'),
  (5, '20260902090400_phase1_grants',                'function', 'update_account_as_owner'),
  (6, '20260902090500_phase1_new_user_trigger',      'trigger',  'on_auth_user_created'),
  (7, '20260902090600_invitation_token_without_pgcrypto', 'function', 'new_invitation_token'),
  (8, '20260902090700_pending_invitations_in_app',   'column',   'invitations.declined_at'),
  (9, '20260902090800_platform_owner_scope',         'function', 'account_summary'),
  (10,'20260902091000_membership_requests',          'table',    'membership_requests'),
  (11,'20260902091100_my_accounts_and_member_visibility', 'function', 'my_accounts'),
  (12,'20260902100000_phase2_directory',              'table',    'companies'),
  (13,'20260902100100_phase2_functions',              'function', 'companies_for_discipline'),
  (14,'20260902100200_phase2_rls',                    'policy',   'companies_select'),
  (15,'20260902110000_full_discipline_list',          'function', 'refresh_discipline_fork'),
  (16,'20260902110100_member_visibility_admins_only', 'policy',   'invitations_select'),
  (17,'20260902110200_sample_data',                   'function', 'seed_sample_project'),
  (18,'20260902120000_phase3_drm',                    'table',    'drm_items'),
  -- the seed has no object of its own; it is checked by its row count below
  (19,'20260902120100_phase3_drm_functions',          'function', 'drm_gaps'),
  (20,'20260902120200_phase3_drm_rls',                'policy',   'drm_items_select')
)
select
  e.ord as "#",
  e.migration,
  case e.kind
    when 'table' then exists (
      select 1 from pg_tables where schemaname = 'public' and tablename = e.marker)
    when 'function' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = e.marker)
    when 'policy' then exists (
      select 1 from pg_policies where schemaname = 'public' and policyname = e.marker)
    when 'trigger' then exists (
      select 1 from pg_trigger where not tgisinternal and tgname = e.marker)
    when 'column' then exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = split_part(e.marker, '.', 1)
        and column_name = split_part(e.marker, '.', 2))
  end as applied
from expected e
order by e.ord;

-- The library seed carries no schema object, so it is checked by counting.
-- Expect 100 published items and 9 categories once
-- 20260902120050_phase3_drm_library_seed.sql has run.
select
  (select count(*) from drm_library_items where organisation_id is null) as published_items,
  (select count(*) from drm_categories where organisation_id is null) as published_categories;
