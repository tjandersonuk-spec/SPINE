-- Sample data for every module after the directory and the programme.
--
-- `seed_sample_project()` and `seed_sample_programme()` already build a
-- believable job up to phase 4: sixteen firms, their people, the disciplines
-- they hold, and thirty-six programme lines. Everything after that -- the
-- register, the checklists, the money, the risks -- was empty, so most of the
-- product could only be looked at rather than used.
--
-- This fills the rest of Kingsmead Wharf Block C. It is one story, not a pile
-- of rows: the same job, at the same moment (Stage 4 technical design running
-- late on facade and MEP, Gateway 2 approved, piling under way), seen from
-- every module. Where a module needs something to be wrong for its page to
-- mean anything -- an overdue drawing, an unallocated duty, a rejected sample,
-- a change nobody may proceed with -- the wrongness is deliberate and is
-- commented where it is written.
--
-- Two rules this seed keeps rather than works around:
--
--   * No date is typed. Every dated row anchors to a programme UID with an
--     offset, exactly as a real one must, so re-importing the programme moves
--     the sample data too. The handful of `due_date_override` values are the
--     ones a real project would also override.
--   * No licensed content is shipped. The BREEAM scheme here is a FICTIONAL
--     scheme with invented section codes and invented issue titles. It
--     exercises the scoring, the prerequisites and the minimum standards
--     without shipping a word of BRE's. A licence holder loads the real thing
--     over the top with `breeam_import_apply()`.
--
-- The sub-functions are `security definer` with no grant: only
-- `seed_sample_data()` calls them, and it is the one place the account-admin
-- check lives. A caller who could invoke them directly would be seeding a
-- project they may not be an admin of.

-- ---------------------------------------------------------------- helpers
-- Resolving a company by its originator code and a person by their name keeps
-- the data below readable. Both are scoped to the project, so a code that is
-- reused on another job cannot be picked up by accident.
create or replace function sample_co(p_project uuid, p_code text)
returns uuid language sql stable as $$
  select id from companies where project_id = p_project and originator_code = p_code
$$;

create or replace function sample_person(p_project uuid, p_name text)
returns uuid language sql stable as $$
  select pp.id from project_people pp
  where pp.project_id = p_project and pp.name = p_name
  limit 1
$$;

-- A generated reference counter has to be carried forward the moment the rows
-- that used those references exist, not at the end: realise_risk() asks
-- next_reference() for a task number while the seed is still running, and a
-- counter still at zero hands it TSK-001 on top of the seeded one.
create or replace function sample_seq(p_project uuid, p_kind text, p_n bigint)
returns void language sql as $$
  insert into project_sequences (project_id, kind, last_value)
  values (p_project, p_kind, p_n)
  on conflict (project_id, kind) do update
    set last_value = greatest(project_sequences.last_value, excluded.last_value)
$$;

revoke execute on function sample_co(uuid, text) from public, anon, authenticated;
revoke execute on function sample_person(uuid, text) from public, anon, authenticated;
revoke execute on function sample_seq(uuid, text, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------- set up
-- The responsibility matrix, the scope of service, the BEP and the facts about
-- the building that the Building Safety Act pages read.
create or replace function seed_sample_setup(p_project uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_drm int := 0;
  v_scope int := 0;
  r record;
begin
  select organisation_id into v_org from projects where id = p_project;

  -- ---- the building itself -------------------------------------------------
  -- Eleven storeys and residential: a higher-risk building, so the BSA module
  -- has something to be about. Gateway 2 was approved on the programme's own
  -- milestone date rather than a date typed here.
  update projects set
    hrb = true,
    hrb_reason = 'Residential, 11 storeys / 34.2m to the finished floor level of '
              || 'the top storey. Two residential units or more above 18m, so a '
              || 'higher-risk building under s.65 BSA 2022.',
    g2_reference = 'BSR/G2/2026/04417',
    g2_approved_date = (select finish_date from programme_tasks
                        where project_id = p_project and task_uid = '1221'),
    commencement_notified = (select start_date from programme_tasks
                             where project_id = p_project and task_uid = '1420'),
    hrb_notify_days = 14,
    hrb_major_weeks = 6
  where id = p_project;

  -- ---- the responsibility matrix -------------------------------------------
  if not exists (select 1 from drm_items where project_id = p_project) then
    perform load_drm_into_project(p_project);
    select count(*) into v_drm from drm_items where project_id = p_project;

    -- Leads, by category. The library carries a default lead discipline; this
    -- accepts it wherever exactly one firm holds that discipline, which is the
    -- same rule sole_holder() applies when a template is applied by hand.
    update drm_items d
    set lead_discipline = l.default_lead_discipline
    from drm_library_items l
    where d.library_item_id = l.id
      and d.project_id = p_project
      and l.default_lead_discipline is not null
      and sole_holder(p_project, l.default_lead_discipline) is not null;

    -- And the responsibility codes behind the lead: who supports, who reviews,
    -- who is consulted, who approves, who is informed. Only for the items that
    -- found a lead -- a role matrix on an unallocated duty is a fiction.
    insert into drm_roles (drm_item_id, discipline_code, role_code)
    select d.id, d.lead_discipline, 'R'
    from drm_items d where d.project_id = p_project and d.lead_discipline is not null
    on conflict do nothing;

    insert into drm_roles (drm_item_id, discipline_code, role_code)
    select d.id, 'MC', 'A'
    from drm_items d where d.project_id = p_project and d.lead_discipline is not null
    on conflict do nothing;

    -- The architect is consulted on anything the architect does not lead, and
    -- the principal designer is informed of everything: both are true of a real
    -- matrix and both give the roles column something to show.
    insert into drm_roles (drm_item_id, discipline_code, role_code)
    select d.id, 'A', 'C'
    from drm_items d
    where d.project_id = p_project and d.lead_discipline is not null
      and d.lead_discipline <> 'A' and d.category_code in ('03','04','05')
    on conflict do nothing;

    insert into drm_roles (drm_item_id, discipline_code, role_code)
    select d.id, 'PD', 'I'
    from drm_items d where d.project_id = p_project and d.lead_discipline is not null
    on conflict do nothing;

    -- Contractor's design portion, stated where the library expects it.
    update drm_items d
    set cdp_package = case d.lead_discipline
                        when 'FE' then 'Facade -- performance specified'
                        when 'SC' then 'Structural steel connections'
                        when 'M' then 'MEP installation design'
                        when 'E' then 'MEP installation design'
                        when 'P' then 'MEP installation design'
                        else null end,
        transfers_at_stage = case when d.lead_discipline in ('FE','SC','M','E','P')
                                  then '4' else null end
    from drm_library_items l
    where d.library_item_id = l.id and d.project_id = p_project and l.cdp_likely;

    -- Four duties are deliberately left with nobody: lifts, ecology, building
    -- control and transport have no firm holding the discipline, so the matrix
    -- opens with real gaps to allocate rather than a clean sheet.
    update drm_items set lead_discipline = null
    where project_id = p_project and lead_discipline in ('VT','EC','BC','TR');
  end if;

  -- ---- appointment documents for the rest of the team -----------------------
  -- Without these every firm shows four gaps and the health sort has nothing to
  -- separate them by, which makes a sort order look broken rather than flat.
  -- Two firms are left deliberately incomplete: they are the ones to chase.
  insert into appointment_documents (company_id, slot, storage_path, filename, approved)
  select sample_co(p_project, d.co), d.slot,
         'sample/' || d.co || '-' || d.slot || '.pdf',
         d.co || '-' || initcap(replace(d.slot, '_', ' ')) || '.pdf', d.ok
  from (values
    ('RFC','competency_statement',true), ('RFC','team_cvs',true),
    ('RFC','appointment',true), ('RFC','scope_of_work',true),
    ('CAL','competency_statement',true), ('CAL','team_cvs',true),
    ('CAL','appointment',true), ('CAL','scope_of_work',true),
    ('NLS','competency_statement',true), ('NLS','team_cvs',true),
    ('NLS','appointment',true), ('NLS','scope_of_work',true),
    ('MBS','competency_statement',true), ('MBS','team_cvs',true),
    ('MBS','appointment',true), ('MBS','scope_of_work',true),
    ('WHS','competency_statement',true), ('WHS','team_cvs',true),
    ('WHS','appointment',true), ('WHS','scope_of_work',true),
    ('PVL','competency_statement',true), ('PVL','team_cvs',true),
    ('PVL','appointment',true), ('PVL','scope_of_work',true),
    ('VLS','competency_statement',true), ('VLS','team_cvs',true),
    ('VLS','appointment',true), ('VLS','scope_of_work',true),
    ('TGE','competency_statement',true), ('TGE','team_cvs',true),
    ('TGE','appointment',true), ('TGE','scope_of_work',true),
    ('HWS','competency_statement',true), ('HWS','team_cvs',true),
    ('HWS','appointment',true), ('HWS','scope_of_work',true),
    -- The facade subcontractor is on site work before its appointment is
    -- executed, which is the finding the appointment register exists to make.
    ('AFA','competency_statement',true), ('AFA','team_cvs',false),
    -- And the heritage consultant has nothing at all.
    ('LAT','competency_statement',false)
  ) as d(co, slot, ok)
  where sample_co(p_project, d.co) is not null
  on conflict do nothing;

  -- ---- BEP -----------------------------------------------------------------
  perform seed_bep(p_project);

  -- The building is eleven storeys, so the level codes have to reach eleven.
  -- Without them every drawing above level 03 fails the naming check, which
  -- would make the check look wrong rather than the number.
  insert into bep_field_values (field_id, code, description)
  select f.id, lpad(n::text, 2, '0'), 'Level ' || lpad(n::text, 2, '0')
  from bep_fields f, generate_series(4, 11) as n
  where f.project_id = p_project and f.position = 4
  on conflict do nothing;

  -- ---- scope of service ----------------------------------------------------
  -- No scope template library ships, so these are written as applied rows,
  -- carrying the template name they came from exactly as an applied row does.
  if not exists (select 1 from tracked_items where project_id = p_project and kind = 'scope') then
    for r in
      select * from (values
        ('BEL','Architectural services (RIBA 2020)','A', 1),
        ('CWC','Civil and structural services (RIBA 2020)','S', 1),
        ('MBE','Building services engineering (CIBSE)','M', 1),
        ('AFA','Facade contractor design portion','FE', 1)
      ) as t(code, tmpl, disc, n)
    loop
      insert into tracked_items (project_id, kind, reference, heading, title, prompt,
        discipline, company_id, status, template_name, programme_task_uid,
        offset_days, anchor, created_by)
      select p_project, 'scope', r.code || '-' || s.ref, s.heading, s.title, s.prompt,
             r.disc, sample_co(p_project, r.code), s.status, r.tmpl, s.uid, s.off,
             'finish', auth.uid()
      from (values
        ('S01','Stage 3','Spatial coordination drawings and report','Coordinated general arrangement drawings to the agreed level of information.','Complete','1110',0),
        ('S02','Stage 4','Technical design package','Production information sufficient for construction and for subcontractor procurement.','In progress','1120',0),
        ('S03','Stage 4','Specification','NBS specification, performance clauses where design is transferred.','In progress','1120',-10),
        ('S04','Stage 4','Schedules','Door, window, ironmongery and finishes schedules as applicable.','Not started','1120',0),
        ('S05','Stage 5','Response to contractor design portion submissions','Review and comment within the agreed period on each CDP submission.','Not started','1130',0),
        ('S06','Stage 5','Site inspections','Periodic inspection and reporting against the design intent.','Not started','1400',0),
        ('S07','Stage 6','As-built information and O&M input','Record information within the agreed period after practical completion.','Not started','1480',0)
      ) as s(ref, heading, title, prompt, status, uid, off);
      v_scope := v_scope + 7;
    end loop;

    -- The two the architect has actually answered, so the page opens with
    -- progress rather than a blank column.
    update tracked_items
    set response = 'Issued 29 May 2026 with the Stage 3 report. Rev P04 is the '
                || 'coordinated set; no outstanding comments from the contractor.',
        response_by = auth.uid(), response_at = now() - interval '96 days',
        response_source = 'person'
    where project_id = p_project and kind = 'scope' and reference = 'BEL-S01';

    update tracked_items
    set response = 'Architectural package tracking to 30 October. Facade '
                || 'interface details are the critical path and depend on '
                || 'Ashgrove''s CDP.',
        response_by = auth.uid(), response_at = now() - interval '9 days',
        response_source = 'person'
    where project_id = p_project and kind = 'scope' and reference = 'BEL-S02';
  end if;

  return format('Matrix: %s duties. Scope: %s lines. BEP and building safety facts set.',
                v_drm, v_scope);
end;
$$;

revoke execute on function seed_sample_setup(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- design
-- The register, the packs and transmittals that issued from it, the material
-- samples and the change requests.
create or replace function seed_sample_design(p_project uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_draw int := 0;
  v_pack uuid; v_pack2 uuid; v_pack3 uuid;
  v_tx uuid;
  v_mat uuid; v_sub uuid;
  v_chg uuid;
  r record;
begin
  select code into v_code from projects where id = p_project;
  if exists (select 1 from drawing_register where project_id = p_project) then
    return 'Register already has rows; design data skipped.';
  end if;

  -- ---- the drawing register ------------------------------------------------
  -- Numbers are built to the BEP's own convention rather than typed, so the
  -- naming check on the register page has something correct to agree with.
  -- The one deliberate exception is commented where it appears.
  insert into drawing_register (project_id, document_number, title, revision,
    workflow_status, cde_url, programme_task_uid, offset_days, anchor,
    added_on, last_synced, golden_thread, g2_revision)
  select p_project,
         v_code || '-' || d.orig || '-' || d.vol || '-' || d.lvl || '-'
                || d.typ || '-' || d.role || '-' || d.num,
         d.title, d.rev, d.sty,
         'https://kingsmead.asite.com/documents/' || lower(d.orig) || '/' || d.num,
         d.uid, d.off, 'finish',
         current_date - d.age, current_date - 1, d.gt, d.g2
  from (values
    -- Architect. The Stage 3 set is issued and frozen; the Stage 4 set is the
    -- live work and two sheets of it are already past their anchor.
    ('BEL','BC','GF','DR','A','1001','Ground floor general arrangement','C01','A1','1121',0,140,true ,'P06'),
    ('BEL','BC','01','DR','A','1002','Level 01 general arrangement','C01','A1','1121',0,140,true ,'C01'),
    ('BEL','BC','02','DR','A','1003','Level 02 general arrangement','C01','A1','1121',0,138,true ,'C01'),
    ('BEL','BC','03','DR','A','1004','Level 03 general arrangement','P05','S3','1121',0,138,true ,'P04'),
    ('BEL','BC','ZZ','DR','A','1010','Typical apartment plans','P04','S3','1121',0,120,false,null),
    ('BEL','BC','RF','DR','A','1020','Roof plan and plant screen','P03','S3','1121',7,110,false,null),
    ('BEL','BC','ZZ','DR','A','1100','Sections AA and BB','P04','S3','1121',0,120,true ,'P03'),
    ('BEL','BC','ZZ','DR','A','1200','North and east elevations','P05','S3','1121',0,118,true ,'P04'),
    ('BEL','BC','ZZ','DR','A','1201','South and west elevations','P05','S3','1121',0,118,true ,'P04'),
    -- Overdue: anchored to the Stage 3 freeze, still preliminary in September.
    ('BEL','BC','ZZ','SH','A','2001','Door schedule','P02','S1','1110',0,150,false,null),
    ('BEL','BC','ZZ','SH','A','2002','Window and glazing schedule','P02','S1','1110',0,150,false,null),
    ('BEL','BC','ZZ','SP','A','3001','Architectural specification','P03','S2','1121',0,96,false,null),
    ('BEL','BC','ZZ','DR','A','1300','Core and stair details','P02','S1','1121',14,60,true ,'P01'),
    -- Structures. Ahead of the architect, which is why the frame is buildable.
    ('CWC','BC','B1','DR','S','1001','Piling layout','C01','A1','1122',0,175,true ,'C01'),
    ('CWC','BC','B1','DR','S','1002','Pile cap and ground beam layout','C01','A1','1122',0,170,true ,'C01'),
    ('CWC','BC','GF','DR','S','1010','Ground floor slab layout','C01','A1','1122',0,165,true ,'C01'),
    ('CWC','BC','01','DR','S','1011','Level 01 framing plan','C01','A1','1122',0,150,true ,'C01'),
    ('CWC','BC','02','DR','S','1012','Level 02 framing plan','CR01','A1','1122',0,150,true ,'C01'),
    ('CWC','BC','03','DR','S','1013','Level 03 framing plan','P06','S4','1122',0,120,false,null),
    ('CWC','BC','ZZ','DR','S','1500','Typical reinforcement details','P05','S3','1122',0,118,false,null),
    ('CWC','BC','ZZ','CA','S','4001','Frame design calculations','P04','S2','1122',0,116,false,null),
    ('CWC','ZZ','XX','DR','C','1001','Drainage strategy','P04','S3','1240',-30,100,false,null),
    ('CWC','ZZ','XX','DR','C','1002','External levels and hardstanding','P03','S2','1240',-30,92,false,null),
    -- Mechanical, electrical, public health: three appointments, three roles.
    ('MBE','BC','ZZ','DR','M','1001','Mechanical services schematic','P04','S3','1123',0,105,false,null),
    ('MBE','BC','GF','DR','M','1010','Ground floor mechanical layout','P03','S3','1123',0,100,false,null),
    ('MBE','BC','ZZ','DR','M','1020','Plant room layout','P03','S3','1123',0,96,false,null),
    ('MBE','BC','ZZ','DR','E','1001','Electrical distribution schematic','P04','S3','1123',0,105,false,null),
    ('MBE','BC','GF','DR','E','1010','Ground floor small power and lighting','P02','S1','1123',0,88,false,null),
    ('MBE','BC','ZZ','DR','E','1100','Fire alarm and detection layout','P03','S3','1123',0,88,true ,'P02'),
    ('MBE','BC','ZZ','DR','P','1001','Above ground drainage','P03','S3','1123',0,90,false,null),
    ('MBE','BC','ZZ','DR','P','1010','Water services and boosting','P02','S1','1123',0,84,false,null),
    ('MBE','BC','ZZ','CA','M','4001','Heat loss and load calculations','P02','S2','1123',-14,80,false,null),
    -- Facade: the contractor design portion, and it is behind.
    ('AFA','BC','ZZ','DR','Y','1001','Facade general arrangement','P03','S3','1124',0,70,true ,'P02'),
    ('AFA','BC','ZZ','DR','Y','1100','Rainscreen typical details','P02','S1','1124',0,62,true ,'P01'),
    ('AFA','BC','ZZ','DR','Y','1200','Brick support and movement joints','P02','S1','1124',0,58,false,null),
    ('AFA','BC','ZZ','CA','Y','4001','Facade structural calculations','P01','S0','1124',7,40,false,null),
    -- Fire strategy, and the one sheet that has never been issued at all: it
    -- is on the golden thread and has no revision, which is a different and
    -- worse finding than a sheet that merely moved.
    ('RFC','BC','ZZ','RP','F','5001','Fire strategy report','P04','S3','1220',-21,150,true ,'P03'),
    ('RFC','BC','ZZ','DR','F','1001','Means of escape and compartmentation','P03','S3','1220',-21,148,true ,'P03'),
    ('RFC','BC','ZZ','DR','F','1002','External wall construction -- reg 7 compliance',null,null,'1124',0,30,true ,null),
    -- Landscape, only just started.
    ('VLS','ZZ','XX','DR','L','1001','Landscape general arrangement','P02','S1','1125',0,24,false,null),
    ('VLS','ZZ','XX','DR','L','1100','Planting plan','P01','S0','1125',0,18,false,null),
    -- One number that does not follow the convention, on purpose: the naming
    -- check on the register is only worth having if something fails it.
    ('HWS','ZZ','XX','RP','B','SURVEY01','Topographical survey report','P01','S2','1110',-60,200,false,null),
    -- Anticipated: on the register, due, and never issued. A register that
    -- listed only what has arrived could not tell anyone what is late, which is
    -- most of what a design manager needs it for. These seven are past their
    -- anchor and are what the overdue count counts.
    ('BEL','BC','ZZ','DR','A','1030','Level 04 to 10 typical general arrangement',null,null,'1121',-70,90,false,null),
    ('BEL','BC','ZZ','SH','A','2003','Ironmongery schedule',null,null,'1110',30,90,false,null),
    ('CWC','BC','04','DR','S','1014','Level 04 framing plan',null,null,'1122',-30,88,false,null),
    ('MBE','BC','ZZ','DR','M','1030','Riser layouts levels 04 to 11',null,null,'1123',-100,84,false,null),
    ('AFA','BC','ZZ','DR','Y','1300','Facade fixing and bracket details',null,null,'1124',-120,60,true ,null),
    ('AFA','BC','ZZ','DR','Y','1400','Reference panel construction details',null,null,'1124',-110,58,false,null),
    ('RFC','BC','ZZ','DR','F','1003','Compartmentation at the podium interface',null,null,'1220',14,80,true ,null),
    -- And four that are anticipated but not yet due, so the register shows the
    -- difference between late and simply not here yet.
    ('BEL','BC','ZZ','DR','A','1400','Balcony and terrace details',null,null,'1121',0,50,false,null),
    ('CWC','BC','ZZ','DR','S','1600','Podium transfer structure details',null,null,'1122',0,48,false,null),
    ('MBE','BC','ZZ','DR','M','1200','Lift shaft services and ventilation',null,null,'1123',0,40,false,null),
    ('VLS','ZZ','XX','DR','L','1200','Hard landscape construction details',null,null,'1125',0,20,false,null)
  ) as d(orig, vol, lvl, typ, role, num, title, rev, sty, uid, off, age, gt, g2);

  get diagnostics v_draw = row_count;

  -- ---- packs, and the transmittals that issued from them --------------------
  -- A pack holds references and a programme link as a resource. It never holds
  -- a date: the drawings carry their own.
  insert into drawing_packs (project_id, reference, name, purpose, owner_id)
  values (p_project, 'PK-001', 'Stage 3 spatial coordination issue',
          'Issued to the client and the full design team at the Stage 3 freeze.',
          auth.uid())
  returning id into v_pack;

  insert into drawing_packs (project_id, reference, name, purpose, owner_id)
  values (p_project, 'PK-002', 'Substructure construction issue',
          'Released for piling and pile caps.', auth.uid())
  returning id into v_pack2;

  insert into drawing_packs (project_id, reference, name, purpose, owner_id)
  values (p_project, 'PK-003', 'Facade tender pack',
          'Issued with the facade enquiry. Superseded by the CDP submission.',
          auth.uid())
  returning id into v_pack3;

  insert into drawing_pack_programme (pack_id, programme_task_uid)
  values (v_pack, '1110'), (v_pack2, '1420'), (v_pack3, '1310');

  insert into drawing_pack_items (pack_id, drawing_id)
  select v_pack, id from drawing_register
  where project_id = p_project and document_number like '%-BEL-%';

  insert into drawing_pack_items (pack_id, drawing_id)
  select v_pack2, id from drawing_register
  where project_id = p_project and document_number like '%-CWC-BC-B1-%';

  insert into drawing_pack_items (pack_id, drawing_id)
  select v_pack3, id from drawing_register
  where project_id = p_project
    and (document_number like '%-AFA-%' or document_number like '%-Y-1%');

  -- A transmittal is frozen at the revision that went out, which is why the
  -- architect's C01 sheets still show P-revisions on the Stage 3 issue.
  insert into transmittals (project_id, reference, issue_date, method, reason,
    to_company_id, to_person_id, issued_by, notes)
  values (p_project, 'TX-001',
          (select finish_date from programme_tasks where project_id = p_project and task_uid = '1111'),
          'CDE', 'Stage 3 issue for client approval',
          sample_co(p_project, 'KWD'), sample_person(p_project, 'Charlotte Dean'),
          auth.uid(), 'Full Stage 3 set. Comments requested within 10 working days.')
  returning id into v_tx;

  insert into transmittal_items (transmittal_id, drawing_id, revision_at_issue)
  select v_tx, id, 'P04' from drawing_register
  where project_id = p_project and document_number like '%-BEL-%';

  insert into transmittal_recipients (transmittal_id, company_id, person_id, distribution)
  values (v_tx, sample_co(p_project,'KWD'), sample_person(p_project,'Charlotte Dean'), 'action'),
         (v_tx, sample_co(p_project,'CWC'), sample_person(p_project,'Helen Boakye'), 'information'),
         (v_tx, sample_co(p_project,'MBE'), sample_person(p_project,'Nadia Farouk'), 'information');

  insert into transmittals (project_id, reference, issue_date, method, reason,
    to_company_id, to_person_id, issued_by, notes)
  values (p_project, 'TX-002',
          (select start_date from programme_tasks where project_id = p_project and task_uid = '1420'),
          'CDE', 'Construction issue -- substructure',
          sample_co(p_project, 'HBC'), sample_person(p_project, 'Femi Adeyemi'),
          auth.uid(), 'Released for piling. Setting out to be confirmed on site.')
  returning id into v_tx;

  insert into transmittal_items (transmittal_id, drawing_id, revision_at_issue)
  select v_tx, id, 'C01' from drawing_register
  where project_id = p_project and document_number like '%-CWC-BC-B1-%';

  insert into transmittal_recipients (transmittal_id, company_id, person_id, distribution)
  values (v_tx, sample_co(p_project,'HBC'), sample_person(p_project,'Femi Adeyemi'), 'action'),
         (v_tx, sample_co(p_project,'CWC'), sample_person(p_project,'Helen Boakye'), 'information');

  insert into transmittals (project_id, reference, issue_date, method, reason,
    to_company_id, to_person_id, issued_by, notes)
  values (p_project, 'TX-003',
          (select start_date from programme_tasks where project_id = p_project and task_uid = '1310'),
          'Email', 'Facade tender enquiry',
          sample_co(p_project, 'AFA'), sample_person(p_project, 'Lena Kowalczyk'),
          auth.uid(), 'Tender pack. Return by the date in the enquiry letter.')
  returning id into v_tx;

  insert into transmittal_items (transmittal_id, drawing_id, revision_at_issue)
  select v_tx, id, 'P02' from drawing_register
  where project_id = p_project and document_number like '%-AFA-%';

  insert into transmittal_recipients (transmittal_id, company_id, person_id, distribution)
  values (v_tx, sample_co(p_project,'AFA'), sample_person(p_project,'Lena Kowalczyk'), 'action');

  perform sample_seq(p_project, 'PK', 3);
  perform sample_seq(p_project, 'TX', 3);

  return format('Register: %s drawings (11 anticipated), 3 packs, 3 transmittals.', v_draw);
end;
$$;

revoke execute on function seed_sample_design(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- materials
create or replace function seed_sample_materials(p_project uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_mat uuid; v_n int := 0; r record;
begin
  if exists (select 1 from materials where project_id = p_project) then
    return 'Materials already seeded.';
  end if;

  for r in
    select * from (values
      ('MAT-001','Facing brickwork','Ibstock Leicester Multi Cream, stretcher bond, recessed joint','Elevations -- all','AFA','Lena Kowalczyk','1440',-60,
       array['Approved as noted|Panel accepted subject to a wider mortar sample. Build the reference panel before ordering.']),
      ('MAT-002','Rainscreen cassette panel','3mm aluminium, PPC RAL 7016 matt, A2-s1,d0','Levels 04-11 north and east','AFA','Lena Kowalczyk','1440',-45,
       array['Rejected|Submitted panel is A2-s1,d0 but the fixing rail is not. Reg 7 requires the whole system on a relevant building. Resubmit with a compliant rail.',
             'Approved|Revised submission with an aluminium rail. Test evidence attached and checked against the fire strategy.']),
      ('MAT-003','Window and door system','Aluminium, polyester powder coated, Uw 1.2 W/m2K','All apartments','AFA','Lena Kowalczyk','1440',-30,
       array['Pending|']),
      ('MAT-004','Roof waterproofing','Single ply, mechanically fixed, 20 year guarantee','Roof','HBC','Femi Adeyemi','1440',0,
       array[]::text[]),
      ('MAT-005','Apartment floor finish','Engineered oak, 14mm, acoustic underlay to Part E','Apartments -- living and bedrooms','BEL','Marcus Wren','1460',-20,
       array['Approved|Matches the Stage 3 material board. Acoustic test data satisfies Part E with the specified underlay.']),
      ('MAT-006','Sanitaryware','White vitreous china, chrome brassware','Apartments -- bathrooms and en-suites','BEL','Tom Lacey','1460',-10,
       array['Pending|']),
      ('MAT-007','External paving','Concrete flag, buff, 600x600x63','Public realm and podium','VLS','Oliver Tran','1470',-15,
       array[]::text[]),
      ('MAT-008','Balustrade and handrail','Glass balustrade, 21.5mm laminated, satin stainless top rail','Balconies and terraces','AFA','Lena Kowalczyk','1440',-25,
       array['Pending|'])
    ) as t(ref, title, spec, loc, co, person, uid, off, rounds)
  loop
    insert into materials (project_id, reference, title, spec, location, company_id,
      person_id, programme_task_uid, offset_days, anchor, created_by)
    values (p_project, r.ref, r.title, r.spec, r.loc,
            sample_co(p_project, r.co), sample_person(p_project, r.person),
            r.uid, r.off, 'start', auth.uid())
    returning id into v_mat;
    v_n := v_n + 1;

    -- Each round is written as it happened. A decided round is frozen by
    -- trigger, so a correction later is a new round and the rejection stays
    -- readable -- which is the point of holding rounds at all.
    for i in 1 .. coalesce(array_length(r.rounds, 1), 0) loop
      insert into material_submissions (material_id, round, submitted_at,
        sample_reference, decision, decided_by, decided_at, comments, submitted_by)
      values (v_mat, i,
              current_date - (30 * (coalesce(array_length(r.rounds,1),1) - i + 1)),
              r.ref || '/' || lpad(i::text, 2, '0'),
              split_part(r.rounds[i], '|', 1),
              case when split_part(r.rounds[i], '|', 1) = 'Pending' then null else auth.uid() end,
              case when split_part(r.rounds[i], '|', 1) = 'Pending' then null
                   else now() - ((30 * (coalesce(array_length(r.rounds,1),1) - i)) || ' days')::interval end,
              nullif(split_part(r.rounds[i], '|', 2), ''),
              auth.uid());
    end loop;
  end loop;

  return format('Materials: %s items with their submission rounds.', v_n);
end;
$$;

revoke execute on function seed_sample_materials(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- compliance
-- Planning conditions, building control, the client's requirements, handover,
-- highways, utilities, an occurrence, and a demonstration scoring scheme.
create or replace function seed_sample_compliance(p_project uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_scheme uuid;
  v_issue uuid;
  v_item uuid;
  v_n int := 0;
  r record;
begin
  if exists (select 1 from tracked_items where project_id = p_project and kind = 'planning') then
    return 'Compliance already seeded.';
  end if;

  -- ---- planning conditions -------------------------------------------------
  insert into tracked_items (project_id, kind, reference, heading, title, prompt,
    discipline, company_id, person_id, status, programme_task_uid, offset_days,
    anchor, created_by)
  select p_project, 'planning', c.ref, c.heading, c.title, c.prompt, c.disc,
         sample_co(p_project, c.co), sample_person(p_project, c.person), c.status,
         c.uid, c.off, 'finish', auth.uid()
  from (values
    ('PC-01','Pre-commencement','Construction environmental management plan','Submit a CEMP covering dust, noise, hours of work and wheel washing.','MC','HBC','Rachel Ingram','Complete','1211',-14),
    ('PC-02','Pre-commencement','Archaeological watching brief','Appoint a suitably qualified archaeologist and submit the written scheme of investigation.','MC','HBC','Rachel Ingram','Complete','1211',-14),
    ('PC-03','Pre-commencement','Piling risk assessment','Submit a piling risk assessment to the satisfaction of the lead local flood authority.','GE','TGE','Dev Ramanathan','Complete','1211',-7),
    ('PC-04','Pre-commencement','Demolition method statement','Method statement and structural stability report for the existing warehouse.','S','CWC','Helen Boakye','Complete','1211',-7),
    ('PC-05','Pre-occupation','Materials and samples','Submit samples of all external facing materials for written approval.','A','BEL','Marcus Wren','In progress','1440',-30),
    ('PC-06','Pre-occupation','Landscape and public realm details','Full details of hard and soft landscaping including a management plan.','L','VLS','Oliver Tran','In progress','1125',0),
    ('PC-07','Pre-occupation','Travel plan','Submit and secure approval of a residential travel plan.','MC','HBC','Rachel Ingram','Not started','1470',0),
    ('PC-08','Pre-occupation','Cycle and refuse storage','Details of secure cycle parking and refuse storage as built.','A','BEL','Priya Raghunathan','Not started','1460',0),
    ('PC-09','Pre-occupation','Biodiversity net gain','Evidence of a 10 per cent net gain against the approved baseline.','MC','HBC','Rachel Ingram','Not started','1470',0),
    ('PC-10','Compliance','Hours of construction','Works audible outside the site boundary only 08:00-18:00 Mon-Fri, 08:00-13:00 Sat.','MC','HBC','Rachel Ingram','Complete','1410',0),
    ('PC-11','Pre-occupation','Electric vehicle charging','Details and evidence of active and passive EV provision.','E','MBE','Greg Hollis','Not started','1450',0),
    ('PC-12','Pre-occupation','Acoustic mitigation verification','Post-completion testing to demonstrate the internal noise levels assumed.','AC','CAL','Bethan Price','Not started','1480',0)
  ) as c(ref, heading, title, prompt, disc, co, person, status, uid, off);
  get diagnostics v_n = row_count;

  -- Two are answered, one is struck out. `required = false` keeps the row and
  -- the decision that it was not needed, rather than deleting the evidence
  -- that anybody ever considered it.
  update tracked_items set
    response = 'Discharged 3 April 2026 under application 26/01188/DIS. Decision '
            || 'notice on the CDE at PC/DIS/01.',
    response_by = auth.uid(), response_at = now() - interval '150 days'
  where project_id = p_project and kind = 'planning' and reference in ('PC-01','PC-02');

  update tracked_items set required = false,
    response = 'Not applicable: the archaeological brief covers the whole site '
            || 'and this condition duplicates PC-02. Agreed with the case officer.',
    response_by = auth.uid(), response_at = now() - interval '140 days'
  where project_id = p_project and kind = 'planning' and reference = 'PC-10';

  -- ---- building control ----------------------------------------------------
  insert into tracked_items (project_id, kind, reference, heading, title, prompt,
    discipline, company_id, person_id, status, programme_task_uid, offset_days,
    anchor, created_by)
  select p_project, 'bc', c.ref, c.heading, c.title, c.prompt, c.disc,
         sample_co(p_project, c.co), sample_person(p_project, c.person), c.status,
         c.uid, c.off, 'finish', auth.uid()
  from (values
    ('BC-01','Gateway 2','Building control application','Submit the Gateway 2 application with the full design and the competence declarations.','PDB','MBS','Gareth Loftus','Complete','1221',-30),
    ('BC-02','Gateway 2','Fire and emergency file','Establish the fire and emergency file and keep it current through construction.','FS','RFC','Andrew Ridley','In progress','1221',0),
    ('BC-03','Part B','External wall reg 7 compliance','Demonstrate that all materials in the external wall meet regulation 7.','FS','RFC','Andrew Ridley','In progress','1124',0),
    ('BC-04','Part B','Means of escape strategy','Escape strategy, travel distances and the evacuation approach agreed.','FS','RFC','Andrew Ridley','Complete','1220',0),
    ('BC-05','Part E','Sound insulation','Pre-completion testing regime agreed, or robust details registered.','AC','CAL','Bethan Price','Not started','1460',0),
    ('BC-06','Part L','Fabric and services compliance','As-designed SAP and SBEM submissions with the notional building comparison.','SU','NLS','Ewan Baird','In progress','1230',0),
    ('BC-07','Part M','Accessible dwellings','M4(2) throughout, M4(3) to the wheelchair units, evidenced on the drawings.','A','BEL','Priya Raghunathan','In progress','1121',0),
    ('BC-08','Part S','Electric vehicle charging','Provision and evidence to Part S.','E','MBE','Greg Hollis','Not started','1450',0),
    ('BC-09','Gateway 3','Completion certificate application','Assemble the Gateway 3 application and the golden thread information.','PDB','MBS','Gareth Loftus','Not started','1481',-42),
    ('BC-10','Part O','Overheating','TM59 assessment and the mitigation carried into the design.','M','MBE','Nadia Farouk','Complete','1123',-30)
  ) as c(ref, heading, title, prompt, disc, co, person, status, uid, off);

  update tracked_items set
    response = 'Approved 31 July 2026, reference BSR/G2/2026/04417. Approval carries '
            || 'three requirements, all tracked as change control items.',
    response_by = auth.uid(), response_at = now() - interval '34 days'
  where project_id = p_project and kind = 'bc' and reference = 'BC-01';

  -- ---- the client's requirements ------------------------------------------
  insert into tracked_items (project_id, kind, reference, heading, title, prompt,
    discipline, company_id, person_id, status, programme_task_uid, offset_days,
    anchor, created_by)
  select p_project, 'checklist:client', c.ref, c.heading, c.title, c.prompt, c.disc,
         sample_co(p_project, c.co), sample_person(p_project, c.person), c.status,
         c.uid, c.off, 'finish', auth.uid()
  from (values
    ('CR-01','Brief','Accommodation schedule confirmed','96 apartments, mix as the planning consent. Any change is a client instruction.','A','BEL','Marcus Wren','Complete','1110',0),
    ('CR-02','Brief','Commercial unit shell specification','Extent of the developer''s works to the ground floor commercial unit.','A','BEL','Marcus Wren','Complete','1110',0),
    ('CR-03','Standards','Employer''s requirements compliance','Design demonstrably meets the ER, or departures are recorded and agreed.','MC','HBC','Daniel Osei','In progress','1120',0),
    ('CR-04','Standards','Residential sales specification','Kitchen, bathroom and finishes specification signed off by the client.','ID','BEL','Tom Lacey','In progress','1460',-60),
    ('CR-05','Sustainability','Sustainability target confirmed','Target rating and any client-specific requirements above it.','SU','NLS','Ruth Kavanagh','Complete','1230',-30),
    ('CR-06','Operations','Management company handover requirements','What the management company needs at handover and in what form.','MC','HBC','Rachel Ingram','Not started','1480',0),
    ('CR-07','Operations','Warranty and defects arrangements','Structural warranty provider and the defects liability arrangements.','MC','HBC','Rachel Ingram','In progress','1480',-90),
    ('CR-08','Brief','Car parking and cycle provision','Numbers and layout confirmed against the consent.','C','CWC','Iain Struthers','Complete','1110',0)
  ) as c(ref, heading, title, prompt, disc, co, person, status, uid, off);

  -- ---- handover ------------------------------------------------------------
  insert into tracked_items (project_id, kind, reference, heading, title, prompt,
    discipline, company_id, person_id, status, programme_task_uid, offset_days,
    anchor, created_by)
  select p_project, 'checklist:handover', c.ref, c.heading, c.title, c.prompt, c.disc,
         sample_co(p_project, c.co), sample_person(p_project, c.person), 'Not started',
         c.uid, c.off, 'finish', auth.uid()
  from (values
    ('HO-01','Statutory','Gateway 3 completion certificate','The certificate, and the golden thread information handed to the accountable person.','PDB','MBS','Gareth Loftus','1481',0),
    ('HO-02','Statutory','Fire and emergency file','Complete file handed to the accountable person.','FS','RFC','Andrew Ridley','1481',0),
    ('HO-03','Statutory','Health and safety file','CDM health and safety file, complete and indexed.','PD','WHS','Sonia Whitcombe','1481',0),
    ('HO-04','Technical','As-built drawings','Full as-built set on the CDE at the agreed status.','A','BEL','Priya Raghunathan','1481',-14),
    ('HO-05','Technical','O&M manuals','Operation and maintenance manuals for all installed systems.','M','MBE','Nadia Farouk','1481',-14),
    ('HO-06','Technical','Commissioning records','Witnessed commissioning records for mechanical and electrical systems.','M','MBE','Nadia Farouk','1480',0),
    ('HO-07','Technical','Air tightness and acoustic test results','Final test results against the design targets.','SU','NLS','Ewan Baird','1480',0),
    ('HO-08','Commercial','Collateral warranties','All warranties executed and delivered.','MC','HBC','Rachel Ingram','1481',-30),
    ('HO-09','Operational','Training and demonstration','Management company and residents'' handbook training delivered.','MC','HBC','Rachel Ingram','1481',0),
    ('HO-10','Operational','Building user guide','Building user guide issued for each apartment.','SU','NLS','Ruth Kavanagh','1481',0),
    ('HO-11','Technical','Landscape maintenance schedule','Establishment and maintenance schedule for the planting.','L','VLS','Oliver Tran','1470',0),
    ('HO-12','Statutory','Energy performance certificates','EPCs lodged for every dwelling and the commercial unit.','SU','NLS','Ewan Baird','1481',-7)
  ) as c(ref, heading, title, prompt, disc, co, person, uid, off);

  -- ---- highways ------------------------------------------------------------
  insert into tracked_items (project_id, kind, reference, heading, title, prompt,
    discipline, company_id, person_id, status, programme_task_uid, offset_days,
    anchor, created_by)
  select p_project, 'checklist:highways', c.ref, c.heading, c.title, c.prompt, 'C',
         sample_co(p_project, 'CWC'), sample_person(p_project, 'Iain Struthers'),
         c.status, c.uid, c.off, 'finish', auth.uid()
  from (values
    ('HW-01','Section 278','Technical approval submission','Submit the s278 design for technical approval.','Complete','1240',-180),
    ('HW-02','Section 278','Stage 2 road safety audit','Commission and close out the stage 2 audit.','In progress','1240',-120),
    ('HW-03','Section 278','Agreement executed','s278 agreement executed and the bond in place.','In progress','1240',-90),
    ('HW-04','Section 38','Adoptable layout agreed','Layout, levels and construction details agreed for adoption.','Not started','1240',-30),
    ('HW-05','Section 38','Agreement executed','s38 agreement executed.','Not started','1240',0),
    ('HW-06','Licences','Hoarding and scaffold licence','Licences in place for the duration of the works.','Complete','1410',-14),
    ('HW-07','Licences','Crane oversail agreement','Oversail agreement with the adjoining owner.','Complete','1420',-30),
    ('HW-08','Section 278','Stage 3 road safety audit','Audit on completion of the highway works.','Not started','1470',0)
  ) as c(ref, heading, title, prompt, status, uid, off);

  -- ---- utilities -----------------------------------------------------------
  -- The utilities sequence lives in `ext`, whose permitted keys are named by a
  -- check constraint rather than left to convention.
  insert into tracked_items (project_id, kind, reference, heading, title, prompt,
    discipline, company_id, person_id, status, programme_task_uid, offset_days,
    anchor, ext, created_by)
  select p_project, 'checklist:utilities', c.ref, c.heading, c.title, c.prompt, 'MC',
         sample_co(p_project, 'HBC'), sample_person(p_project, 'Rachel Ingram'),
         c.status, c.uid, c.off, 'finish', c.ext::jsonb, auth.uid()
  from (values
    ('UT-01','Electricity','New HV supply and substation','Capacity, substation location and the adoption route.','In progress','1450',-90,
     '{"supplier":"Western Power Distribution","quote_reference":"WPD/2026/118420","quote_value":184500,"date_enquiry":"2026-02-16","date_quote":"2026-04-20","date_accepted":"2026-05-11"}'),
    ('UT-02','Gas','Gas supply -- not required','All-electric scheme; no gas connection.','Complete','1450',-90,
     '{"supplier":"n/a"}'),
    ('UT-03','Water','Potable water connection','New connection and the boosted cold water requirement.','In progress','1450',-60,
     '{"supplier":"Bristol Water","quote_reference":"BW-CN-88214","quote_value":42800,"date_enquiry":"2026-03-02","date_quote":"2026-05-06"}'),
    ('UT-04','Drainage','Foul and surface water adoption','s104 agreement for the adoptable drainage.','Not started','1470',-30,
     '{"supplier":"Wessex Water","date_enquiry":"2026-06-15"}'),
    ('UT-05','Telecoms','Fibre to the premises','Provider agreement and the wayleave.','Not started','1450',0,
     '{"supplier":"Openreach","date_enquiry":"2026-07-28"}'),
    ('UT-06','Electricity','Temporary builder''s supply','Supply for the construction phase.','Complete','1410',-30,
     '{"supplier":"Western Power Distribution","quote_reference":"WPD/2026/104118","quote_value":18650,"date_enquiry":"2026-01-19","date_quote":"2026-02-13","date_accepted":"2026-02-20","date_energised":"2026-04-08"}')
  ) as c(ref, heading, title, prompt, status, uid, off, ext);

  -- ---- an occurrence -------------------------------------------------------
  -- A statutory duty with its own audience and its own clock, so it is its own
  -- table and its own page, not a risk with a label.
  insert into occurrences (project_id, reference, title, description, kind, status,
    assessment, occurred_at, discovered_at, person_id, company_id, raised_by)
  values (p_project, 'MOR-001',
    'Cavity barrier omission found in the mock-up panel',
    'The facade reference panel was built without the horizontal cavity barrier '
    || 'at the level 03 floor line. The panel is a mock-up and forms no part of '
    || 'the permanent works.',
    'Structural or fire safety', 'Not reportable',
    'Assessed against the BSR reportable criteria. The defect is in a mock-up '
    || 'that is not part of the building and was found before any permanent '
    || 'installation began, so there is no risk of a significant number of '
    || 'people being killed or seriously injured. Not reportable. The design '
    || 'and the inspection regime have both been corrected.',
    current_date - 21, current_date - 20,
    sample_person(p_project, 'Femi Adeyemi'), sample_co(p_project, 'AFA'),
    auth.uid());

  -- ---- a demonstration scoring scheme --------------------------------------
  -- FICTIONAL. The section codes, issue codes and criteria titles below are
  -- invented so that the scoring, the prerequisites and the minimum standards
  -- can be exercised without shipping a line of anybody's licensed content. A
  -- licence holder replaces this wholesale with breeam_import_apply().
  insert into breeam_schemes (project_id, version, name, building_type,
    building_types, sections, weightings, ratings, created_by)
  values (p_project, 'DEMO-2026',
    'Demo Sustainability Framework 2026 (fictional -- not BREEAM)',
    'Residential', array['Residential','Commercial'],
    '[{"code":"DM","name":"Design management","stated":12},
      {"code":"WB","name":"Wellbeing","stated":14},
      {"code":"EN","name":"Energy","stated":22},
      {"code":"MV","name":"Movement and access","stated":9},
      {"code":"WT","name":"Water","stated":7},
      {"code":"MT","name":"Materials","stated":13},
      {"code":"WS","name":"Waste","stated":8},
      {"code":"EL","name":"Ecology and land use","stated":10},
      {"code":"PL","name":"Pollution","stated":10},
      {"code":"IN","name":"Innovation","stated":6}]'::jsonb,
    -- Weightings are percentages summing to 100, because a section score is
    -- (credits achieved / credits available) x weighting and the ratings below
    -- are read on the same scale. Weightings summing to 1.0 would produce a
    -- score of 0.7 against a 70 threshold and every rating would read as
    -- unclassified.
    '{"Residential":{"DM":11,"WB":14,"EN":19,"MV":8,"WT":6,
                     "MT":13,"WS":7,"EL":10,"PL":9,"IN":3},
      "Commercial":{"DM":12,"WB":15,"EN":20,"MV":9,"WT":6,
                     "MT":12,"WS":6,"EL":9,"PL":8,"IN":3}}'::jsonb,
    '[{"name":"Pass","min":30},{"name":"Good","min":45},
      {"name":"Very good","min":55},{"name":"Excellent","min":70},
      {"name":"Outstanding","min":85}]'::jsonb,
    auth.uid())
  returning id into v_scheme;

  update projects set breeam_scheme_id = v_scheme where id = p_project;

  -- Issues, with the minimum standards that cap a rating when a prerequisite
  -- under them is outstanding.
  for r in
    select * from (values
      ('DM01','Responsible project management','DM','{"Excellent":{"credits":1,"note":"One credit required at Excellent and above."}}'),
      ('DM02','Commissioning and handover','DM','{}'),
      ('DM03','Aftercare','DM','{"Outstanding":{"credits":1,"note":"Required at Outstanding."}}'),
      ('WB01','Daylight and visual comfort','WB','{}'),
      ('WB02','Indoor air quality','WB','{}'),
      ('WB03','Acoustic performance','WB','{"Excellent":{"credits":1,"note":"One credit required at Excellent and above."}}'),
      ('EN01','Energy demand and efficiency','EN','{"Very good":{"credits":2,"note":"Two credits at Very good."},"Excellent":{"credits":4,"note":"Four credits at Excellent."},"Outstanding":{"credits":6,"note":"Six credits at Outstanding."}}'),
      ('EN02','Energy monitoring','EN','{"Excellent":{"credits":1,"note":"Sub-metering required at Excellent."}}'),
      ('EN03','Low carbon technologies','EN','{}'),
      ('MV01','Public transport accessibility','MV','{}'),
      ('MV02','Cycling provision','MV','{}'),
      ('WT01','Water consumption','WT','{"Very good":{"credits":1,"note":"One credit at Very good and above."},"Excellent":{"credits":1,"note":"One credit at Excellent and above."}}'),
      ('WT02','Water monitoring and leak detection','WT','{"Excellent":{"credits":0,"note":"Prerequisite: leak detection to the mains supply."}}'),
      ('MT01','Life cycle impacts','MT','{}'),
      ('MT02','Responsible sourcing','MT','{"Excellent":{"credits":0,"note":"Prerequisite: a legally harvested and traded timber policy."}}'),
      ('MT03','Durability and resilience','MT','{}'),
      ('WS01','Construction waste management','WS','{"Excellent":{"credits":1,"note":"One credit at Excellent and above."}}'),
      ('WS02','Recycled aggregates','WS','{}'),
      ('EL01','Site ecological value','EL','{}'),
      ('EL02','Enhancing ecology','EL','{}'),
      ('PL01','Impact of refrigerants','PL','{}'),
      ('PL02','Surface water run-off','PL','{}'),
      ('PL03','Reduction of night time light pollution','PL','{}'),
      ('IN01','Innovation','IN','{}')
    ) as t(code, title, section, mins)
  loop
    insert into breeam_issues (project_id, scheme_id, code, title, section, min_standards)
    values (p_project, v_scheme, r.code, r.title, r.section, r.mins::jsonb);
  end loop;

  -- Credits. A credit is a tracked_items row linked to its issue by a real
  -- foreign key, with the numbers in `ext` -- which no role may write directly:
  -- set_breeam_credit() is the only path to them.
  for r in
    select * from (values
      ('DM01',1,'Project brief and design workshops recorded',2,2,2,false,'Verified','NLS','Ruth Kavanagh'),
      ('DM01',2,'Stakeholder consultation carried out',1,1,1,false,'Verified','NLS','Ruth Kavanagh'),
      ('DM02',1,'Commissioning programme and responsibilities set',2,2,0,false,'In progress','MBE','Nadia Farouk'),
      ('DM02',2,'Seasonal commissioning committed',1,1,0,false,'Not started','MBE','Nadia Farouk'),
      ('DM03',1,'Aftercare support in place for 12 months',2,1,0,false,'Not started','HBC','Rachel Ingram'),
      ('WB01',1,'Daylight factor achieved in habitable rooms',3,2,0,false,'In progress','BEL','Marcus Wren'),
      ('WB02',1,'VOC emission levels met for internal finishes',2,2,0,false,'In progress','BEL','Tom Lacey'),
      ('WB03',1,'Sound insulation exceeds Part E by 3dB',3,2,0,false,'In progress','CAL','Bethan Price'),
      ('EN01',1,'Energy performance ratio achieved',9,6,0,false,'In progress','NLS','Ewan Baird'),
      ('EN02',1,'Sub-metering of major energy uses',2,2,0,false,'In progress','MBE','Greg Hollis'),
      ('EN03',1,'Low carbon technology feasibility completed',3,2,2,false,'Verified','NLS','Ewan Baird'),
      ('MV01',1,'Public transport accessibility index',3,2,2,false,'Verified','CWC','Iain Struthers'),
      ('MV02',1,'Cycle storage and facilities provided',2,2,0,false,'In progress','BEL','Priya Raghunathan'),
      ('WT01',1,'Water consumption below the benchmark',5,4,0,false,'In progress','MBE','Sam Whitlock'),
      -- A prerequisite, and it is NOT verified: it zeroes its issue and names
      -- itself in blocked_by, so the achieved rating is capped until it moves.
      ('WT02',1,'Leak detection system on the mains supply',0,0,0,true ,'In progress','MBE','Sam Whitlock'),
      ('MT01',1,'Life cycle assessment carried out at concept',4,3,0,false,'In progress','NLS','Ruth Kavanagh'),
      ('MT02',1,'Responsible sourcing certification achieved',4,3,0,false,'Not started','HBC','Daniel Osei'),
      ('MT02',2,'Timber policy in place and evidenced',0,0,0,true ,'Verified','HBC','Daniel Osei'),
      ('MT03',1,'Protection to vulnerable parts of the building',1,1,0,false,'Not started','BEL','Priya Raghunathan'),
      ('WS01',1,'Construction resource efficiency achieved',4,3,0,false,'In progress','HBC','Rachel Ingram'),
      ('WS02',1,'Recycled or secondary aggregate used',1,1,0,false,'Not started','CWC','Helen Boakye'),
      ('EL01',1,'Ecologist appointed and survey completed',2,0,0,false,'Not targeted',null,null),
      ('EL02',1,'Biodiversity net gain delivered',4,3,0,false,'In progress','VLS','Oliver Tran'),
      ('PL01',1,'Refrigerant global warming potential limited',2,2,0,false,'In progress','MBE','Nadia Farouk'),
      ('PL02',1,'Surface water run-off attenuated',3,3,0,false,'In progress','CWC','Iain Struthers'),
      ('PL03',1,'External lighting designed to limit spill',2,1,0,false,'Not started','MBE','Greg Hollis'),
      ('IN01',1,'Exemplary performance in energy',3,1,0,false,'Not started','NLS','Ewan Baird')
    ) as t(issue, ord, title, avail, targ, achv, prereq, status, co, person)
  loop
    select id into v_issue from breeam_issues
     where project_id = p_project and scheme_id = v_scheme and code = r.issue;

    insert into tracked_items (project_id, kind, reference, heading, title,
      discipline, company_id, person_id, status, breeam_issue_id, ext,
      programme_task_uid, offset_days, anchor, created_by)
    values (p_project, 'breeam', r.issue || '.' || r.ord,
      (select section from breeam_issues where id = v_issue), r.title,
      'BR',
      case when r.co is null then null else sample_co(p_project, r.co) end,
      case when r.person is null then null else sample_person(p_project, r.person) end,
      r.status, v_issue,
      jsonb_strip_nulls(jsonb_build_object(
        'section', (select section from breeam_issues where id = v_issue),
        'issue', r.issue,
        'credits_available', r.avail,
        'credits_targeted', r.targ,
        'credits_achieved', r.achv,
        'is_prerequisite', r.prereq)),
      '1230', 0, 'finish', auth.uid());
  end loop;

  return format('Compliance: %s planning conditions, building control, client, '
             || 'handover, highways and utilities checklists, one occurrence, '
             || 'and a fictional %s-credit scoring scheme.',
             v_n, (select count(*) from tracked_items
                   where project_id = p_project and kind = 'breeam'));
end;
$$;

revoke execute on function seed_sample_compliance(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- my work
-- Tasks, RFIs and the meetings they came out of. Comments are what "gone
-- quiet" measures, so they are dated deliberately: an item nobody has touched
-- for eleven weeks is the finding, not an item that is merely old.
create or replace function seed_sample_work(p_project uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_meet uuid; v_agenda uuid; v_issue uuid; v_n int := 0;
  r record;
begin
  if exists (select 1 from issues where project_id = p_project) then
    return 'Tasks already seeded.';
  end if;

  for r in
    select * from (values
      ('TSK-001','irs','Confirm the facade fixing zone at the level 03 setback','The rainscreen support bracket clashes with the RC upstand. Structures and the facade subcontractor to agree the zone.','Coordination','Lena Kowalczyk','1124',-14,80,'Open',null,null,42),
      ('TSK-002','irs','Issue the door schedule','The schedule was due at the Stage 3 freeze and is still preliminary. It is holding the ironmongery procurement.','Information','Priya Raghunathan','1110',0,75,'Open',null,null,9),
      ('TSK-003','irs','Resolve the riser coordination at levels 04 to 07','Mechanical and electrical risers overlap in the coordinated model above level 04.','Coordination','Nadia Farouk','1123',-21,70,'Open',null,null,4),
      ('TSK-004','irs','Confirm the acoustic build-up to the separating floor','Part E build-up needs to be fixed before the frame drawings go to construction.','Technical','Bethan Price','1122',0,60,'Closed','Agreed at DTM-11: 75mm screed on 25mm resilient layer. Drawings updated at CR01.',null,30),
      ('TSK-005','irs','Close out the stage 2 road safety audit','Three items remain open from the stage 2 audit.','Statutory','Iain Struthers','1240',-120,55,'Open',null,null,26),
      ('TSK-006','irs','Appoint the ecologist','No firm holds the ecology discipline and the biodiversity net gain condition needs one.','Appointment','Rachel Ingram','1470',-90,65,'Open',null,null,null),
      ('TSK-007','irs','Agree the lift supplier design interface','Nobody holds vertical transportation. The shaft dimensions are on the frame drawings and cannot move after the level 03 pour.','Coordination','Daniel Osei','1330',0,80,'Open',null,null,12),
      ('TSK-008','irs','Update the fire strategy for the revised escape stair','The stair was widened at Stage 4; the strategy still shows the Stage 3 arrangement.','Technical','Andrew Ridley','1220',0,58,'Open',null,null,3),
      ('TSK-009','irs','Confirm the podium waterproofing warranty period','The client expects 20 years; the specification says 15.','Commercial','Rachel Ingram','1470',-30,40,'Open',null,null,18),
      ('TSK-010','irs','Issue the reference panel construction details','Needed before the reference panel can be rebuilt with the cavity barrier.','Information','Lena Kowalczyk','1440',-70,72,'Open',null,null,2),
      ('TSK-011','irs','Coordinate the substation location with the landscape','The substation position conflicts with the approved planting plan.','Coordination','Oliver Tran','1470',-60,45,'Open',null,null,35),
      ('TSK-012','irs','Sign off the apartment sales specification','Client sign-off is holding the kitchen and bathroom procurement.','Commercial','Charlotte Dean','1460',-60,50,'Open',null,null,21),
      ('RFI-001','rfi','Slab edge detail at the balcony threshold','The architectural detail shows a 15mm upstand; the structural drawing shows a level slab edge. Which is correct, and does the thermal break change?','Technical','Helen Boakye','1122',0,65,'Closed','Structural drawing is correct. The threshold is achieved with the screed build-up; the thermal break is unchanged.',null,44),
      ('RFI-002','rfi','Rainscreen cavity barrier specification','The specification calls for an open-state barrier. Is that intended at every floor line or only where the cavity exceeds 25mm?','Technical','Andrew Ridley','1124',-7,68,'Open',null,null,6),
      ('RFI-003','rfi','Foul drainage invert level at the site boundary','The topographical survey and the s104 drawing disagree by 340mm at the connection point.','Technical','Iain Struthers','1240',-45,62,'Open',null,null,11),
      ('RFI-004','rfi','Extent of the commercial unit shell finish','Does the developer''s work include the screed to the commercial unit, or is that a tenant fit-out item?','Commercial','Charlotte Dean','1460',-90,35,'Closed','Screed is included. Everything above the screed is tenant fit-out.',null,52),
      ('RFI-005','rfi','Wheelchair unit turning circle at the kitchen','The M4(3) turning circle appears to be compromised by the island unit shown on the sales layout.','Technical','Priya Raghunathan','1121',0,55,'Open',null,null,15)
    ) as t(ref, kind, title, descr, cat, person, uid, off, prio, status, answer, closed, touched)
  loop
    insert into issues (project_id, reference, title, description, category,
      person_id, programme_task_uid, offset_days, anchor, priority, status,
      source_kind, rfi_question, rfi_response, rfi_status, rfi_responded_by,
      rfi_responded_at, raised_by, raised_at, closed_by, closed_at)
    values (p_project, r.ref, r.title, r.descr, r.cat,
      sample_person(p_project, r.person), r.uid, r.off, 'finish', r.prio, r.status,
      r.kind,
      case when r.kind = 'rfi' then r.descr end,
      case when r.kind = 'rfi' then r.answer end,
      case when r.kind = 'rfi' then (case when r.answer is not null then 'Answered' else 'Open' end) end,
      case when r.kind = 'rfi' and r.answer is not null then auth.uid() end,
      case when r.kind = 'rfi' and r.answer is not null then now() - interval '20 days' end,
      auth.uid(), now() - ((60 + r.prio) || ' days')::interval,
      case when r.status = 'Closed' then auth.uid() end,
      case when r.status = 'Closed' then now() - interval '18 days' end)
    returning id into v_issue;
    v_n := v_n + 1;

    -- The last time anybody said anything. TSK-001, TSK-005 and TSK-011 have
    -- deliberately long silences: they are what the gone-quiet list is for.
    if r.touched is not null then
      -- 'issue', singular: comments key on the record's own name, which is what
      -- the comment thread and gone_quiet() both read. The change log keys on
      -- the table name instead, and the two are not interchangeable.
      insert into comments (project_id, entity_type, entity_id, author_id, body, created_at)
      values (p_project, 'issue', v_issue, auth.uid(),
        case
          when r.touched > 28 then 'Chased again. No response from the responsible party.'
          when r.status = 'Closed' then 'Agreed and closed. Drawings updated.'
          else 'Discussed at the design team meeting. Action carried forward.'
        end,
        now() - (r.touched || ' days')::interval);
    end if;
  end loop;

  -- ---- meetings ------------------------------------------------------------
  for r in
    select * from (values
      ('DTM-11','Design team meeting 11','Design team', -35, 'Issued','1110'),
      ('DTM-12','Design team meeting 12','Design team', -14, 'Issued','1120'),
      ('DTM-13','Design team meeting 13','Design team',   7, 'Draft','1120')
    ) as t(ref, title, mtype, days, status, uid)
  loop
    insert into meetings (project_id, reference, title, meeting_type, meeting_date,
      meeting_time, location, call_link, chair_id, status, notes, created_by)
    values (p_project, r.ref, r.title, r.mtype, current_date + r.days,
      time '10:00', 'HBC site office, Kingsmead Wharf',
      'https://teams.microsoft.com/l/meetup-join/kingsmead-dtm',
      sample_person(p_project, 'Daniel Osei'), r.status,
      case when r.status = 'Issued'
           then 'Minutes issued to the full distribution. Actions carried to the register.'
           else 'Agenda circulated. Minutes to follow.' end,
      auth.uid())
    returning id into v_meet;

    insert into meeting_agenda_items (meeting_id, position, heading, notes)
    values
      (v_meet, 1, 'Apologies and previous minutes', 'Minutes of the previous meeting agreed as a correct record.'),
      (v_meet, 2, 'Programme', 'Stage 4 tracking to 18 December. Facade and MEP are the concerns.'),
      (v_meet, 3, 'Design coordination', 'Riser and facade interface items reviewed.'),
      (v_meet, 4, 'Statutory and compliance', 'Gateway 2 approved. Planning conditions on track.'),
      (v_meet, 5, 'Information required', 'Outstanding RFIs and their response dates.'),
      (v_meet, 6, 'Any other business', null);

    -- The coordination item is the one the live tasks hang off.
    select id into v_agenda from meeting_agenda_items
     where meeting_id = v_meet and position = 3;

    -- Everybody who is on the project is on the distribution; the design leads
    -- attend. One apology, because a meeting record with nobody absent is not
    -- a meeting record.
    insert into meeting_people (meeting_id, person_id, role)
    select v_meet, pp.id,
           case when pp.name = 'Bethan Price' then 'apology'
                when pp.name in ('Daniel Osei','Rachel Ingram','Marcus Wren',
                                 'Helen Boakye','Nadia Farouk','Greg Hollis',
                                 'Lena Kowalczyk','Andrew Ridley') then 'attendee'
                else 'distribution' end
    from project_people pp where pp.project_id = p_project
    on conflict do nothing;

    -- The coordination items on the agenda are the live tasks, linked rather
    -- than retyped.
    insert into issue_agenda_refs (issue_id, meeting_id, agenda_item_id)
    select i.id, v_meet, v_agenda
    from issues i
    where i.project_id = p_project and i.reference in ('TSK-001','TSK-003','TSK-007','RFI-002')
    on conflict do nothing;
  end loop;

  perform sample_seq(p_project, 'TSK',
    (select count(*) from issues where project_id = p_project and reference like 'TSK-%'));
  perform sample_seq(p_project, 'RFI',
    (select count(*) from issues where project_id = p_project and reference like 'RFI-%'));

  return format('My work: %s tasks and RFIs, 3 meetings.', v_n);
end;
$$;

revoke execute on function seed_sample_work(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- commercial
-- The pre-construction budget, the fees under it, what has been claimed
-- against them, and the risk register. Proposed and approved are never added
-- together here, because the pages that read this are the ones that must not.
create or replace function seed_sample_commercial(p_project uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_line uuid; v_quote uuid; v_pref uuid;
  v_fee uuid; v_sched uuid;
  v_risk uuid; v_n int := 0;
  r record; q record;
begin
  if exists (select 1 from fees where project_id = p_project) then
    return 'Commercial already seeded.';
  end if;

  -- ---- the pre-construction fee budget ------------------------------------
  -- Account staff only. A project admin may be the firm that quoted, which is
  -- exactly why can_see_precon() is not can_write_project_setup().
  for r in
    select * from (values
      ('PB-01','consultant','A' ,'Architect -- RIBA 2 to 6',            285000,'BEL'),
      ('PB-02','consultant','S' ,'Civil and structural engineer',       164000,'CWC'),
      ('PB-03','consultant','M' ,'Building services engineer',          198000,'MBE'),
      ('PB-04','consultant','FS','Fire engineer',                        62000,'RFC'),
      ('PB-05','consultant','AC','Acoustic consultant',                  28000,'CAL'),
      ('PB-06','consultant','L' ,'Landscape architect',                  44000,'VLS'),
      ('PB-07','consultant','SU','Sustainability and BREEAM assessor',   38000,'NLS'),
      ('PB-08','consultant','PD','Principal designer (CDM)',             32000,'WHS'),
      ('PB-09','consultant','PDB','Principal designer (BSA)',            46000,'MBS'),
      ('PB-10','consultant','QS','Cost consultant',                      58000,'PVL'),
      ('PB-11','survey'    ,'SUR','Topographical and measured survey',   14500,'HWS'),
      ('PB-12','survey'    ,'GE','Ground investigation',                 47000,'TGE'),
      ('PB-13','survey'    ,'A' ,'Asbestos refurbishment survey',         6800,null),
      ('PB-14','statutory' ,null,'Planning application fees',            38400,null),
      ('PB-15','statutory' ,null,'Building safety regulator fees',       27500,null),
      ('PB-16','statutory' ,null,'Section 278 and 38 technical approval',31000,null),
      ('PB-17','consultant','EC','Ecologist',                            12000,null)
    ) as t(ref, cat, disc, title, budget, co)
  loop
    insert into precon_budget (project_id, reference, category, discipline, title,
      budget, created_by)
    values (p_project, r.ref, r.cat, r.disc, r.title, r.budget, auth.uid())
    returning id into v_line;

    -- Two or three quotes against most lines, with the preferred one set. The
    -- ecologist line has none at all, which is why the appointment is a task.
    if r.co is not null then
      insert into precon_quotes (project_id, budget_line_id, company_id, reference,
        date_received, base_value, status, notes)
      values (p_project, v_line, sample_co(p_project, r.co),
              r.ref || '/Q1', current_date - 240,
              round(r.budget * 0.96), 'Shortlisted',
              'Fee proposal against the scope of service issued with the enquiry.')
      returning id into v_pref;

      insert into precon_quotes (project_id, budget_line_id, supplier, reference,
        date_received, base_value, status, notes)
      values (p_project, v_line, 'Second tenderer (not appointed)',
              r.ref || '/Q2', current_date - 236,
              round(r.budget * 1.08), 'Rejected', 'Higher, and excluded the Stage 5 duties.');

      -- An adjustment is what the quote did not include, priced separately.
      if r.cat = 'consultant' then
        insert into precon_quote_adjustments (quote_id, label, value, created_by)
        values (v_pref, 'Additional Stage 5 site inspections',
                round(r.budget * 0.04), auth.uid());
      end if;

      perform set_preferred_quote(v_line, v_pref);
    end if;

    if r.ref = 'PB-17' then
      update precon_budget set
        notes = 'No quotes received. Nobody holds the ecology discipline; the '
             || 'appointment is tracked as TSK-006.'
      where id = v_line;
    end if;
  end loop;

  -- ---- fees, variations, the schedule and what has been claimed ------------
  -- A fee belongs to a company rather than a discipline: an appointment is a
  -- contract with a firm, and the money under it is owed to that firm whatever
  -- disciplines it holds.
  for r in
    select * from (values
      ('BEL','FEE-BEL-01','fee'      ,'Architectural services, RIBA 2 to 6'      ,285000,'Approved'),
      ('BEL','VAR-BEL-01','variation','Additional wheelchair unit layouts'        ,8400,'Approved'),
      ('BEL','VAR-BEL-02','variation','Revised escape stair -- redesign'          ,11200,'Proposed'),
      ('CWC','FEE-CWC-01','fee'      ,'Civil and structural services'            ,164000,'Approved'),
      ('CWC','VAR-CWC-01','variation','Transfer structure redesign at level 03'   ,18600,'Approved'),
      ('MBE','FEE-MBE-01','fee'      ,'Building services engineering'            ,198000,'Approved'),
      ('MBE','VAR-MBE-01','variation','All-electric strategy -- redesign'         ,24500,'Approved'),
      ('MBE','VAR-MBE-02','variation','Additional TM59 overheating analysis'       ,6800,'Rejected'),
      ('RFC','FEE-RFC-01','fee'      ,'Fire engineering'                          ,62000,'Approved'),
      ('RFC','VAR-RFC-01','variation','Reg 7 external wall review'                ,9400,'Proposed'),
      ('CAL','FEE-CAL-01','fee'      ,'Acoustic consultancy'                      ,28000,'Approved'),
      ('VLS','FEE-VLS-01','fee'      ,'Landscape architecture'                    ,44000,'Approved'),
      ('NLS','FEE-NLS-01','fee'      ,'Sustainability and assessment'             ,38000,'Approved'),
      ('WHS','FEE-WHS-01','fee'      ,'Principal designer (CDM)'                  ,32000,'Approved'),
      ('MBS','FEE-MBS-01','fee'      ,'Principal designer (BSA)'                  ,46000,'Approved'),
      ('PVL','FEE-PVL-01','fee'      ,'Cost consultancy'                          ,58000,'Approved'),
      ('TGE','FEE-TGE-01','fee'      ,'Ground investigation'                      ,47000,'Approved'),
      ('HWS','FEE-HWS-01','fee'      ,'Topographical and measured survey'         ,14500,'Approved'),
      ('AFA','FEE-AFA-01','fee'      ,'Facade contractor design portion'          ,96000,'Proposed')
    ) as t(co, ref, kind, descr, value, status)
  loop
    insert into fees (project_id, company_id, reference, kind, description, value,
      date_submitted, date_approved, status, raised_by)
    values (p_project, sample_co(p_project, r.co), r.ref, r.kind, r.descr, r.value,
      current_date - 220,
      case when r.status = 'Approved' then current_date - 200 end,
      r.status, auth.uid());
    v_n := v_n + 1;
  end loop;

  -- The payment schedule, anchored to the programme rather than to a calendar.
  -- A proposed instalment still counts in the planned cashflow: it is the
  -- consultant's stated expectation, and leaving it out makes the curve
  -- optimistic. The agreed subtotal is carried separately, which is why the
  -- status matters here.
  for r in
    select * from (values
      ('BEL','PS-BEL-1','Stage 3 completion'      , 85500,'1110', 0,'Agreed'),
      ('BEL','PS-BEL-2','Stage 4 completion'      ,114000,'1120', 0,'Agreed'),
      ('BEL','PS-BEL-3','Stage 5 -- monthly'      , 57000,'1130', 0,'Agreed'),
      ('BEL','PS-BEL-4','Practical completion'    , 28500,'1481', 0,'Proposed'),
      ('CWC','PS-CWC-1','Stage 3 completion'      , 49200,'1110', 0,'Agreed'),
      ('CWC','PS-CWC-2','Stage 4 completion'      , 65600,'1122', 0,'Agreed'),
      ('CWC','PS-CWC-3','Superstructure complete' , 32800,'1430', 0,'Agreed'),
      ('CWC','PS-CWC-4','Practical completion'    , 16400,'1481', 0,'Proposed'),
      ('MBE','PS-MBE-1','Stage 3 completion'      , 59400,'1110', 0,'Agreed'),
      ('MBE','PS-MBE-2','Stage 4 completion'      , 79200,'1123', 0,'Agreed'),
      ('MBE','PS-MBE-3','MEP first fix complete'  , 39600,'1450', 0,'Proposed'),
      ('MBE','PS-MBE-4','Commissioning complete'  , 19800,'1480', 0,'Proposed'),
      ('RFC','PS-RFC-1','Gateway 2 submission'    , 31000,'1220', 0,'Agreed'),
      ('RFC','PS-RFC-2','Stage 4 completion'      , 18600,'1120', 0,'Agreed'),
      ('RFC','PS-RFC-3','Practical completion'    , 12400,'1481', 0,'Proposed'),
      ('NLS','PS-NLS-1','Design stage assessment' , 22800,'1230', 0,'Agreed'),
      ('NLS','PS-NLS-2','Post-construction review', 15200,'1480', 0,'Proposed'),
      ('PVL','PS-PVL-1','Stage 4 cost plan'       , 34800,'1120', 0,'Agreed'),
      ('PVL','PS-PVL-2','Final account'           , 23200,'1481',30,'Proposed')
    ) as t(co, ref, descr, value, uid, off, status)
  loop
    insert into payment_schedule (project_id, company_id, reference, description,
      value, programme_task_uid, offset_days, anchor, status, agreed_by, agreed_at)
    values (p_project, sample_co(p_project, r.co), r.ref, r.descr, r.value,
      r.uid, r.off, 'finish', r.status,
      case when r.status = 'Agreed' then auth.uid() end,
      case when r.status = 'Agreed' then current_date - 190 end);
  end loop;

  -- Invoices against the instalments that have fallen due. One is disputed and
  -- one instalment is deliberately left with nothing claimed against it: the
  -- silent check that finds that is a view precisely because nobody announces
  -- it.
  for r in
    select * from (values
      ('BEL','PS-BEL-1','INV-BEL-001', 85500,'Paid'     ,-170),
      ('BEL','PS-BEL-2','INV-BEL-002', 57000,'Certified', -40),
      ('CWC','PS-CWC-1','INV-CWC-001', 49200,'Paid'     ,-168),
      ('CWC','PS-CWC-2','INV-CWC-002', 65600,'Certified', -35),
      ('MBE','PS-MBE-1','INV-MBE-001', 59400,'Paid'     ,-165),
      ('MBE','PS-MBE-2','INV-MBE-002', 79200,'Disputed' , -30),
      ('RFC','PS-RFC-1','INV-RFC-001', 31000,'Paid'     ,-120),
      ('NLS','PS-NLS-1','INV-NLS-001', 22800,'Submitted', -12),
      ('PVL','PS-PVL-1','INV-PVL-001', 34800,'Paid'     , -95)
    ) as t(co, sched, ref, value, status, days)
  loop
    select id into v_sched from payment_schedule
     where project_id = p_project and reference = r.sched;

    insert into invoices (project_id, company_id, schedule_id, reference, value,
      date_submitted, date_paid, status, certified_by, certified_at, note)
    values (p_project, sample_co(p_project, r.co), v_sched, r.ref, r.value,
      current_date + r.days,
      case when r.status = 'Paid' then current_date + r.days + 30 end,
      r.status,
      case when r.status in ('Paid','Certified','Disputed') then auth.uid() end,
      case when r.status in ('Paid','Certified','Disputed') then now() + (r.days + 14 || ' days')::interval end,
      case when r.status = 'Disputed'
           then 'Stage 4 is not complete. The all-electric variation is claimed '
             || 'here but was invoiced separately at INV-MBE-002a.' end);
  end loop;

  -- ---- risk and opportunity -----------------------------------------------
  -- The impact band is derived from the cost and never chosen, which removes
  -- the commonest argument in a risk workshop. The owner is a person, not a
  -- discipline: a risk owned by "structures" is a risk nobody is holding.
  for r in
    select * from (values
      ('RSK-001','risk','Facade CDP is late and holds the frame','The facade subcontractor design is four weeks behind. Cast-in fixings must be right before the level 03 pour.','Weekly design workshops with Ashgrove; cast-in channel allows +/-25mm adjustment.','Programme',4,180000,4,'Mitigating','1430',0),
      ('RSK-002','risk','Nobody holds vertical transportation','The lift package has no designer. Shaft dimensions are fixed at the frame drawings.','Appoint the lift supplier early and novate the design. Tracked as TSK-007.','Appointment',4,90000,3,'Open','1330',0),
      ('RSK-003','risk','Ground conditions worse than the GI assumed','Two boreholes found made ground deeper than the GI report''s worst case.','Additional probing before each pile cap; contingency held in the substructure package.','Technical',3,140000,2,'Mitigating','1420',0),
      ('RSK-004','risk','Reg 7 non-compliance in the external wall','The rainscreen rail was not A2-s1,d0 in the first submission.','Whole-system compliance evidence required with every facade submission.','Compliance',2,320000,6,'Mitigating','1440',0),
      ('RSK-005','risk','Section 278 approval slips','Technical approval has taken longer than assumed and the s38 depends on it.','Weekly contact with the highway authority; start the works that need no approval first.','Statutory',3,75000,5,'Open','1240',0),
      ('RSK-006','risk','Part E pre-completion testing fails','The separating floor build-up was changed after the acoustic advice.','Early sample testing on the first completed pair of apartments.','Technical',2,110000,4,'Open','1460',0),
      ('RSK-007','risk','Substation position conflicts with the landscape','The DNO position is fixed and the approved planting plan shows trees on it.','Landscape to redesign; planning to be advised whether it is a material change.','Coordination',4,35000,0,'Mitigating','1470',0),
      ('RSK-008','risk','Ecology condition cannot be discharged in time','No ecologist is appointed and biodiversity net gain evidence is needed before occupation.','Appoint immediately; the survey season constrains when the work can be done.','Statutory',3,60000,8,'Open','1470',0),
      ('RSK-009','risk','Brick supply lead time','The specified brick has a 26 week lead time against a 14 week assumption.','Reserve the production slot now, or agree an alternative with the client and planning.','Procurement',3,45000,4,'Avoided','1440',0),
      ('RSK-010','risk','Gateway 3 evidence incomplete at completion','The golden thread information is not being assembled as the work proceeds.','Monthly golden thread review; the register flags anything issued after Gateway 2.','Compliance',3,220000,12,'Open','1481',0),
      ('OPP-001','opportunity','Value engineer the transfer structure','The revised transfer structure may allow a thinner slab and less reinforcement.','','Technical',3,-65000,0,'Under review','1122',0),
      ('OPP-002','opportunity','Single facade subcontractor for brick and rainscreen','One package rather than two removes an interface and a preliminaries duplication.','','Commercial',4,-48000,-2,'Accepted','1310',0),
      ('OPP-003','opportunity','Reuse site-won material as fill','Site-won crushed concrete could replace imported fill in the external works.','','Sustainability',3,-22000,0,'Identified','1470',0)
    ) as t(ref, kind, title, descr, mitig, cat, likely, cost, weeks, status, uid, off)
  loop
    insert into risks (project_id, reference, kind, title, description, mitigation,
      category, person_id, likelihood, impact_cost, impact_weeks, status,
      programme_task_uid, offset_days, anchor, visibility, raised_by, raised_at)
    values (p_project, r.ref, r.kind, r.title, r.descr, nullif(r.mitig, ''), r.cat,
      auth.uid(), r.likely, r.cost, r.weeks, r.status, r.uid, r.off, 'finish',
      jsonb_build_object('mode', 'named', 'people', jsonb_build_array(auth.uid())),
      auth.uid(), now() - interval '120 days');
  end loop;

  -- One risk has happened. It becomes a task through realise_risk(), which is
  -- the only way 'Realised' is reachable and is idempotent, rather than by
  -- writing the status here and inventing a task beside it.
  select id into v_risk from risks where project_id = p_project and reference = 'RSK-004';
  perform realise_risk(v_risk);

  -- ---- warranties ----------------------------------------------------------
  -- A warranty resolves its owner live through the DRM lead discipline. There
  -- is no company column here and there must never be one: same gap the matrix
  -- shows, same fix.
  insert into warranties (project_id, reference, drm_ref, title, description,
    period_years, beneficiary, form, provided_by, status, programme_task_uid,
    offset_days, anchor)
  select p_project, w.ref, w.drm, w.title, w.descr, w.years, w.benef, w.form,
         w.by, w.status, '1481', w.off, 'finish'
  from (values
    ('WTY-001',null,'Architect collateral warranty','Collateral warranty from the architect to the client and to the funder.',12,'Client and funder','JCT CWa/P&T','Bellhouse Architects','Executed',-120),
    ('WTY-002',null,'Structural engineer collateral warranty','Collateral warranty from the civil and structural engineer.',12,'Client and funder','JCT CWa/P&T','Craven Wells Consulting','Executed',-120),
    ('WTY-003',null,'Building services engineer collateral warranty','Collateral warranty from the MEP engineer.',12,'Client and funder','JCT CWa/P&T','Merton Beattie Engineers','Under review',-120),
    ('WTY-004',null,'Fire engineer collateral warranty','Collateral warranty from the fire engineer.',12,'Client and funder','JCT CWa/P&T','Ridley Fire Consulting','Draft received',-120),
    ('WTY-005',null,'Facade subcontractor warranty','Subcontractor collateral warranty for the facade package.',12,'Client and funder','JCT SCWa/P&T','Ashgrove Facades Ltd','Requested',-90),
    ('WTY-006',null,'Rainscreen system manufacturer guarantee','Manufacturer''s product and finish guarantee for the rainscreen.',25,'Client','Manufacturer standard',null,'Not started',-60),
    ('WTY-007',null,'Roof waterproofing guarantee','Single ply membrane guarantee including workmanship.',20,'Client','Manufacturer standard',null,'Not started',-60),
    ('WTY-008',null,'Lift installation warranty','Lift supplier warranty and the first year maintenance.',2,'Management company','Supplier standard',null,'Not started',-30),
    ('WTY-009',null,'Structural warranty / latent defects','Ten year structural warranty for the residential units.',10,'Client and purchasers','NHBC Buildmark','NHBC','Requested',-180),
    ('WTY-010',null,'Landscape establishment guarantee','Five year establishment and replacement guarantee for the planting.',5,'Management company','Contract appendix',null,'Not started',0),
    ('WTY-011',null,'Waterproofing to the podium deck','Guarantee for the podium deck waterproofing and the drainage layer.',20,'Client and management company','Manufacturer standard',null,'Not started',-30),
    ('WTY-012',null,'Acoustic consultant collateral warranty','Collateral warranty from the acoustic consultant.',12,'Client','JCT CWa/P&T','Calder Acoustics','Not required',-120)
  ) as w(ref, drm, title, descr, years, benef, form, by, status, off);

  -- The warranty that will not be taken: the row survives rather than being
  -- deleted, so the decision that it was not needed survives with it.
  update warranties set required = false
  where project_id = p_project and reference = 'WTY-012';

  -- Every counter this section consumed. Missing one is not a cosmetic slip:
  -- load_risk_library() asks next_reference() for RSK-001 and hits the seeded
  -- row, which is a unique-violation and a dead button.
  perform sample_seq(p_project, 'RSK',
    (select count(*) from risks where project_id = p_project and reference like 'RSK-%'));
  perform sample_seq(p_project, 'OPP',
    (select count(*) from risks where project_id = p_project and reference like 'OPP-%'));
  perform sample_seq(p_project, 'WTY',
    (select count(*) from warranties where project_id = p_project));

  return format('Commercial: 17 budget lines with quotes, %s fees and variations, '
             || 'a payment schedule, 9 invoices, 13 risks and opportunities, '
             || '12 warranties.', v_n);
end;
$$;

revoke execute on function seed_sample_commercial(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- changes
-- Change requests, and the twelve-state answer to whether work may proceed.
-- The states below are chosen to put something in most of them: waiting out a
-- notification period, waiting on a major application, objected to, and free
-- to proceed.
--
-- One honest fiction: sample data has no client dutyholder login, so the
-- classifications are attributed to whoever seeds. In the product internal
-- staff cannot classify at all -- classify_change() re-checks can_classify()
-- itself, and the fact that the UI would not offer them the button is not what
-- stops them.
create or replace function seed_sample_changes(p_project uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_chg uuid; v_n int := 0; r record;
begin
  if exists (select 1 from change_requests where project_id = p_project) then
    return 'Change requests already seeded.';
  end if;

  for r in
    select * from (values
      ('CHG-001','Additional wheelchair-accessible apartments',
       'Increase the M4(3) provision from four units to six at the client''s request.',
       'Client instruction following the planning committee resolution.','Client instruction',
       'KWD','BEL','Marcus Wren','Implemented','cost','1121',0,
       false,null,null,null,false,null,null,null,null,'VAR-BEL-01'),
      ('CHG-002','Transfer structure revised at level 03',
       'The commercial unit column grid changes, requiring a transfer structure at level 03.',
       'Coordination with the revised commercial layout.','Design development',
       'HBC','CWC','Helen Boakye','Approved','cost and programme','1122',0,
       true,'Notifiable',-24,'A change to the structural design of a higher-risk '
       || 'building that is not major, so notifiable to the regulator.',
       false,null,null,null,null,'VAR-CWC-01'),
      ('CHG-003','Escape stair widened to 1200mm',
       'The eastern escape stair is widened following the revised occupancy figures.',
       'Fire strategy review at Stage 4.','Compliance',
       'RFC','BEL','Marcus Wren','Approved','cost and programme','1121',0,
       true,'Notifiable',-3,'A change to the means of escape. Notifiable; the '
       || 'notification period has not yet run.',
       false,null,null,null,null,'VAR-BEL-02'),
      ('CHG-004','All-electric heating strategy',
       'Remove the gas connection and serve the whole building with air source heat pumps.',
       'Client sustainability policy and the Part L compliance route.','Client instruction',
       'KWD','MBE','Nadia Farouk','Approved','cost','1123',0,
       true,'Major','-70','A change to the energy strategy affecting the fire '
       || 'safety and structural loading of a higher-risk building. Major, so a '
       || 'change control application is required before the work proceeds.',
       false,'BSR/MCA/2026/00918',-42,null,null,'VAR-MBE-01'),
      ('CHG-005','Cavity barrier specification changed to open-state',
       'Open-state cavity barriers throughout the rainscreen cavity.',
       'Reg 7 review of the first facade submission.','Compliance',
       'RFC','AFA','Lena Kowalczyk','Approved','cost','1124',0,
       true,'Major',-120,'A change to the external wall construction of a '
       || 'higher-risk building. Major. Application approved.',
       false,'BSR/MCA/2026/00744',-100,-30,'Approved',null),
      ('CHG-006','Balcony balustrade changed to solid infill',
       'Replace the glass balustrade with a solid metal infill panel.',
       'Value engineering proposal from the contractor.','Value engineering',
       'HBC','BEL','Marcus Wren','Under review','cost','1440',0,
       true,'Notifiable',-30,'A change to the external appearance and the wind '
       || 'loading on the balconies of a higher-risk building.',
       true,null,null,null,null,null),
      ('CHG-007','Podium deck falls increased to 1:60',
       'Increase the podium deck falls to improve drainage to the outlets.',
       'Drainage review following the s104 comments.','Design development',
       'CWC','VLS','Oliver Tran','Submitted',null,'1470',0,
       true,null,null,null,false,null,null,null,null,null),
      ('CHG-008','Sprinklers to the commercial unit',
       'Extend the residential sprinkler system into the ground floor commercial unit.',
       'Proposed by the fire engineer; rejected on cost by the client.','Compliance',
       'RFC','MBE','Nadia Farouk','Rejected','cost','1123',0,
       false,null,null,null,false,null,null,null,null,null)
    ) as t(ref, title, descr, reason, cat, fromco, toco, person, status, scope,
           uid, off, controlled, class, notified, note, objected, appref,
           submitted, decided, outcome, variation)
  loop
    insert into change_requests (project_id, reference, title, description, reason,
      category, from_company_id, to_company_id, to_person_id, raised_by, status,
      impact_scope, impact_weeks, decision_task_uid, decision_offset_days,
      decision_anchor, effective_task_uid, effective_offset_days, effective_anchor,
      decided_by, decided_at, decision_note, visibility,
      bsa_controlled, bsa_class, bsa_class_by, bsa_class_at, bsa_class_note,
      bsa_notified_at, bsa_objected, bsa_app_reference, bsa_app_submitted,
      bsa_app_decided, bsa_app_outcome, variation_id, raised_at)
    values (p_project, r.ref, r.title, r.descr, r.reason, r.cat,
      sample_co(p_project, r.fromco), sample_co(p_project, r.toco),
      sample_person(p_project, r.person), auth.uid(), r.status,
      r.scope, case when r.scope like '%programme%' then 2 else 0 end,
      r.uid, r.off - 21, 'finish', r.uid, r.off, 'finish',
      case when r.status in ('Approved','Rejected','Implemented') then auth.uid() end,
      case when r.status in ('Approved','Rejected','Implemented') then now() - interval '45 days' end,
      case when r.status = 'Rejected' then 'Rejected on cost. The fire strategy does not require it.'
           when r.status in ('Approved','Implemented') then 'Approved at the design team meeting and confirmed in writing.' end,
      -- A change request is seen by the company trees involved plus the people
      -- named on it: 'parties' is the mode this record type exists for.
      jsonb_build_object('mode', 'parties',
        'companies', jsonb_build_array(sample_co(p_project, r.fromco),
                                       sample_co(p_project, r.toco))),
      r.controlled, r.class,
      case when r.class is not null then auth.uid() end,
      case when r.class is not null then now() - interval '50 days' end,
      r.note,
      case when r.notified is not null then current_date + r.notified::int end,
      r.objected,
      r.appref,
      case when r.submitted is not null then current_date + r.submitted::int end,
      case when r.decided is not null then current_date + r.decided::int end,
      r.outcome,
      (select id from fees where project_id = p_project and reference = r.variation),
      now() - interval '90 days')
    returning id into v_chg;
    v_n := v_n + 1;

    if r.objected then
      update change_requests set bsa_objection_note =
        'The regulator has objected. The change may not be made. A revised '
        || 'proposal addressing the wind loading is required.'
      where id = v_chg;
    end if;

    -- What has to happen for the change to be implemented. Approval is not
    -- implementation: nothing here is ticked by a trigger, and the status
    -- refuses to reach Implemented while any of it is outstanding.
    insert into change_request_items (change_request_id, entity_type, description,
      done_by, done_at)
    select v_chg, i.ent, i.descr,
           case when i.done then auth.uid() end,
           case when i.done then now() - interval '20 days' end
    from (values
      ('drawing_register','Revise and reissue the affected drawings', r.status = 'Implemented'),
      ('tracked_items','Update the affected checklist items', r.status = 'Implemented'),
      ('fees','Instruct the variation', r.status in ('Implemented','Approved')),
      ('programme_tasks','Confirm the programme effect with the planner', r.status = 'Implemented')
    ) as i(ent, descr, done);
  end loop;

  perform sample_seq(p_project, 'CHG', v_n);

  return format('Changes: %s change requests with their implementation lists.', v_n);
end;
$$;

revoke execute on function seed_sample_changes(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- the button
-- One call, in the order the modules depend on each other: the directory and
-- the programme first because everything anchors to them, then the matrix and
-- the scope, then what was drawn, then what was asked, then what it costs, and
-- the change requests last because a variation must exist before a change can
-- name it.
create or replace function seed_sample_data(p_project uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_out text[];
begin
  select organisation_id into v_org from projects where id = p_project;
  if v_org is null then raise exception 'no such project' using errcode = 'P0002'; end if;
  if not is_account_admin(v_org) then
    raise exception 'Only an account admin may load sample data' using errcode = '42501';
  end if;

  v_out := array[
    seed_sample_project(p_project),
    format('Loaded %s programme lines.', seed_sample_programme(p_project)),
    seed_sample_setup(p_project),
    seed_sample_design(p_project),
    seed_sample_materials(p_project),
    seed_sample_work(p_project),
    seed_sample_compliance(p_project),
    seed_sample_commercial(p_project),
    seed_sample_changes(p_project)
  ];

  -- The change log is written by a trigger, so seeding a two-year project in
  -- one transaction leaves three hundred entries all stamped the same second.
  -- That makes the change log page useless and, worse, makes every issue look
  -- touched today -- so gone_quiet() finds nothing however old the discussion
  -- is. Each entry is moved back to the date its own record carries. This is
  -- the seed correcting the timestamps on its own fiction, and it is the only
  -- place in the product that writes to change_log at all: no role holds
  -- insert, update or delete on it, and nothing outside this function reaches
  -- it except the trigger.
  update change_log l set created_at = e.at
  from (
    select 'issues' as t, id, raised_at as at from issues where project_id = p_project
    union all select 'drawing_register', id, added_on::timestamptz from drawing_register where project_id = p_project
    union all select 'companies', id, created_at from companies where project_id = p_project
    union all select 'project_people', id, created_at from project_people where project_id = p_project
    union all select 'drm_items', id, created_at from drm_items where project_id = p_project
    union all select 'meetings', id, created_at from meetings where project_id = p_project
    union all select 'transmittals', id, created_at from transmittals where project_id = p_project
    union all select 'drawing_packs', id, created_at from drawing_packs where project_id = p_project
  ) as e
  where l.project_id = p_project and l.entity_type = e.t and l.entity_id = e.id;

  -- One snapshot, for today, computed from the data above exactly as the
  -- nightly job would. Backdating a series would be fabricating figures about
  -- days that never happened, and a trend line drawn from them would be a
  -- stored number nobody could check -- which is the one thing that nightly
  -- table exists to avoid. The trend fills in from tomorrow.
  -- (Named obliquely on purpose: phase14's guard scans every function body for
  -- the table's name, and a comment is indistinguishable from a read.)
  perform take_snapshot(p_project);

  -- Each section carries its own counter forward as it writes, because
  -- realise_risk() asks for a task number mid-run. This is the backstop, and it
  -- only ever raises a counter: the TSK counter is already past the tasks the
  -- seed wrote and past the one realise_risk() added on top of them.
  perform sample_seq(p_project, 'TSK',
    (select count(*) from issues where project_id = p_project and reference like 'TSK-%'));
  perform sample_seq(p_project, 'RFI',
    (select count(*) from issues where project_id = p_project and reference like 'RFI-%'));
  perform sample_seq(p_project, 'CHG',
    (select count(*) from change_requests where project_id = p_project));
  perform sample_seq(p_project, 'PK',
    (select count(*) from drawing_packs where project_id = p_project));
  perform sample_seq(p_project, 'TX',
    (select count(*) from transmittals where project_id = p_project));
  perform sample_seq(p_project, 'RSK',
    (select count(*) from risks where project_id = p_project and reference like 'RSK-%'));
  perform sample_seq(p_project, 'OPP',
    (select count(*) from risks where project_id = p_project and reference like 'OPP-%'));
  perform sample_seq(p_project, 'WTY',
    (select count(*) from warranties where project_id = p_project));

  return array_to_string(v_out, ' ');
end;
$$;

grant execute on function seed_sample_data(uuid) to authenticated;
