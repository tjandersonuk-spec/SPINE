-- Phase 3 — the design responsibility matrix.
-- Reference: handover §3 (DRM tables and v_drm_gaps), §1a (templates are a
-- tenant asset forked from a published default).
--
-- This is the module the whole application exists for, and the shape follows
-- from the first spine. A matrix item names a LEAD DISCIPLINE, never a company.
-- Which company that resolves to is asked live, so novating the architect moves
-- every item they led without a single write to the matrix.
--
-- A gap is one of two things, and the distinction matters because the fix is
-- different: an applicable item with no lead discipline at all, which is a
-- decision nobody has made; or an item whose lead discipline nobody appointed
-- holds, which is a decision made and then not resourced.
--
-- The library follows the template rule: a published default, a fork per
-- account, and a versioned snapshot taken into each project. Editing the
-- library never reaches a project that already loaded a copy — a matrix is a
-- record of who was responsible for what, and rewriting it retrospectively
-- would destroy the thing it is for.

-- The version of the library this project's matrix was taken from. Stamped at
-- load and never re-read: it records which edition of the standard the job was
-- set up against, which is a fact about the past.
alter table projects add column if not exists drm_library_version text;

create table drm_categories (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id) on delete cascade, -- null = published
  code            text not null,
  name            text not null,
  sort_order      int not null default 0
);
create unique index drm_categories_account_code on drm_categories (organisation_id, code)
  where organisation_id is not null;
create unique index drm_categories_published_code on drm_categories (code)
  where organisation_id is null;

create table drm_library_items (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid references organisations(id) on delete cascade,
  library_version         text not null default 'published-1',
  ref                     text not null,
  category_code           text not null,
  item                    text not null,
  -- Nullable on purpose. Three interface items ship with no default lead
  -- because there is no right answer in general: who owns the facade-to-frame
  -- junction is a decision each project has to make consciously, and a default
  -- would let it be made by not looking.
  default_lead_discipline text,
  cdp_likely              boolean not null default false,
  guidance_note           text,
  sort_order              int not null default 0,
  created_at              timestamptz not null default now()
);
create unique index drm_library_account_ref
  on drm_library_items (organisation_id, library_version, ref) where organisation_id is not null;
create unique index drm_library_published_ref
  on drm_library_items (library_version, ref) where organisation_id is null;

-- The project's own copy. Taken once, at load, and independent from then on.
create table drm_items (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  library_item_id   uuid references drm_library_items(id) on delete set null, -- null = bespoke
  ref               text not null,
  category_code     text not null,
  item              text not null,
  lead_discipline   text,                    -- null = gap, and a deliberate one is still a gap
  transfers_at_stage text,
  cdp_package       text,
  level_of_information text,
  applicable        boolean not null default true,
  guidance_note     text,
  notes             text,
  created_at        timestamptz not null default now(),
  unique (project_id, ref)
);
create index drm_items_project_idx on drm_items (project_id);

-- Everyone else's involvement. The lead is on the item; these are the
-- supporting, reviewing, contributing, approving and informed disciplines.
create table drm_roles (
  drm_item_id     uuid not null references drm_items(id) on delete cascade,
  discipline_code text not null,
  role_code       text not null check (role_code in ('S','R','C','A','I')),
  primary key (drm_item_id, discipline_code)
);

-- categories
insert into drm_categories (organisation_id, code, name, sort_order) values
  (null, '01', 'Site, Survey and Enabling', 10),
  (null, '02', 'Substructure', 20),
  (null, '03', 'Superstructure', 30),
  (null, '04', 'Building Envelope', 40),
  (null, '05', 'Internal Fabric and Fit-out', 50),
  (null, '06', 'Mechanical, Electrical and Public Health', 60),
  (null, '07', 'External Works and Infrastructure', 70),
  (null, '08', 'Compliance, Performance and Statutory', 80),
  (null, '09', 'Interfaces and Coordination', 90);

-- library items
insert into drm_library_items (organisation_id, ref, category_code, item, default_lead_discipline, cdp_likely, guidance_note, sort_order) values
  (null, '01.010', '01', 'Topographical and measured building survey', 'SUR', false, 'Confirm datum and coordinate system with all parties at Stage 1.', 10),
  (null, '01.020', '01', 'Ground investigation and geotechnical interpretation', 'GE', false, '', 20),
  (null, '01.030', '01', 'Contamination assessment and remediation strategy', 'GE', false, 'Verification report is usually a planning condition.', 30),
  (null, '01.040', '01', 'Existing services survey and diversion strategy', 'C', false, 'Commonly a gap. Confirm who leads diversion negotiations.', 40),
  (null, '01.050', '01', 'Demolition design and structural stability', 'S', true, '', 50),
  (null, '01.060', '01', 'Temporary works design', 'MC', true, 'Requires a named Temporary Works Coordinator (BS 5975).', 60),
  (null, '01.070', '01', 'Site logistics and construction phase planning', 'MC', false, '', 70),
  (null, '01.080', '01', 'Party wall awards and adjacent owner matters', 'SUR', false, '', 80),
  (null, '02.010', '02', 'Foundation design', 'S', false, '', 90),
  (null, '02.020', '02', 'Piling design', 'S', true, 'Consultant designs layout and loads; specialist designs the pile. State the split.', 100),
  (null, '02.030', '02', 'Basement / retaining structure design', 'S', false, '', 110),
  (null, '02.040', '02', 'Below-ground waterproofing', 'A', true, 'BS 8102 requires a Waterproofing Design Specialist. Frequent gap.', 120),
  (null, '02.050', '02', 'Ground bearing slabs and ground floor construction', 'S', false, 'Interface with architect on build-up and thermal line.', 130),
  (null, '02.060', '02', 'Below-ground drainage', 'C', false, 'Confirm handover point with public health engineer.', 140),
  (null, '02.070', '02', 'Ground gas protection', 'GE', true, '', 150),
  (null, '03.010', '03', 'Primary structural frame', 'S', false, '', 160),
  (null, '03.020', '03', 'Upper floor construction', 'S', true, '', 170),
  (null, '03.030', '03', 'Structural connections and steelwork fabrication design', 'S', true, 'Classic transfer item — moves to steelwork subcontractor at Stage 4/5.', 180),
  (null, '03.040', '03', 'Stairs and stair cores', 'S', true, 'Split between structural support and architectural finish is ambiguous.', 190),
  (null, '03.050', '03', 'Roof structure', 'S', false, 'Plant loads must be confirmed by MEP before design freeze.', 200),
  (null, '03.060', '03', 'Load-bearing masonry and blockwork', 'S', false, '', 210),
  (null, '03.070', '03', 'Light gauge steel / SFS framing', 'S', true, 'Almost always CDP. Confirm who sets deflection limits.', 220),
  (null, '03.080', '03', 'Structural movement and settlement strategy', 'S', false, 'Must coordinate with facade and finishes. Frequently unowned.', 230),
  (null, '03.090', '03', 'Structural fire protection', 'S', true, 'Interface between structural engineer, fire engineer and applicator.', 240),
  (null, '04.010', '04', 'Facade system design and performance specification', 'FE', true, '', 250),
  (null, '04.020', '04', 'Rainscreen and cladding', 'A', true, 'Confirm combustibility compliance responsibility explicitly.', 260),
  (null, '04.030', '04', 'Curtain walling and structural glazing', 'FE', true, '', 270),
  (null, '04.040', '04', 'Masonry external walls and brickwork', 'A', false, '', 280),
  (null, '04.050', '04', 'Windows and external doors', 'A', true, '', 290),
  (null, '04.060', '04', 'Roof coverings and waterproofing', 'A', true, 'Confirm who designs falls — architect, engineer or specialist.', 300),
  (null, '04.070', '04', 'Balconies, terraces and walkways', 'A', true, 'High risk: four disciplines and a subcontractor all touch it.', 310),
  (null, '04.080', '04', 'Parapets, copings and flashings', 'A', false, '', 320),
  (null, '04.090', '04', 'External soffits and undercrofts', 'A', true, '', 330),
  (null, '04.100', '04', 'Fire stopping and cavity barriers in facade', 'FS', true, 'Chronic gap item. Assign a single lead and hold it.', 340),
  (null, '04.110', '04', 'Airtightness strategy and line of continuity', 'A', false, 'Must be drawn as a continuous line on every section, by one party.', 350),
  (null, '04.120', '04', 'Thermal bridging and junction detailing', 'SU', false, '', 360),
  (null, '04.130', '04', 'Facade access and maintenance strategy', 'A', true, 'Frequently forgotten until Stage 5.', 370),
  (null, '05.010', '05', 'Internal partitions and linings', 'A', false, '', 380),
  (null, '05.020', '05', 'Internal doors and ironmongery', 'A', true, 'Ironmongery / access control interface is a common gap.', 390),
  (null, '05.030', '05', 'Ceilings and access strategy', 'A', false, 'Reflected ceiling plan coordination with MEP — assign it.', 400),
  (null, '05.040', '05', 'Floor finishes and build-ups', 'A', false, '', 410),
  (null, '05.050', '05', 'Wall finishes and decoration', 'A', false, '', 420),
  (null, '05.060', '05', 'Joinery, fitted furniture and kitchens', 'ID', true, '', 430),
  (null, '05.070', '05', 'Sanitaryware and washroom fit-out', 'A', true, '', 440),
  (null, '05.080', '05', 'Signage and wayfinding', 'A', true, 'Statutory fire signage responsibility is often assumed by nobody.', 450),
  (null, '05.090', '05', 'Loose furniture, fittings and equipment (FF&E)', 'ID', false, '', 460),
  (null, '05.100', '05', 'Internal acoustic separation', 'AC', false, '', 470),
  (null, '06.010', '06', 'Incoming utilities and connections', 'E', false, 'Assign who submits and chases applications — programme critical.', 480),
  (null, '06.020', '06', 'LV distribution and switchgear', 'E', true, '', 490),
  (null, '06.030', '06', 'Small power and containment', 'E', true, '', 500),
  (null, '06.040', '06', 'Lighting design and controls', 'E', true, 'State the split between decorative and functional lighting.', 510),
  (null, '06.050', '06', 'Fire alarm and detection', 'E', true, 'Cause and effect matrix ownership is a classic gap.', 520),
  (null, '06.060', '06', 'Lightning protection and earthing', 'E', true, '', 530),
  (null, '06.070', '06', 'Security, access control and CCTV', 'E', true, '', 540),
  (null, '06.080', '06', 'Communications, data and AV', 'E', true, '', 550),
  (null, '06.090', '06', 'Heating and hot water generation', 'M', true, '', 560),
  (null, '06.100', '06', 'Ventilation and air quality', 'M', true, '', 570),
  (null, '06.110', '06', 'Cooling and refrigeration', 'M', true, '', 580),
  (null, '06.120', '06', 'Smoke control and AOV systems', 'FS', true, 'Fire engineer sets strategy, specialist designs system. State the boundary.', 590),
  (null, '06.130', '06', 'Sprinklers and fire suppression', 'FS', true, '', 600),
  (null, '06.140', '06', 'Above-ground drainage', 'P', false, '', 610),
  (null, '06.150', '06', 'Cold and hot water services', 'P', false, '', 620),
  (null, '06.160', '06', 'Lifts and vertical transportation', 'VT', true, 'Shaft tolerances and builderswork are a recurring dispute.', 630),
  (null, '06.170', '06', 'Renewable energy systems', 'M', true, '', 640),
  (null, '06.180', '06', 'BMS, controls and metering', 'M', true, '', 650),
  (null, '06.190', '06', 'Plant space, plant loads and access', 'M', false, '', 660),
  (null, '06.200', '06', 'Commissioning and O&M strategy', 'M', true, '', 670),
  (null, '07.010', '07', 'Hard landscape design', 'L', false, 'Levels interface with civil engineer needs a single owner.', 680),
  (null, '07.020', '07', 'Soft landscape and planting', 'L', false, '', 690),
  (null, '07.030', '07', 'Boundary treatments and gates', 'L', true, '', 700),
  (null, '07.040', '07', 'External lighting', 'E', true, 'Frequent conflict between landscape aesthetic and engineered levels.', 710),
  (null, '07.050', '07', 'Surface water drainage and SuDS', 'C', false, 'Usually a planning condition and an s104 matter.', 720),
  (null, '07.060', '07', 'Roads, access and adoptable works', 'TR', false, '', 730),
  (null, '07.070', '07', 'Car parking, cycle storage and EV charging', 'A', false, '', 740),
  (null, '07.080', '07', 'Refuse and servicing strategy', 'A', false, '', 750),
  (null, '08.010', '08', 'Fire strategy', 'FS', false, '', 760),
  (null, '08.020', '08', 'Building Safety Act / Gateway compliance', 'PDB', false, 'Building Safety Act principal designer. A separate appointment from the CDM role — check they are not assumed to be the same firm.', 770),
  (null, '08.030', '08', 'CDM and pre-construction information', 'PD', false, 'CDM 2015 principal designer. Distinct from the Building Safety Act role in 08.020.', 780),
  (null, '08.040', '08', 'Accessibility and inclusive design', 'A', false, '', 790),
  (null, '08.050', '08', 'Part L / energy compliance modelling', 'SU', false, '', 800),
  (null, '08.060', '08', 'Part O overheating assessment', 'SU', false, 'Mitigation affects facade openings — coordinate before Stage 4 freeze.', 810),
  (null, '08.070', '08', 'Daylight, sunlight and overshadowing', 'SU', false, '', 820),
  (null, '08.080', '08', 'Acoustic design and external noise', 'AC', false, '', 830),
  (null, '08.090', '08', 'BREEAM / sustainability assessment', 'BR', false, 'Evidence deadlines must be programme-linked.', 840),
  (null, '08.100', '08', 'Ecology and biodiversity net gain', 'EC', false, '', 850),
  (null, '08.110', '08', 'Transport assessment and travel plan', 'TR', false, '', 860),
  (null, '08.120', '08', 'Wind microclimate', 'SU', false, '', 870),
  (null, '08.130', '08', 'Secured by Design / security strategy', 'A', false, '', 880),
  (null, '08.140', '08', 'Site waste and circular economy', 'SU', false, '', 890),
  (null, '08.150', '08', 'Embodied carbon assessment', 'SU', false, '', 900),
  (null, '09.010', '09', 'Facade to structural frame interface', null, true, 'Left unassigned deliberately — must be a conscious project decision.', 910),
  (null, '09.020', '09', 'Roof to wall interface', null, false, 'Left unassigned deliberately. Two systems, two subcontractors, one leak.', 920),
  (null, '09.030', '09', 'Service penetrations and fire stopping', 'FS', true, '', 930),
  (null, '09.040', '09', 'Builderswork in connection (BWIC)', 'M', false, 'MEP marks up, structural engineer approves. State both sides.', 940),
  (null, '09.050', '09', 'Below-ground to above-ground drainage interface', null, false, 'Left unassigned deliberately. Define the physical handover point.', 950),
  (null, '09.060', '09', 'Building to external works levels interface', 'A', false, '', 960),
  (null, '09.070', '09', 'Waterproofing continuity at junctions', 'A', true, '', 970),
  (null, '09.080', '09', 'Federated model coordination and clash resolution', 'MC', false, 'Define who chairs clash resolution and who has final say.', 980),
  (null, '09.090', '09', 'Design change control and technical query process', 'MC', false, '', 990),
  (null, '09.100', '09', 'As-built information and handover deliverables', 'MC', false, '', 1000);