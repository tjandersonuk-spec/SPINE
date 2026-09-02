-- Phase 3 — Row Level Security for the matrix.

alter table drm_categories    enable row level security;
alter table drm_library_items enable row level security;
alter table drm_items         enable row level security;
alter table drm_roles         enable row level security;

-- The published library is readable by anyone signed in — it is what an account
-- sees before forking. A fork is the account's own.
create policy drm_categories_select on drm_categories for select to authenticated
using (organisation_id is null or is_account_member(organisation_id));

create policy drm_categories_write on drm_categories for all to authenticated
using (organisation_id is not null and is_account_admin(organisation_id)
       and account_is_live(organisation_id))
with check (organisation_id is not null and is_account_admin(organisation_id)
       and account_is_live(organisation_id));

create policy drm_library_select on drm_library_items for select to authenticated
using (organisation_id is null or is_account_member(organisation_id));

create policy drm_library_write on drm_library_items for all to authenticated
using (organisation_id is not null and is_account_admin(organisation_id)
       and account_is_live(organisation_id))
with check (organisation_id is not null and is_account_admin(organisation_id)
       and account_is_live(organisation_id));

create policy drm_items_select on drm_items for select to authenticated
using (can_see_project(project_id));

create policy drm_items_write on drm_items for all to authenticated
using (exists (select 1 from projects p where p.id = drm_items.project_id
               and account_is_live(p.organisation_id)
               and (is_account_admin(p.organisation_id) or is_project_admin(p.id))))
with check (exists (select 1 from projects p where p.id = drm_items.project_id
               and account_is_live(p.organisation_id)
               and (is_account_admin(p.organisation_id) or is_project_admin(p.id))));

create policy drm_roles_select on drm_roles for select to authenticated
using (exists (select 1 from drm_items d where d.id = drm_roles.drm_item_id
               and can_see_project(d.project_id)));

create policy drm_roles_write on drm_roles for all to authenticated
using (exists (select 1 from drm_items d join projects p on p.id = d.project_id
               where d.id = drm_roles.drm_item_id and account_is_live(p.organisation_id)
                 and (is_account_admin(p.organisation_id) or is_project_admin(p.id))))
with check (exists (select 1 from drm_items d join projects p on p.id = d.project_id
               where d.id = drm_roles.drm_item_id and account_is_live(p.organisation_id)
                 and (is_account_admin(p.organisation_id) or is_project_admin(p.id))));

grant select, insert, delete on drm_categories to authenticated;
grant update (code, name, sort_order) on drm_categories to authenticated;

grant select, insert, delete on drm_library_items to authenticated;
grant update (ref, category_code, item, default_lead_discipline, cdp_likely,
              guidance_note, sort_order) on drm_library_items to authenticated;

grant select, insert, delete on drm_items to authenticated;
-- project_id and library_item_id stay fixed: an item may be edited, but not
-- re-pointed at another project or another library row after the fact.
grant update (ref, category_code, item, lead_discipline, transfers_at_stage, cdp_package,
              level_of_information, applicable, guidance_note, notes)
  on drm_items to authenticated;

grant select, insert, delete on drm_roles to authenticated;
grant update (role_code) on drm_roles to authenticated;
