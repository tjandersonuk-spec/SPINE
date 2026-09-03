-- Phase 4 -- the sample project gets the prototype's programme.
--
-- The same 36 lines the prototype ships, so that what the app shows and what
-- the prototype shows can be compared line for line. Loaded through the same
-- table the importer writes, but seeded directly: seed_sample_project() runs as
-- the account admin who created the project, and import_programme() would
-- refuse a caller who is not yet a member.

create or replace function seed_sample_programme(p_project uuid)
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_import_id uuid;
  v_count int;
begin
  -- Idempotent: seeding twice must not double the programme or move dates that
  -- something is already anchored to.
  if exists (select 1 from programme_tasks where project_id = p_project) then
    return 0;
  end if;

  insert into programme_imports (project_id, label, imported_by, row_count)
  values (p_project, 'Rev 12 -- August progress update', auth.uid(), 36)
  returning id into v_import_id;

  insert into programme_tasks (project_id, task_uid, description, start_date,
    finish_date, percent_complete, level, parent_uid, task_type, last_import_id)
  select p_project, v.uid, v.descr, v.start_date, v.finish_date, v.pct, v.lvl,
         v.parent, v.ttype, v_import_id
  from (values
    ('1000','KINGSMEAD WHARF BLOCK C','2026-01-05'::date,'2028-02-25'::date,34,1,null,'Summary'),
    ('1100','Design','2026-01-05'::date,'2027-03-19'::date,52,2,'1000','Summary'),
    ('1110','Stage 3 Spatial Coordination','2026-01-05'::date,'2026-05-29'::date,100,3,'1100','Task'),
    ('1111','Stage 3 design freeze','2026-05-29'::date,'2026-05-29'::date,100,4,'1110','Milestone'),
    ('1120','Stage 4 Technical Design','2026-06-01'::date,'2026-12-18'::date,46,3,'1100','Summary'),
    ('1121','Architectural technical package','2026-06-01'::date,'2026-10-30'::date,58,4,'1120','Task'),
    ('1122','Structural technical package','2026-06-01'::date,'2026-09-25'::date,71,4,'1120','Task'),
    ('1123','MEP technical package','2026-06-15'::date,'2026-11-27'::date,38,4,'1120','Task'),
    ('1124','Facade technical package','2026-07-06'::date,'2026-12-18'::date,22,4,'1120','Task'),
    ('1125','Landscape technical package','2026-09-07'::date,'2027-01-29'::date,5,4,'1120','Task'),
    ('1126','Stage 4 design freeze','2026-12-18'::date,'2026-12-18'::date,0,4,'1120','Milestone'),
    ('1130','Stage 5 Construction Design','2027-01-04'::date,'2027-03-19'::date,0,3,'1100','Summary'),
    ('1131','Subcontractor design — facade','2027-01-04'::date,'2027-02-26'::date,0,4,'1130','Task'),
    ('1132','Subcontractor design — MEP','2027-01-04'::date,'2027-03-19'::date,0,4,'1130','Task'),
    ('1200','Statutory and Approvals','2026-01-05'::date,'2027-06-25'::date,41,2,'1000','Summary'),
    ('1210','Planning conditions discharge','2026-01-05'::date,'2026-11-27'::date,55,3,'1200','Task'),
    ('1211','Pre-commencement conditions discharged','2026-04-03'::date,'2026-04-03'::date,100,4,'1210','Milestone'),
    ('1220','Building Control / Gateway 2','2026-02-02'::date,'2026-07-31'::date,80,3,'1200','Task'),
    ('1221','Gateway 2 approval received','2026-07-31'::date,'2026-07-31'::date,100,4,'1220','Milestone'),
    ('1230','BREEAM design stage assessment','2026-06-01'::date,'2026-10-30'::date,35,3,'1200','Task'),
    ('1240','Section 278 / 38 approvals','2026-05-01'::date,'2027-06-25'::date,15,3,'1200','Task'),
    ('1300','Procurement','2026-06-01'::date,'2027-04-30'::date,28,2,'1000','Summary'),
    ('1310','Facade package procurement','2026-08-03'::date,'2026-11-27'::date,40,3,'1300','Task'),
    ('1320','MEP package procurement','2026-09-01'::date,'2026-12-18'::date,20,3,'1300','Task'),
    ('1330','Lift package procurement','2026-10-01'::date,'2027-01-29'::date,0,3,'1300','Task'),
    ('1400','Construction','2026-04-13'::date,'2028-02-25'::date,18,2,'1000','Summary'),
    ('1410','Enabling works and demolition','2026-04-13'::date,'2026-06-19'::date,100,3,'1400','Task'),
    ('1420','Piling and substructure','2026-06-22'::date,'2026-10-16'::date,62,3,'1400','Task'),
    ('1430','Superstructure frame','2026-10-19'::date,'2027-05-14'::date,0,3,'1400','Task'),
    ('1440','Envelope and facade installation','2027-03-01'::date,'2027-09-24'::date,0,3,'1400','Task'),
    ('1441','Weathertight','2027-09-24'::date,'2027-09-24'::date,0,4,'1440','Milestone'),
    ('1450','MEP first fix','2027-05-17'::date,'2027-10-29'::date,0,3,'1400','Task'),
    ('1460','Internal fit-out','2027-08-02'::date,'2028-01-14'::date,0,3,'1400','Task'),
    ('1470','External works and landscape','2027-09-06'::date,'2028-01-28'::date,0,3,'1400','Task'),
    ('1480','Commissioning and handover','2027-11-15'::date,'2028-02-25'::date,0,3,'1400','Task'),
    ('1481','Practical Completion','2028-02-25'::date,'2028-02-25'::date,0,4,'1480','Milestone')
  ) as v(uid, descr, start_date, finish_date, pct, lvl, parent, ttype);

  get diagnostics v_count = row_count;
  update programme_imports set row_count = v_count where id = v_import_id;
  return v_count;
end;
$$;

revoke all on function seed_sample_programme(uuid) from public;
grant execute on function seed_sample_programme(uuid) to authenticated;

-- The sample project is seeded by one call, so that a project cannot end up
-- with a directory and no programme. seed_sample_project() is left as it is
-- rather than rewritten: redefining two hundred lines to append one call is how
-- a seeder quietly drifts from the version that was tested.
create or replace function seed_sample_data(p_project uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_directory text;
  v_lines int;
begin
  v_directory := seed_sample_project(p_project);
  v_lines := seed_sample_programme(p_project);
  return v_directory || format(' Loaded %s programme lines.', v_lines);
end;
$$;

revoke all on function seed_sample_data(uuid) from public;
grant execute on function seed_sample_data(uuid) to authenticated;
