-- Phase 12, part nine -- the line inspector reaches this phase's four dates.
--
-- Payment schedules, risk review dates, warranties and material samples all
-- gained the four anchor columns, so all four join programme_dependents().
-- The rule is that a table gaining them adds its branch in the same migration;
-- this phase adds four in six files, and one replacement of the function is
-- clearer than four. supabase/tests/phase4.test.ts is what actually enforces
-- it: the guard reads pg_proc and fails the build for any anchored COLUMN the
-- function does not resolve.
--
-- Every branch is filtered by the same visibility the module's own policy
-- applies. The inspector is a definer-free view onto other people's records,
-- so a consultant clicking a programme line must not learn that a rival has
-- an instalment against it.
drop function if exists programme_dependents(uuid, text);
create or replace function programme_dependents(p_project uuid, p_task_uid text)
returns table (module text, record_id uuid, ref text, description text, due date)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select 'Drawing'::text, r.id, r.document_number, coalesce(r.title, ''),
         due_date(r.project_id, r.programme_task_uid, r.offset_days, r.anchor,
                  r.due_date_override)
  from drawing_register r
  where r.project_id = p_project and r.programme_task_uid = p_task_uid
  union all
  select case i.source_kind when 'rfi' then 'RFI' else 'Task' end,
         i.id, i.reference, i.title,
         due_date(i.project_id, i.programme_task_uid, i.offset_days, i.anchor,
                  i.due_date_override)
  from issues i
  where i.project_id = p_project and i.programme_task_uid = p_task_uid
    and can_see(i.project_id, i.visibility, i.raised_by,
                (select pp.profile_id from project_people pp where pp.id = i.person_id))
  union all
  select initcap(replace(split_part(t.kind, ':', 1), '_', ' ')),
         t.id, t.reference, t.title,
         due_date(t.project_id, t.programme_task_uid, t.offset_days, t.anchor,
                  t.due_date_override)
  from tracked_items t
  where t.project_id = p_project and t.programme_task_uid = p_task_uid
    and can_see(t.project_id, t.visibility, t.created_by,
                (select pp.profile_id from project_people pp where pp.id = t.person_id))
  union all
  select 'Change (decision)', cr.id, cr.reference, cr.title,
         due_date(cr.project_id, cr.decision_task_uid, cr.decision_offset_days,
                  cr.decision_anchor, cr.decision_date_override)
  from change_requests cr
  where cr.project_id = p_project and cr.decision_task_uid = p_task_uid
    and can_see(cr.project_id, cr.visibility, cr.raised_by, null)
  union all
  select 'Change (effective)', cr.id, cr.reference, cr.title,
         due_date(cr.project_id, cr.effective_task_uid, cr.effective_offset_days,
                  cr.effective_anchor, cr.effective_date_override)
  from change_requests cr
  where cr.project_id = p_project and cr.effective_task_uid = p_task_uid
    and can_see(cr.project_id, cr.visibility, cr.raised_by, null)
  union all
  -- An instalment. Scoped by the commercial predicate, so a consultant sees
  -- their own company tree's instalments against this line and no others.
  select 'Instalment', s.id, s.reference, coalesce(s.description, ''),
         due_date(s.project_id, s.programme_task_uid, s.offset_days, s.anchor,
                  s.due_date_override)
  from payment_schedule s
  where s.project_id = p_project and s.programme_task_uid = p_task_uid
    and can_see_commercial(s.project_id, s.company_id)
  union all
  -- A risk's REVIEW date, which is what its anchor means -- not when the risk
  -- happens. Closed by default, through the same can_see() the register uses.
  select case k.kind when 'opportunity' then 'Opportunity' else 'Risk' end,
         k.id, k.reference, k.title,
         due_date(k.project_id, k.programme_task_uid, k.offset_days, k.anchor,
                  k.due_date_override)
  from risks k
  where k.project_id = p_project and k.programme_task_uid = p_task_uid
    and can_see(k.project_id, k.visibility, k.raised_by, k.person_id)
  union all
  -- A warranty. Its audience follows the resolved owner, so the filter walks
  -- the matrix rather than reading a company column that does not exist.
  select 'Warranty', w.id, w.reference, w.title,
         due_date(w.project_id, w.programme_task_uid, w.offset_days, w.anchor,
                  w.due_date_override)
  from warranties w
  where w.project_id = p_project and w.programme_task_uid = p_task_uid
    and (can_write_project_setup(w.project_id)
         or exists (select 1 from projects p
                     where p.id = w.project_id
                       and account_is_live(p.organisation_id)
                       and is_account_staff(p.organisation_id))
         or exists (select 1 from drm_items d
                     join company_disciplines cd
                       on cd.discipline_code = d.lead_discipline
                     where d.project_id = w.project_id and d.ref = w.drm_ref
                       and d.applicable
                       and cd.company_id in
                           (select company_id from my_company_tree(w.project_id))))
  union all
  select 'Material sample', m.id, m.reference, m.title,
         due_date(m.project_id, m.programme_task_uid, m.offset_days, m.anchor,
                  m.due_date_override)
  from materials m
  where m.project_id = p_project and m.programme_task_uid = p_task_uid
    and can_see_project(m.project_id)
  order by 1, 3;
$$;

grant execute on function programme_dependents(uuid, text) to authenticated;
