-- Sample data, lifted from the prototype's demo project.
--
-- Kingsmead Wharf — Block C: eighteen firms, twenty-seven people, and the
-- discipline allocation the prototype ships with, including the two deliberate
-- gaps. It is here so a new project can be filled in one click while the
-- application is being built, and so every later phase has something realistic
-- to render against rather than an empty screen.
--
-- Not a fixture and not a migration of data: it is a function an admin calls,
-- it refuses to run twice, and nothing calls it automatically.

create or replace function seed_sample_project(p_project uuid)
returns text language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_org uuid;
  v_cat jsonb := '{}'::jsonb;   -- catalogue name -> id
  v_co  jsonb := '{}'::jsonb;   -- originator code -> project company id
  r record; v_id uuid; v_parent uuid;
begin
  select organisation_id into v_org from projects where id = p_project;
  if not found then raise exception 'no such project'; end if;
  if not is_account_admin(v_org) then raise exception 'not permitted'; end if;
  if exists (select 1 from companies where project_id = p_project) then
    raise exception 'this project already has a directory; sample data is only for an empty one';
  end if;

  -- ---- the catalogue: one row per real firm --------------------------------
  for r in
    select * from (values
      ('HBC Construction Ltd','HBC, Callywhite Lane, Dronfield S18 2XN','contractor'),
      ('Kingsmead Wharf Developments Ltd','12 Queen Square, Bristol BS1 4NT','client'),
      ('Bellhouse Architects','The Old Foundry, Bath BA1 5AN','consultant'),
      ('Latimer Heritage Consulting','7 Gay Street, Bath BA1 2PH','consultant'),
      ('Craven Wells Consulting','45 Whiteladies Road, Bristol BS8 2LS','consultant'),
      ('Trent Geotechnical Ltd','Sherwood Park, Nottingham NG15 0DT','consultant'),
      ('Merton Beattie Engineers','Riverside House, Cardiff CF10 5BZ','consultant'),
      ('Ashgrove Facades Ltd','Ashgrove Works, Swindon SN3 4TP','subcontractor'),
      ('Ridley Fire Consulting','8 Park Row, Bristol BS1 5LJ','consultant'),
      ('Calder Acoustics','Stanton Mill, Exeter EX4 3QL','consultant'),
      ('Verdant Landscape Studio','3 Kingsdown Parade, Bristol BS6 5UD','consultant'),
      ('Northlight Sustainability','Temple Studios, Bristol BS1 6QA','consultant'),
      ('Whitcombe Safety Consultants','22 Berkeley Square, Bristol BS8 1HP','consultant'),
      ('Marchmont Building Safety','19 Colston Avenue, Bristol BS1 4TX','consultant'),
      ('Pearce Vale LLP','1 Redcliff Street, Bristol BS1 6NP','consultant'),
      ('Halewood Surveys','Nailsea Business Park, Bristol BS48 1BQ','consultant')
    ) as t(name, address, ctype)
  loop
    insert into catalogue_companies (organisation_id, name, address, company_type)
    values (v_org, r.name, r.address, r.ctype)
    on conflict do nothing;
    select id into v_id from catalogue_companies
     where organisation_id = v_org and lower(name) = lower(r.name);
    v_cat := v_cat || jsonb_build_object(r.name, v_id);
  end loop;

  -- ---- people at those firms ----------------------------------------------
  for r in
    select * from (values
      ('HBC Construction Ltd','Daniel Osei','Design Manager','d.osei@hbcconstruction.co.uk','0114 496 2210'),
      ('HBC Construction Ltd','Rachel Ingram','Project Manager','r.ingram@hbcconstruction.co.uk','0114 496 2214'),
      ('HBC Construction Ltd','Femi Adeyemi','Package Manager — Facade','f.adeyemi@hbcconstruction.co.uk','0114 496 2231'),
      ('HBC Construction Ltd','Aaron Belcher','Document Controller','a.belcher@hbcconstruction.co.uk','0114 496 2202'),
      ('Kingsmead Wharf Developments Ltd','Charlotte Dean','Development Director','c.dean@kwdevelopments.co.uk','0117 300 8811'),
      ('Bellhouse Architects','Marcus Wren','Project Architect','m.wren@bellhousearchitects.com','01225 447 902'),
      ('Bellhouse Architects','Priya Raghunathan','Architectural Technologist','p.raghunathan@bellhousearchitects.com','01225 447 915'),
      ('Bellhouse Architects','Tom Lacey','Interior Designer','t.lacey@bellhousearchitects.com','01225 447 921'),
      ('Latimer Heritage Consulting','Ines Latimer','Heritage Consultant','i.latimer@latimerheritage.co.uk','01225 908 114'),
      ('Craven Wells Consulting','Helen Boakye','Associate — Structures','h.boakye@cravenwells.co.uk','0117 922 4406'),
      ('Craven Wells Consulting','Iain Struthers','Civil Engineer','i.struthers@cravenwells.co.uk','0117 922 4419'),
      ('Trent Geotechnical Ltd','Dev Ramanathan','Geotechnical Engineer','d.ramanathan@trentgeo.co.uk','0115 704 3320'),
      ('Merton Beattie Engineers','Nadia Farouk','Mechanical Lead','n.farouk@mertonbeattie.com','029 2088 7130'),
      ('Merton Beattie Engineers','Greg Hollis','Electrical Lead','g.hollis@mertonbeattie.com','029 2088 7144'),
      ('Merton Beattie Engineers','Sam Whitlock','Public Health Engineer','s.whitlock@mertonbeattie.com','029 2088 7151'),
      ('Ashgrove Facades Ltd','Lena Kowalczyk','Technical Director','l.kowalczyk@ashgrovefacades.co.uk','01793 660 402'),
      ('Ridley Fire Consulting','Andrew Ridley','Director','a.ridley@ridleyfire.co.uk','0117 405 3388'),
      ('Calder Acoustics','Bethan Price','Senior Consultant','b.price@calderacoustics.co.uk','01392 771 208'),
      ('Verdant Landscape Studio','Oliver Tran','Landscape Architect','o.tran@verdantstudio.co.uk','0117 973 5540'),
      ('Northlight Sustainability','Ruth Kavanagh','BREEAM AP / Assessor','r.kavanagh@northlight-su.co.uk','0117 214 6690'),
      ('Northlight Sustainability','Ewan Baird','Energy Assessor','e.baird@northlight-su.co.uk','0117 214 6698'),
      ('Whitcombe Safety Consultants','Sonia Whitcombe','Principal Designer (CDM)','s.whitcombe@whitcombesafety.co.uk','0117 332 1075'),
      ('Marchmont Building Safety','Gareth Loftus','Principal Designer (BSA)','g.loftus@marchmontbs.co.uk','0117 288 4401'),
      ('Pearce Vale LLP','Jonathan Pearce','Partner','j.pearce@pearcevale.co.uk','0117 946 1120'),
      ('Halewood Surveys','Kirsty Milne','Survey Manager','k.milne@halewoodsurveys.co.uk','01275 880 341')
    ) as t(firm, name, job_role, email, phone)
  loop
    insert into contacts (catalogue_company_id, name, job_role, email, phone)
    values ((v_cat ->> r.firm)::uuid, r.name, r.job_role, r.email, r.phone)
    on conflict do nothing;
  end loop;

  -- ---- the project directory, with its disciplines --------------------------
  -- Note what is NOT allocated: vertical transportation, ecology, transport and
  -- building control have nobody, which is the point — the gap list is meant to
  -- have something in it.
  for r in
    select * from (values
      ('HBC Construction Ltd','HBC','contractor', array['MC'], null::text),
      ('Kingsmead Wharf Developments Ltd','KWD','client', array['CL'], null),
      ('Bellhouse Architects','BEL','consultant', array['A','ID'], null),
      ('Latimer Heritage Consulting','LAT','consultant', array['A'], 'BEL'),
      ('Craven Wells Consulting','CWC','consultant', array['S','C','GE'], null),
      ('Trent Geotechnical Ltd','TGE','consultant', array['GE'], 'CWC'),
      ('Merton Beattie Engineers','MBE','consultant', array['M','E','P'], null),
      ('Ashgrove Facades Ltd','AFA','subcontractor', array['FE','SC'], null),
      ('Ridley Fire Consulting','RFC','consultant', array['FS'], null),
      ('Calder Acoustics','CAL','consultant', array['AC'], null),
      ('Verdant Landscape Studio','VLS','consultant', array['L'], null),
      ('Northlight Sustainability','NLS','consultant', array['SU','BR'], null),
      ('Whitcombe Safety Consultants','WHS','consultant', array['PD'], null),
      ('Marchmont Building Safety','MBS','consultant', array['PDB'], null),
      ('Pearce Vale LLP','PVL','consultant', array['QS'], null),
      ('Halewood Surveys','HWS','consultant', array['SUR'], null)
    ) as t(firm, code, ctype, disciplines, parent_code)
  loop
    v_id := add_company_to_project(p_project, (v_cat ->> r.firm)::uuid, r.code,
                                   r.ctype, r.disciplines);
    v_co := v_co || jsonb_build_object(r.code, v_id);
    if r.parent_code is not null then
      update companies set parent_id = (v_co ->> r.parent_code)::uuid where id = v_id;
    end if;
  end loop;

  -- ---- name the people on the project --------------------------------------
  for r in
    select c.id as contact_id, cc.name as firm, c.name,
           row_number() over (partition by cc.name order by c.name) as n
    from contacts c
    join catalogue_companies cc on cc.id = c.catalogue_company_id
    where cc.organisation_id = v_org
  loop
    if v_co ? (select code from (values
        ('HBC Construction Ltd','HBC'),('Kingsmead Wharf Developments Ltd','KWD'),
        ('Bellhouse Architects','BEL'),('Latimer Heritage Consulting','LAT'),
        ('Craven Wells Consulting','CWC'),('Trent Geotechnical Ltd','TGE'),
        ('Merton Beattie Engineers','MBE'),('Ashgrove Facades Ltd','AFA'),
        ('Ridley Fire Consulting','RFC'),('Calder Acoustics','CAL'),
        ('Verdant Landscape Studio','VLS'),('Northlight Sustainability','NLS'),
        ('Whitcombe Safety Consultants','WHS'),('Marchmont Building Safety','MBS'),
        ('Pearce Vale LLP','PVL'),('Halewood Surveys','HWS')
      ) as m(firm, code) where m.firm = r.firm)
    then
      perform add_person_to_project(
        (v_co ->> (select code from (values
          ('HBC Construction Ltd','HBC'),('Kingsmead Wharf Developments Ltd','KWD'),
          ('Bellhouse Architects','BEL'),('Latimer Heritage Consulting','LAT'),
          ('Craven Wells Consulting','CWC'),('Trent Geotechnical Ltd','TGE'),
          ('Merton Beattie Engineers','MBE'),('Ashgrove Facades Ltd','AFA'),
          ('Ridley Fire Consulting','RFC'),('Calder Acoustics','CAL'),
          ('Verdant Landscape Studio','VLS'),('Northlight Sustainability','NLS'),
          ('Whitcombe Safety Consultants','WHS'),('Marchmont Building Safety','MBS'),
          ('Pearce Vale LLP','PVL'),('Halewood Surveys','HWS')
        ) as m(firm, code) where m.firm = r.firm))::uuid,
        r.contact_id, r.n = 1);
    end if;
  end loop;

  -- ---- appointment documents, in the states the prototype shows -------------
  insert into appointment_documents (company_id, slot, storage_path, filename, approved)
  values
    ((v_co ->> 'BEL')::uuid, 'competency_statement', 'sample/BEL-competency.pdf',
     'BEL-Competency-Statement-Rev2.pdf', true),
    ((v_co ->> 'BEL')::uuid, 'team_cvs', 'sample/BEL-cvs.pdf',
     'BEL-Project-Team-CVs.pdf', true),
    ((v_co ->> 'BEL')::uuid, 'appointment', 'sample/BEL-appointment.pdf',
     'BEL-Appointment-Executed.pdf', true),
    ((v_co ->> 'BEL')::uuid, 'scope_of_work', 'sample/BEL-scope.pdf',
     'BEL-Scope-of-Services-Final.pdf', true),
    ((v_co ->> 'CWC')::uuid, 'competency_statement', 'sample/CWC-competency.pdf',
     'CWC-Competency.pdf', true),
    ((v_co ->> 'CWC')::uuid, 'team_cvs', 'sample/CWC-cvs.pdf', 'CWC-CVs.pdf', true),
    -- deliberately not approved: the register should have something to chase
    ((v_co ->> 'CWC')::uuid, 'appointment', 'sample/CWC-appointment.pdf',
     'CWC-Appointment-Draft-Rev4.pdf', false),
    ((v_co ->> 'CWC')::uuid, 'scope_of_work', 'sample/CWC-scope.pdf',
     'CWC-Scope-BG6-Extract.pdf', true),
    ((v_co ->> 'MBE')::uuid, 'competency_statement', 'sample/MBE-competency.pdf',
     'MBE-Competency-Statement.pdf', true),
    ((v_co ->> 'MBE')::uuid, 'team_cvs', 'sample/MBE-cvs.pdf',
     'MBE-Team-CVs-Rev1.pdf', false),
    ((v_co ->> 'MBE')::uuid, 'scope_of_work', 'sample/MBE-scope.xlsx',
     'MBE-BG6-Proforma-Completed.xlsx', true);

  -- ---- the project record itself, and its two struck-out disciplines --------
  update projects set
    client_name = 'Kingsmead Wharf Developments Ltd',
    address = 'Kingsmead Wharf, Mill Lane, Bristol, BS1 6QT',
    form_of_contract = 'JCT Design and Build 2016 (with amendments)',
    riba_stage = '4',
    start_on_site = date '2026-04-13',
    practical_completion = date '2028-02-25',
    description = '96 apartments over 1,100 m² commercial, 11 storeys, RC frame, '
                  || 'brick and rainscreen facade.'
  where id = p_project;

  insert into project_disciplines (project_id, discipline_code, required)
  values (p_project, 'TR', false), (p_project, 'ID', false)
  on conflict do nothing;

  return format('Seeded %s firms and %s people.',
    (select count(*) from companies where project_id = p_project),
    (select count(*) from project_people where project_id = p_project));
end $$;

grant execute on function seed_sample_project(uuid) to authenticated;
