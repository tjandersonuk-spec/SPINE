-- The published default template libraries.
--
-- Five libraries are meant to ship as published defaults that an account forks
-- and then edits: the DRM library, the checklist templates, the scope
-- templates, the risk library and the warranty library. Only the first was ever
-- written, so four of the five "load from library" paths returned nothing and
-- looked broken rather than empty -- and a template that has no published
-- default cannot be forked, which is most of what those pages do.
--
-- Everything below is written for this product. It is deliberately NOT BG6, not
-- the CIC schedules and not any BREEAM material: those are licensed, are never
-- shipped, and are loaded per-project by whoever holds the licence. What is
-- here is the generic spine of a design manager's checklist, which is not
-- anybody's intellectual property -- an account forks it and replaces whatever
-- it does not agree with.
--
-- Published rows are organisation_id null. Forking copies them to the account;
-- editing a fork never rewrites a project that already loaded a copy.

-- Idempotent as a whole: if a published set already exists, this adds nothing.
-- Re-running it must not double a library that an account has already forked
-- from, because the fork carries the row's identity forward.

-- ------------------------------------------------------------ checklists
insert into checklist_templates (organisation_id, type, reference, heading, title, prompt, discipline, sort_order)
select null, t.type, t.reference, t.heading, t.title, t.prompt, t.discipline, t.n
from (values
  -- ---- pre-construction: what has to be true before anybody starts ----
  ('precon','PRE-01','Appointments','Design team appointments executed','Every designer on the project has an executed appointment, not a letter of intent.','MC',10),
  ('precon','PRE-02','Appointments','Competence and capability recorded','Competence declarations held for every designer, and for the principal designer in particular.','PD',20),
  ('precon','PRE-03','Appointments','Scope of service agreed with no gaps','Each appointment names its duties, and between them they cover the whole design.','MC',30),
  ('precon','PRE-04','Information','Existing information register compiled','Surveys, existing drawings, deeds, and what is known to be missing.','MC',40),
  ('precon','PRE-05','Information','Site surveys commissioned','Topographical, measured building, ground investigation and services surveys.','SUR',50),
  ('precon','PRE-06','Information','Asbestos and contamination position known','Refurbishment and demolition survey, or a stated reason none is required.','MC',60),
  ('precon','PRE-07','Constraints','Planning consent and conditions listed','Every condition, its trigger point, and who discharges it.','MC',70),
  ('precon','PRE-08','Constraints','Party wall and adjoining owner position','Awards, licences and rights of light dealt with or programmed.','SUR',80),
  ('precon','PRE-09','Constraints','Utilities capacity confirmed','Existing capacity, diversions required, and the lead time for each connection.','E',90),
  ('precon','PRE-10','Constraints','Access, logistics and oversail agreed','Site access, crane oversail, hoarding licences and the highway position.','MC',100),
  ('precon','PRE-11','Standards','Employer''s requirements reviewed for buildability','ERs read against the design, with departures recorded rather than assumed.','MC',110),
  ('precon','PRE-12','Standards','Information standard and BEP agreed','Naming convention, suitability codes, the CDE and who does what in it.','MC',120),
  ('precon','PRE-13','Standards','Programme accepted by the design team','Design deliverable dates agreed by the people who have to meet them.','MC',130),
  ('precon','PRE-14','Safety','Pre-construction information issued','PCI issued to everyone who needs it, and the residual risks named in it.','PD',140),
  ('precon','PRE-15','Safety','Higher-risk building status determined','Whether the building is higher-risk, on what basis, and what follows if it is.','PDB',150),

  -- ---- the client's requirements ----
  ('client','CR-01','Brief','Accommodation schedule confirmed','Areas, unit mix and use classes fixed, and any change treated as an instruction.','A',10),
  ('client','CR-02','Brief','Shell and core extent defined','Where the developer''s work stops and a tenant''s fit-out begins.','A',20),
  ('client','CR-03','Brief','Car parking and cycle provision confirmed','Numbers, layout and any provision required by the consent.','C',30),
  ('client','CR-04','Standards','Employer''s requirements compliance','The design demonstrably meets the ER, or departures are recorded and agreed.','MC',40),
  ('client','CR-05','Standards','Residential or occupier specification signed off','Kitchens, bathrooms and finishes agreed before anything is procured against them.','ID',50),
  ('client','CR-06','Standards','Accessibility standard agreed','Which standard applies, to how many units, and evidenced on the drawings.','A',60),
  ('client','CR-07','Sustainability','Sustainability target confirmed','The target rating, and any client requirement that goes beyond it.','SU',70),
  ('client','CR-08','Sustainability','Energy and carbon strategy agreed','The compliance route, and who owns the modelling behind it.','SU',80),
  ('client','CR-09','Operations','Management company requirements captured','What the management company needs, in what form, and when.','MC',90),
  ('client','CR-10','Operations','Warranty and defects arrangements agreed','Structural warranty provider, defects liability period and the collateral warranty schedule.','MC',100),
  ('client','CR-11','Operations','Maintenance and access strategy agreed','How the facade, roof and plant are reached and maintained in use.','A',110),
  ('client','CR-12','Commercial','Sales or letting programme understood','What the design has to deliver, and by when, for the client to sell or let.','MC',120),

  -- ---- handover ----
  ('handover','HO-01','Statutory','Completion certificate obtained','The certificate, and the information handed to the accountable person with it.','PDB',10),
  ('handover','HO-02','Statutory','Fire and emergency file complete','Complete and handed to whoever will hold it in occupation.','FS',20),
  ('handover','HO-03','Statutory','Health and safety file complete','CDM health and safety file, indexed and issued.','PD',30),
  ('handover','HO-04','Statutory','Energy performance certificates lodged','EPCs lodged for every unit that needs one.','SU',40),
  ('handover','HO-05','Statutory','Planning conditions discharged','Every pre-occupation condition discharged and the evidence held.','MC',50),
  ('handover','HO-06','Technical','As-built drawings issued','Full as-built set on the CDE at the agreed status.','A',60),
  ('handover','HO-07','Technical','As-built model issued','Federated model updated to as-built where the BEP requires it.','MC',70),
  ('handover','HO-08','Technical','O&M manuals issued','Operation and maintenance manuals for everything installed.','M',80),
  ('handover','HO-09','Technical','Commissioning records complete','Witnessed commissioning records, with any seasonal commissioning programmed.','M',90),
  ('handover','HO-10','Technical','Test results issued','Air tightness, acoustic, water and electrical test results against the design targets.','SU',100),
  ('handover','HO-11','Technical','Fire stopping records complete','Photographic and location records for every penetration.','FS',110),
  ('handover','HO-12','Commercial','Collateral warranties executed','Every warranty on the schedule executed and delivered.','MC',120),
  ('handover','HO-13','Commercial','Structural warranty issued','Latent defects cover in place for the parties who need it.','MC',130),
  ('handover','HO-14','Operational','Training and demonstration delivered','The people who will operate the building have been shown how.','MC',140),
  ('handover','HO-15','Operational','Building user guide issued','A guide for occupiers, in the form the client asked for.','SU',150),
  ('handover','HO-16','Operational','Landscape maintenance schedule issued','Establishment and replacement obligations written down.','L',160),
  ('handover','HO-17','Operational','Spares and attic stock handed over','Agreed spares, keys and attic stock handed over and receipted.','MC',170),
  ('handover','HO-18','Operational','Defects reporting route agreed','How a defect is reported in the liability period, and to whom.','MC',180),

  -- ---- highways ----
  ('highways','HW-01','Approvals','Technical approval submission made','The highway design submitted for technical approval.','C',10),
  ('highways','HW-02','Approvals','Technical approval obtained','Approval in writing, and any conditions on it understood.','C',20),
  ('highways','HW-03','Agreements','Section 278 agreement executed','Agreement executed and the bond or surety in place.','C',30),
  ('highways','HW-04','Agreements','Section 38 adoptable layout agreed','Layout, levels and construction details agreed for adoption.','C',40),
  ('highways','HW-05','Agreements','Section 38 agreement executed','Agreement executed.','C',50),
  ('highways','HW-06','Agreements','Section 104 drainage agreement','Adoptable drainage agreement with the sewerage undertaker.','C',60),
  ('highways','HW-07','Audits','Stage 1 road safety audit closed out','Audit carried out and every item closed or formally exceptioned.','C',70),
  ('highways','HW-08','Audits','Stage 2 road safety audit closed out','Audit at detailed design, and its items closed out.','C',80),
  ('highways','HW-09','Audits','Stage 3 road safety audit closed out','Audit on completion of the highway works.','C',90),
  ('highways','HW-10','Licences','Hoarding and scaffold licence in place','Licences held for the duration of the works.','MC',100),
  ('highways','HW-11','Licences','Crane oversail agreement in place','Oversail agreed with every affected owner.','MC',110),
  ('highways','HW-12','Licences','Temporary traffic management approved','Closures, diversions and their notice periods agreed.','MC',120),
  ('highways','HW-13','Completion','Highway works certified and adopted','Works certified, maintenance period started and adoption confirmed.','C',130),

  -- ---- utilities ----
  ('utilities','UT-01','Electricity','Electricity supply -- capacity confirmed','Load assessed, capacity confirmed and the point of connection agreed.','E',10),
  ('utilities','UT-02','Electricity','Electricity supply -- quotation accepted','Quotation accepted and the connection programmed against the works.','E',20),
  ('utilities','UT-03','Electricity','Substation position and adoption agreed','Position, access, adoption route and the lease or easement.','E',30),
  ('utilities','UT-04','Electricity','Temporary builder''s supply arranged','Construction phase supply arranged and energised.','MC',40),
  ('utilities','UT-05','Gas','Gas supply position confirmed','Connection required and programmed, or a stated reason none is needed.','M',50),
  ('utilities','UT-06','Water','Potable water connection agreed','Connection, meter position and any boosting requirement.','P',60),
  ('utilities','UT-07','Water','Fire main and hydrant provision confirmed','Provision agreed with the water undertaker and the fire authority.','FS',70),
  ('utilities','UT-08','Drainage','Foul drainage connection agreed','Point of connection, invert level and the adoption position.','C',80),
  ('utilities','UT-09','Drainage','Surface water discharge agreed','Discharge rate, attenuation and the consent to discharge.','C',90),
  ('utilities','UT-10','Telecoms','Telecoms and fibre provider appointed','Provider agreement, wayleave and the installation programme.','E',100),
  ('utilities','UT-11','Diversions','Existing services diversions agreed','Every diversion designed, quoted and programmed before it is needed.','C',110),
  ('utilities','UT-12','Diversions','Statutory undertaker easements resolved','Easements, wayleaves and rights of access recorded.','MC',120)
) as t(type, reference, heading, title, prompt, discipline, n)
where not exists (select 1 from checklist_templates where organisation_id is null);

-- ------------------------------------------------------------ scope of service
-- A scope template is a named row with its own items, never one flat list: a
-- discipline-tagged row added to a single shared template is how a mechanical
-- engineer ends up holding architectural production-information duties.
do $$
declare v_t uuid;
begin
  if exists (select 1 from scope_templates where organisation_id is null) then return; end if;

  -- Core duties, which every appointment carries whatever it is for.
  insert into scope_templates (organisation_id, name, discipline, is_core)
  values (null, 'Core design duties (all disciplines)', null, true) returning id into v_t;
  insert into scope_template_items (template_id, reference, heading, description, riba_stage)
  values
    (v_t,'C01','Management','Attend design team meetings and respond to actions raised at them.','2'),
    (v_t,'C02','Management','Work to the agreed information standard, naming convention and CDE.','2'),
    (v_t,'C03','Management','Issue information to the agreed programme dates and flag slippage as it arises.','3'),
    (v_t,'C04','Management','Coordinate the design with the other disciplines before issuing it.','3'),
    (v_t,'C05','Management','Respond to technical queries and requests for information within the agreed period.','4'),
    (v_t,'C06','Compliance','Design in accordance with the Building Regulations and the applicable standards.','3'),
    (v_t,'C07','Compliance','Discharge the designer duties under the CDM Regulations and record them.','2'),
    (v_t,'C08','Compliance','Provide information for the health and safety file and, where applicable, the golden thread.','5'),
    (v_t,'C09','Change','Notify the effect of any proposed change on cost, programme and compliance before it is made.','4'),
    (v_t,'C10','Handover','Provide as-built information and input to the O&M within the agreed period.','6');

  insert into scope_templates (organisation_id, name, discipline, is_core)
  values (null, 'Architectural services', 'A', false) returning id into v_t;
  insert into scope_template_items (template_id, reference, heading, description, riba_stage)
  values
    (v_t,'A01','Concept','Develop the architectural concept from the brief and test it against the site constraints.','2'),
    (v_t,'A02','Concept','Prepare and submit the planning application drawings and supporting material.','2'),
    (v_t,'A03','Coordination','Produce coordinated general arrangement plans, sections and elevations.','3'),
    (v_t,'A04','Coordination','Agree the spatial coordination of the structure and services within the architectural envelope.','3'),
    (v_t,'A05','Technical','Produce technical design drawings sufficient for construction and for subcontractor procurement.','4'),
    (v_t,'A06','Technical','Prepare the specification, using performance clauses where design is transferred.','4'),
    (v_t,'A07','Technical','Prepare door, window, ironmongery, finishes and sanitaryware schedules.','4'),
    (v_t,'A08','Technical','Detail the external envelope junctions, including waterproofing and airtightness continuity.','4'),
    (v_t,'A09','Construction','Review and comment on contractor design portion submissions within the agreed period.','5'),
    (v_t,'A10','Construction','Carry out periodic inspection and report against the design intent.','5'),
    (v_t,'A11','Handover','Provide as-built architectural information in the agreed format.','6');

  insert into scope_templates (organisation_id, name, discipline, is_core)
  values (null, 'Civil and structural engineering', 'S', false) returning id into v_t;
  insert into scope_template_items (template_id, reference, heading, description, riba_stage)
  values
    (v_t,'S01','Appraisal','Appraise the site and advise on the structural and civil options.','2'),
    (v_t,'S02','Appraisal','Specify and interpret the ground investigation.','2'),
    (v_t,'S03','Design','Design the substructure, including foundations and any retaining structure.','3'),
    (v_t,'S04','Design','Design the superstructure frame, floors, stairs and roof structure.','3'),
    (v_t,'S05','Design','Establish the structural movement, robustness and disproportionate collapse strategy.','3'),
    (v_t,'S06','Technical','Produce construction issue drawings, schedules and calculations.','4'),
    (v_t,'S07','Technical','Define the extent of any contractor-designed structural element and its performance.','4'),
    (v_t,'S08','Civils','Design the below-ground drainage, external levels and any adoptable works.','4'),
    (v_t,'S09','Construction','Review contractor and specialist design submissions against the design intent.','5'),
    (v_t,'S10','Construction','Inspect the works at the agreed hold points and issue the associated certificates.','5');

  insert into scope_templates (organisation_id, name, discipline, is_core)
  values (null, 'Building services engineering', 'M', false) returning id into v_t;
  insert into scope_template_items (template_id, reference, heading, description, riba_stage)
  values
    (v_t,'M01','Strategy','Establish the servicing strategy, including the energy and heat source.','2'),
    (v_t,'M02','Strategy','Assess incoming utility capacity and identify the connections required.','2'),
    (v_t,'M03','Design','Design the mechanical, electrical and public health systems to the agreed level of information.','3'),
    (v_t,'M04','Design','Establish plant space, plant loads, riser sizes and access for maintenance and replacement.','3'),
    (v_t,'M05','Compliance','Carry out the energy and overheating modelling required to demonstrate compliance.','3'),
    (v_t,'M06','Technical','Produce schematics, layouts, schedules and specifications for construction and procurement.','4'),
    (v_t,'M07','Technical','Define the extent of installation design transferred to the subcontractor.','4'),
    (v_t,'M08','Technical','Coordinate builderswork and service penetrations with the structure and the fire strategy.','4'),
    (v_t,'M09','Construction','Review subcontractor design submissions and technical submittals.','5'),
    (v_t,'M10','Commissioning','Specify the commissioning regime and witness commissioning against it.','5'),
    (v_t,'M11','Handover','Review the O&M manuals and the record information before handover.','6');

  insert into scope_templates (organisation_id, name, discipline, is_core)
  values (null, 'Fire engineering', 'FS', false) returning id into v_t;
  insert into scope_template_items (template_id, reference, heading, description, riba_stage)
  values
    (v_t,'F01','Strategy','Prepare the fire strategy and keep it current as the design develops.','2'),
    (v_t,'F02','Strategy','Establish the evacuation strategy and agree it with the relevant authorities.','3'),
    (v_t,'F03','Design','Define compartmentation, travel distances and the means of escape.','3'),
    (v_t,'F04','Design','Advise on external wall construction and the materials permitted in it.','3'),
    (v_t,'F05','Design','Specify the fire safety systems and their interfaces with the other services.','4'),
    (v_t,'F06','Compliance','Support the building control and gateway submissions with the necessary evidence.','4'),
    (v_t,'F07','Construction','Review submissions affecting fire safety and inspect the fire stopping regime.','5'),
    (v_t,'F08','Handover','Provide the fire safety information required for the fire and emergency file.','6');

  insert into scope_templates (organisation_id, name, discipline, is_core)
  values (null, 'Landscape architecture', 'L', false) returning id into v_t;
  insert into scope_template_items (template_id, reference, heading, description, riba_stage)
  values
    (v_t,'L01','Concept','Develop the landscape and public realm concept and support the planning application.','2'),
    (v_t,'L02','Design','Design the hard landscape, levels, surfaces and boundary treatments.','3'),
    (v_t,'L03','Design','Design the soft landscape and planting, including any biodiversity requirement.','3'),
    (v_t,'L04','Coordination','Coordinate the landscape with drainage, services, substations and podium waterproofing.','3'),
    (v_t,'L05','Technical','Produce construction details, planting schedules and the specification.','4'),
    (v_t,'L06','Construction','Inspect the landscape works and agree the plant quality on delivery.','5'),
    (v_t,'L07','Handover','Provide the establishment and maintenance schedule.','6');
end $$;

-- ------------------------------------------------------------ risk library
insert into risk_templates (organisation_id, reference, kind, title, description, category, likelihood, sort_order)
select null, t.reference, t.kind, t.title, t.description, t.category, t.likelihood, t.n
from (values
  ('RL-01','risk','Design information later than the programme requires','A discipline''s deliverables slip and hold procurement or construction behind them.','Programme',4,10),
  ('RL-02','risk','A discipline is unappointed when its information is needed','A duty on the matrix has no firm holding it, and nobody notices until the date passes.','Appointment',3,20),
  ('RL-03','risk','Contractor design portion submissions arrive late','A specialist''s design is behind and the work it feeds cannot start.','Programme',4,30),
  ('RL-04','risk','Ground conditions worse than the investigation assumed','Made ground, obstructions or water found that the GI did not predict.','Technical',3,40),
  ('RL-05','risk','Existing services found in an unrecorded position','A live service is discovered where no record showed one.','Technical',3,50),
  ('RL-06','risk','Planning condition cannot be discharged in time','A pre-commencement or pre-occupation condition holds the works.','Statutory',3,60),
  ('RL-07','risk','Building control or gateway approval delayed','The approval takes longer than the programme allowed for.','Statutory',3,70),
  ('RL-08','risk','External wall materials do not meet the required standard','A specified product or its supporting system fails the compliance test.','Compliance',2,80),
  ('RL-09','risk','Fire strategy changes after the design is fixed','A change to escape, compartmentation or suppression after drawings are issued.','Compliance',2,90),
  ('RL-10','risk','Acoustic performance fails on test','Pre-completion testing does not achieve the required separation.','Technical',2,100),
  ('RL-11','risk','Air tightness fails on test','The tested result does not achieve the figure the energy model assumed.','Technical',3,110),
  ('RL-12','risk','Overheating assessment forces a design change','The assessment fails and mitigation has to be designed in late.','Compliance',3,120),
  ('RL-13','risk','Utility connection lead time exceeds the programme','A connection cannot be delivered by the date the building needs it.','Programme',3,130),
  ('RL-14','risk','Highway agreement not concluded before it is needed','A section agreement is outstanding when the works have to start.','Statutory',3,140),
  ('RL-15','risk','Material lead time longer than assumed','A specified product cannot be delivered within the construction programme.','Procurement',3,150),
  ('RL-16','risk','Specified product becomes unavailable','A product is discontinued or unobtainable and has to be substituted.','Procurement',2,160),
  ('RL-17','risk','Interface between two packages is nobody''s design','A junction falls between two appointments and neither has designed it.','Coordination',3,170),
  ('RL-18','risk','Clash found after fabrication has started','A coordination error is found once components are being made.','Coordination',2,180),
  ('RL-19','risk','Client change instructed after the design is frozen','A late instruction requires design already issued to be revisited.','Client change',3,190),
  ('RL-20','risk','Cost plan exceeded by the developed design','The design as developed cannot be built for the money allowed.','Commercial',3,200),
  ('RL-21','risk','Consultant fee dispute interrupts information flow','A commercial disagreement slows or stops a discipline''s output.','Commercial',2,210),
  ('RL-22','risk','Golden thread information incomplete at completion','The information required at completion has not been assembled as the work proceeded.','Compliance',3,220),
  ('RL-23','risk','As-built information not delivered at handover','Record information is outstanding when the building is occupied.','Handover',3,230),
  ('RL-24','risk','Collateral warranties outstanding at completion','Warranties on the schedule are not executed when they are needed.','Commercial',3,240),
  ('RL-25','risk','Adjoining owner matter delays the works','A party wall award, right of light or access agreement is unresolved.','Statutory',2,250),
  ('RL-26','risk','Weather or seasonal constraint delays a survey','A survey with a seasonal window is missed and cannot be repeated until the next one.','Programme',2,260),
  ('OL-01','opportunity','Value engineer the structural frame','Review the frame for a lighter or simpler solution once the loads are fixed.','Technical',3,300),
  ('OL-02','opportunity','Combine adjacent packages under one subcontractor','Removing an interface removes both a risk and a duplicated preliminary.','Commercial',3,310),
  ('OL-03','opportunity','Reuse site-won material','Crushed material reused as fill instead of imported and disposed of.','Sustainability',3,320),
  ('OL-04','opportunity','Standardise details across the building','Fewer unique details means less design time and fewer errors on site.','Technical',4,330),
  ('OL-05','opportunity','Offsite manufacture for a repeated element','A repeated element made offsite improves quality and shortens the programme.','Programme',3,340),
  ('OL-06','opportunity','Early contractor involvement on a key package','Bringing a specialist in early removes rework later.','Programme',4,350),
  ('OL-07','opportunity','Reduce embodied carbon through material substitution','A lower-carbon specification that meets the same performance.','Sustainability',3,360),
  ('OL-08','opportunity','Negotiate a longer product guarantee','A longer guarantee at little or no cost where the volume supports it.','Commercial',3,370)
) as t(reference, kind, title, description, category, likelihood, n)
where not exists (select 1 from risk_templates where organisation_id is null);

-- ------------------------------------------------------------ warranty library
-- Each row names the DRM reference it answers to, because a warranty resolves
-- its owner live through that duty's lead discipline. There is no company here
-- and there must never be one.
insert into warranty_templates (organisation_id, reference, drm_ref, title, description, period_years, beneficiary, form, sort_order)
select null, t.reference, t.drm_ref, t.title, t.description, t.years, t.beneficiary, t.form, t.n
from (values
  ('WL-01','08.010','Fire engineer collateral warranty','Collateral warranty from the fire engineer.',12,'Client and funder','Collateral warranty',10),
  ('WL-02','03.010','Structural engineer collateral warranty','Collateral warranty from the civil and structural engineer.',12,'Client and funder','Collateral warranty',20),
  ('WL-03','06.090','Building services engineer collateral warranty','Collateral warranty from the building services engineer.',12,'Client and funder','Collateral warranty',30),
  ('WL-04','04.020','Architect collateral warranty','Collateral warranty from the architect.',12,'Client and funder','Collateral warranty',40),
  ('WL-05','04.010','Facade subcontractor warranty','Subcontractor collateral warranty for the facade package.',12,'Client and funder','Subcontractor collateral warranty',50),
  ('WL-06','04.030','Curtain walling and glazing warranty','Warranty for the curtain walling or structural glazing package.',12,'Client and funder','Subcontractor collateral warranty',60),
  ('WL-07','04.060','Roof covering and waterproofing guarantee','Manufacturer''s guarantee for the roof covering, including workmanship.',20,'Client','Manufacturer guarantee',70),
  ('WL-08','02.040','Below-ground waterproofing guarantee','Guarantee for the below-ground waterproofing system.',20,'Client','Manufacturer guarantee',80),
  ('WL-09','04.070','Balcony and terrace waterproofing guarantee','Guarantee for the waterproofing to balconies, terraces and podium decks.',20,'Client and management company','Manufacturer guarantee',90),
  ('WL-10','06.160','Lift installation warranty','Lift supplier warranty and the first period of maintenance.',2,'Management company','Supplier warranty',100),
  ('WL-11','06.130','Fire suppression system warranty','Warranty for the sprinkler or suppression installation.',12,'Client','Subcontractor collateral warranty',110),
  ('WL-12','06.050','Fire alarm and detection warranty','Warranty for the fire alarm and detection installation.',12,'Client','Subcontractor collateral warranty',120),
  ('WL-13','06.170','Renewable energy system warranty','Warranty for the renewable or low carbon plant.',10,'Client and management company','Supplier warranty',130),
  ('WL-14','07.020','Landscape establishment guarantee','Establishment and replacement guarantee for the planting.',5,'Management company','Contract appendix',140),
  ('WL-15','07.050','Drainage and SuDS installation warranty','Warranty for the surface water drainage and SuDS installation.',12,'Client','Subcontractor collateral warranty',150),
  ('WL-16','02.010','Structural warranty / latent defects cover','Latent defects insurance for the completed building.',10,'Client and purchasers','Latent defects policy',160)
) as t(reference, drm_ref, title, description, years, beneficiary, form, n)
where not exists (select 1 from warranty_templates where organisation_id is null);
