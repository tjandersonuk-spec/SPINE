-- Which migrations have been applied?
--
-- Applying by hand through the SQL editor leaves no history table, so this
-- checks for one object each migration creates. Paste it into the SQL editor
-- and read the `applied` column; run the migrations still showing false, in the
-- order listed, top to bottom.
--
-- Safe to run at any time: it only reads the catalogue.
--
-- Everything below is ONE statement on purpose. The Supabase SQL editor shows
-- only the result of the last statement it runs, so a second select here would
-- silently replace this list on screen with its own output.

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
  (20,'20260902120200_phase3_drm_rls',                'policy',   'drm_items_select'),
  (21,'20260902130000_phase4_programme',              'table',    'programme_tasks'),
  (22,'20260902130100_phase4_due_date',               'function', 'due_date'),
  (23,'20260902130200_phase4_import',                 'function', 'import_programme'),
  (24,'20260902130300_phase4_rls',                    'policy',   'programme_tasks_select'),
  (25,'20260902130400_phase4_sample_programme',       'function', 'seed_sample_data'),
  (26,'20260902140000_phase5_bep',                    'table',    'bep_fields'),
  (27,'20260902140100_phase5_register',               'table',    'drawing_register'),
  (28,'20260902140200_phase5_functions',              'function', 'construction_status'),
  (29,'20260902140300_phase5_actions',                'function', 'issue_transmittal'),
  (30,'20260902140400_phase5_rls',                    'policy',   'drawing_register_select'),
  (31,'20260902150000_storage_bucket',                'function', 'my_company_on_project'),
  (32,'20260902160000_phase6_visibility',             'function', 'can_see'),
  (33,'20260902160100_phase6_comments',               'table',    'comments'),
  (34,'20260902160200_phase6_meetings',               'table',    'meetings'),
  (35,'20260902160300_phase6_issues',                 'table',    'issues'),
  (36,'20260902160400_phase6_functions',              'function', 'answer_rfi'),
  (37,'20260902160500_phase6_rls',                    'policy',   'issues_select'),
  (38,'20260902170000_phase7_change_log',             'table',    'change_log'),
  (39,'20260902170100_phase7_theming',                'function', 'project_shell'),
  -- This migration creates no new object -- it replaces two functions -- so it
  -- is checked by looking inside one of them. A marker naming an object an
  -- EARLIER migration created would read true whether or not this one ran.
  (40,'20260902170200_phase7_modules_default_on',     'source',   'module_on:module_keys'),
  (41,'20260902180000_phase8_dashboard',              'function', 'my_company_tree'),
  (42,'20260902190000_phase9_tracked_items',          'table',    'tracked_items'),
  (43,'20260902190100_phase9_templates',              'table',    'checklist_templates'),
  (44,'20260902190200_phase9_functions',              'function', 'load_checklist'),
  (45,'20260902190300_phase9_rls',                    'policy',   'tracked_items_select'),
  (46,'20260902200000_phase10_change_requests',       'table',    'change_requests'),
  (47,'20260902200100_phase10_bsa',                   'table',    'occurrences'),
  (48,'20260902200200_phase10_bsa_functions',         'function', 'work_status'),
  (49,'20260902200300_phase10_rls',                   'policy',   'change_requests_select'),
  (50,'20260902210000_phase11_breeam_schemes',        'table',    'breeam_schemes'),
  (51,'20260902210100_phase11_breeam_scoring',        'function', 'breeam_totals'),
  (52,'20260902210200_phase11_breeam_import',         'function', 'breeam_import_apply'),
  (53,'20260902210300_phase11_rls',                   'policy',   'breeam_schemes_select'),
  (54,'20260902220000_phase12_fees',                  'table',    'fees'),
  (55,'20260902220100_phase12_fees_functions',        'function', 'cashflow_curve'),
  (56,'20260902220200_phase12_precon',                'table',    'precon_budget'),
  (57,'20260902220300_phase12_risk',                  'table',    'risks'),
  (58,'20260902220400_phase12_warranties',            'table',    'warranties'),
  (59,'20260902220500_phase12_materials',             'table',    'material_submissions'),
  (60,'20260902220600_phase12_changereq',             'function', 'set_change_status'),
  (61,'20260902220700_phase12_rls',                   'policy',   'fees_select'),
  (62,'20260902220800_phase12_programme_dependents',  'source',   'programme_dependents:Instalment'),
  (63,'20260902220900_phase12_can_see_admin_only',    'source',   'can_see:is_account_admin'),
  (64,'20260902230000_phase13_reports',               'function', 'report_scope'),
  (65,'20260902230100_phase13_report_page1',          'function', 'report_compliance_rows'),
  (66,'20260902230200_phase13_report_page2',          'function', 'report_attention'),
  (67,'20260902230300_phase13_report_page3',          'function', 'report_activity'),
  (68,'20260902240000_phase14_snapshots',             'table',    'snapshots'),
  (69,'20260902240100_phase14_portfolio',             'function', 'portfolio_projects'),
  (70,'20260902250000_entitlements_owner_only',       'function', 'module_catalogue'),
  (71,'20260902250100_strip_legacy_module_keys',      'function', 'modules_off_count'),
  (72,'20260902260000_theme_default_dark',           'default',  'organisations.theme=dark'),
  (73,'20260902260100_reference_counter_per_prefix', 'source',   'next_reference:Keyed on the prefix'),
  (74,'20260902260200_breeam_score_is_a_percentage', 'source',   'report_metrics:round(b.score_achieved)::text'),
  (75,'20260902270000_sample_delivery_data',         'function', 'seed_sample_compliance'),
  (76,'20260902280000_default_template_libraries',   'count',    'checklist_templates'),
  (77,'20260902290000_template_editing',            'function', 'fork_risk_templates'),
  (78,'20260902300000_sample_data_tops_up',         'source',   'seed_sample_project:left as it is'),
  (79,'20260902310000_phase16_notifications',       'table',    'notifications'),
  (80,'20260902310100_phase16_digest',              'function', 'build_digest'),
  (81,'20260902320000_phase17_rooms',                'table',    'chat_rooms'),
  (82,'20260902320100_phase17_room_actions',         'function', 'raise_from_room'),
  (83,'20260902320200_phase17_mentions',             'function', 'queue_mentions'),
  (84,'20260902320300_phase17_reports',              'source',   'report_activity:entity_type <> ''room'''),
  (85,'20260902320400_sample_rooms',                 'function', 'seed_sample_rooms'),
  (86,'20260902330000_dashboard_metrics',            'function', 'dashboard_metrics')
)
select
  e.ord::numeric as "#",
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
    -- 'default' is for a migration that only changes a column default: the
    -- marker is <table>.<column>=<text the default must contain>.
    when 'default' then exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = split_part(e.marker, '.', 1)
        and column_name = split_part(split_part(e.marker, '.', 2), '=', 1)
        and column_default like '%' || split_part(e.marker, '=', 2) || '%')
    -- 'count' is for a migration that ships rows rather than a schema object:
    -- the marker is the table, and the check is that a published set exists.
    when 'count' then exists (
      select 1 from checklist_templates where organisation_id is null)
    -- 'source' is for a migration that only replaces a function: the marker is
    -- <function>:<text the new body must contain>.
    when 'source' then exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = split_part(e.marker, ':', 1)
        and p.prosrc like '%' || split_part(e.marker, ':', 2) || '%')
  end as applied
from expected e

-- The library seed carries no schema object, so it is checked by counting
-- rather than by looking for an object. It rides along as two extra rows so
-- that the whole check stays a single statement.
union all
select
  20.1,
  'library seed: 100 published items expected, ' ||
    (select count(*) from drm_library_items where organisation_id is null) || ' found',
  (select count(*) from drm_library_items where organisation_id is null) = 100
union all
select
  20.2,
  'library seed: 9 published categories expected, ' ||
    (select count(*) from drm_categories where organisation_id is null) || ' found',
  (select count(*) from drm_categories where organisation_id is null) = 9

order by 1;
