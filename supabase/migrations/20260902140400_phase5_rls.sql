-- Phase 5, part five -- Row Level Security and column grants.

alter table bep                    enable row level security;
alter table bep_fields             enable row level security;
alter table bep_field_values       enable row level security;
alter table bep_revision_rules     enable row level security;
alter table bep_suitability_codes  enable row level security;
alter table bep_agreements         enable row level security;
alter table document_imports       enable row level security;
alter table document_rows          enable row level security;
alter table drawing_register       enable row level security;
alter table drawing_packs          enable row level security;
alter table drawing_pack_items     enable row level security;
alter table drawing_pack_programme enable row level security;
alter table transmittals           enable row level security;
alter table transmittal_items      enable row level security;
alter table transmittal_recipients enable row level security;
alter table project_sequences      enable row level security;

-- Everyone on the project reads the BEP. A consultant cannot name files
-- correctly if they cannot see the convention, so hiding it would only produce
-- non-compliant drawings.
create policy bep_select on bep for select to authenticated
using (can_see_project(project_id));
create policy bep_write on bep for all to authenticated
using (can_write_project_setup(project_id)) with check (can_write_project_setup(project_id));

create policy bep_fields_select on bep_fields for select to authenticated
using (can_see_project(project_id));
create policy bep_fields_write on bep_fields for all to authenticated
using (can_write_project_setup(project_id)) with check (can_write_project_setup(project_id));

create policy bep_field_values_select on bep_field_values for select to authenticated
using (exists (select 1 from bep_fields f
               where f.id = bep_field_values.field_id and can_see_project(f.project_id)));
create policy bep_field_values_write on bep_field_values for all to authenticated
using (exists (select 1 from bep_fields f
               where f.id = bep_field_values.field_id and can_write_project_setup(f.project_id)))
with check (exists (select 1 from bep_fields f
               where f.id = bep_field_values.field_id and can_write_project_setup(f.project_id)));

create policy bep_rev_select on bep_revision_rules for select to authenticated
using (can_see_project(project_id));
create policy bep_rev_write on bep_revision_rules for all to authenticated
using (can_write_project_setup(project_id)) with check (can_write_project_setup(project_id));

create policy bep_suit_select on bep_suitability_codes for select to authenticated
using (can_see_project(project_id));
create policy bep_suit_write on bep_suitability_codes for all to authenticated
using (can_write_project_setup(project_id)) with check (can_write_project_setup(project_id));

create policy bep_agree_select on bep_agreements for select to authenticated
using (can_see_project(project_id));
create policy bep_agree_write on bep_agreements for all to authenticated
using (can_write_project_setup(project_id)) with check (can_write_project_setup(project_id));

-- All project members read the register -- a consultant who cannot see what has
-- been issued cannot coordinate. Only the contractor's team writes it.
create policy document_imports_select on document_imports for select to authenticated
using (can_see_project(project_id));
create policy document_rows_select on document_rows for select to authenticated
using (can_see_project(project_id));
-- No write policy on either: the raw import is append-only and written solely
-- by import_documents().

create policy drawing_register_select on drawing_register for select to authenticated
using (can_see_project(project_id));
create policy drawing_register_write on drawing_register for all to authenticated
using (can_write_project_setup(project_id)) with check (can_write_project_setup(project_id));

create policy packs_select on drawing_packs for select to authenticated
using (can_see_project(project_id));
create policy packs_write on drawing_packs for all to authenticated
using (can_write_project_setup(project_id)) with check (can_write_project_setup(project_id));

create policy pack_items_select on drawing_pack_items for select to authenticated
using (exists (select 1 from drawing_packs p
               where p.id = drawing_pack_items.pack_id and can_see_project(p.project_id)));
create policy pack_items_write on drawing_pack_items for all to authenticated
using (exists (select 1 from drawing_packs p
               where p.id = drawing_pack_items.pack_id and can_write_project_setup(p.project_id)))
with check (exists (select 1 from drawing_packs p
               where p.id = drawing_pack_items.pack_id and can_write_project_setup(p.project_id)));

create policy pack_prog_select on drawing_pack_programme for select to authenticated
using (exists (select 1 from drawing_packs p
               where p.id = drawing_pack_programme.pack_id and can_see_project(p.project_id)));
create policy pack_prog_write on drawing_pack_programme for all to authenticated
using (exists (select 1 from drawing_packs p
               where p.id = drawing_pack_programme.pack_id and can_write_project_setup(p.project_id)))
with check (exists (select 1 from drawing_packs p
               where p.id = drawing_pack_programme.pack_id and can_write_project_setup(p.project_id)));

-- Transmittals are append-only: select and insert, never update or delete. A
-- correction is a new transmittal, because a record that can be edited
-- afterwards is not evidence of anything.
create policy transmittals_select on transmittals for select to authenticated
using (can_see_project(project_id));
create policy transmittal_items_select on transmittal_items for select to authenticated
using (exists (select 1 from transmittals t
               where t.id = transmittal_items.transmittal_id and can_see_project(t.project_id)));
create policy transmittal_recipients_select on transmittal_recipients for select to authenticated
using (exists (select 1 from transmittals t
               where t.id = transmittal_recipients.transmittal_id and can_see_project(t.project_id)));

-- project_sequences is machinery. Nobody reads or writes it directly; it is
-- touched only by next_reference(), which is a definer function.

-- ------------------------------------------------------------------ grants
-- Each table states its own: a table created by this migration inherits nothing
-- from any earlier `grant on all tables`.

grant select on bep to authenticated;
grant insert, delete on bep to authenticated;
grant update (delimiter) on bep to authenticated;

grant select, insert, delete on bep_fields to authenticated;
grant update (position, name, min_len, max_len, required, source) on bep_fields to authenticated;

grant select, insert, delete on bep_field_values to authenticated;
grant update (code, description) on bep_field_values to authenticated;

grant select, insert, delete on bep_revision_rules to authenticated;
grant update (prefix, construction_status) on bep_revision_rules to authenticated;

grant select, insert, delete on bep_suitability_codes to authenticated;
grant update (code, description, in_use) on bep_suitability_codes to authenticated;

grant select, insert, delete on bep_agreements to authenticated;
grant update (position, agreed_by, agreed_on, status) on bep_agreements to authenticated;

-- Read-only. Written by import_documents() alone.
grant select on document_imports to authenticated;
grant select on document_rows to authenticated;

-- The register is editable, but only in the columns a person has business
-- setting. revision, workflow_status and last_synced come from reconciliation:
-- granting update on them would let someone mark a drawing delivered that the
-- CDE has never seen, which is the one thing the register exists to prevent.
grant select, insert, delete on drawing_register to authenticated;
grant update (document_number, title, cde_url, programme_task_uid, offset_days,
              anchor, due_date_override) on drawing_register to authenticated;

grant select, insert, delete on drawing_packs to authenticated;
grant update (name, purpose, owner_id) on drawing_packs to authenticated;

-- A pack membership is added or removed, never edited.
grant select, insert, delete on drawing_pack_items to authenticated;
grant select, insert, delete on drawing_pack_programme to authenticated;

-- Append-only, enforced at the privilege layer as well as by policy. No update
-- and no delete is granted at all, so revision_at_issue cannot be rewritten
-- even by someone who finds a way past the trigger.
grant select on transmittals to authenticated;
grant select on transmittal_items to authenticated;
grant select on transmittal_recipients to authenticated;

alter view v_drawing_register set (security_invoker = on);
alter view v_drawing_packs set (security_invoker = on);
grant select on v_drawing_register to authenticated;
grant select on v_drawing_packs to authenticated;
