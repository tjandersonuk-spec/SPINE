-- The one storage bucket.
--
-- It holds appointment documents and evidence attachments, and nothing else.
-- No drawing ever goes in here: the CDE holds the file and drawing_register
-- keeps a URL to it. A bucket that quietly became a second document management
-- system would put this product in competition with the CDE it is meant to sit
-- above, and would leave two answers to "what is the current revision".

insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', false)
on conflict (id) do nothing;

-- Paths are project/company/... so a policy can decide by prefix. Naming the
-- shape once here keeps the policies below readable and stops the convention
-- from drifting.
--   project-files/<project_id>/<company_id>/<slot>/<filename>
create or replace function storage_path_project(p_name text)
returns uuid
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select nullif(split_part(p_name, '/', 1), '')::uuid;
$$;

create or replace function storage_path_company(p_name text)
returns uuid
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select nullif(split_part(p_name, '/', 2), '')::uuid;
$$;

grant execute on function storage_path_project(text) to authenticated;
grant execute on function storage_path_company(text) to authenticated;


-- Which company tree on this project belongs to the caller.
--
-- security definer on purpose. The obvious version of the policies below reads
-- organisation_members and companies inline, and always fails: member
-- visibility is admin-only and a consultant cannot see their own membership
-- row, so the EXISTS is false for exactly the people the policy is meant to
-- admit. Those visibility rules exist to stop people browsing each other, not
-- to stop someone knowing which firm they themselves work for -- and this
-- function only ever answers about the caller.
create or replace function my_company_on_project(p_project uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id
  from companies c
  join projects p on p.id = c.project_id
  join organisation_members m
    on m.organisation_id = p.organisation_id
   and m.profile_id = auth.uid()
   and m.company_id = c.catalogue_company_id
  where c.project_id = p_project
  limit 1;
$$;

grant execute on function my_company_on_project(uuid) to authenticated;

-- Read. The contractor's own staff and a project admin see the whole project
-- tree; anyone else sees only their own company's, so a consultant cannot read
-- a rival's appointment or fee scope from the same project.
create policy project_files_read on storage.objects for select to authenticated
using (
  bucket_id = 'project-files'
  and can_see_project(storage_path_project(name))
  and (
    can_write_project_setup(storage_path_project(name))
    or storage_path_company(name)
       = my_company_on_project(storage_path_project(name))
  )
);

-- Write. A consultant uploads into their own company's tree and nowhere else;
-- the contractor's team may upload anywhere on the project, because chasing a
-- missing appointment often means putting it in on someone's behalf.
create policy project_files_write on storage.objects for insert to authenticated
with check (
  bucket_id = 'project-files'
  and can_see_project(storage_path_project(name))
  and (
    can_write_project_setup(storage_path_project(name))
    or storage_path_company(name)
       = my_company_on_project(storage_path_project(name))
  )
);

-- Replacing a file is an upload of a new one; the old row is superseded rather
-- than overwritten, so there is no update policy at all. Only the contractor's
-- team may delete, and only within their own project.
create policy project_files_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'project-files'
  and can_write_project_setup(storage_path_project(name))
);
