/**
 * Phase 9 — one tracked-item engine.
 *
 * The assertions TASKS.md names: no seeded company holds a discipline template
 * it doesn't hold the discipline for; editing a template leaves loaded projects
 * untouched; re-import updates rather than duplicates; and the denominator rule
 * for a struck-out row.
 *
 * On that last one TASKS.md contradicts itself — its own bullet says
 * `required = false` "drops from every denominator", and the handover notes say
 * so twice, but its test line says the row "stays in the denominator". The
 * notes win; what the row keeps is its *visibility*, not its place in the total.
 * Tested both ways round here so the distinction cannot be lost again.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import type { Client } from 'pg'
import { asSuperuser, asUser, makePerson, refused } from './db'

type World = {
  admin: string; cara: string
  org: string; project: string
  arch: string; mep: string; mepTwo: string
  coreTemplate: string; archTemplate: string
}
let w: World

const denied = (who: string, sql: string, params: unknown[] = []) =>
  refused(() => asUser(who, (c) => c.query(sql, params)))

beforeAll(async () => {
  w = await asSuperuser(async (c: Client) => {
    const admin = await makePerson(c, 'Ada Admin', 'p9-ada@hbc.example')
    const cara = await makePerson(c, 'Cara Consultant', 'p9-cara@bel.example')

    const org = (await c.query(
      `insert into organisations (name, slug, status) values ('HBC9','hbc9','active')
       returning id`)).rows[0].id
    for (const [p, role] of [[admin, 'admin'], [cara, 'consultant']] as const) {
      await c.query(
        'insert into organisation_members (organisation_id, profile_id, role) values ($1,$2,$3)',
        [org, p, role])
    }
    const project = (await c.query(
      `insert into projects (organisation_id, name, code) values ($1,'Kingsmead','KMW9')
       returning id`, [org])).rows[0].id
    await c.query(
      `insert into project_members (project_id, profile_id, project_role)
       values ($1,$2,'member')`, [project, cara])

    // One architect (sole holder of A), and TWO firms holding M — the case
    // pre-assignment must refuse to guess.
    const mk = async (name: string, code: string) => (await c.query(
      `insert into companies (project_id, name, originator_code, company_type)
       values ($1,$2,$3,'consultant') returning id`, [project, name, code])).rows[0].id
    const arch = await mk('Bellweather', 'BEL')
    const mep = await mk('Meridian', 'MER')
    const mepTwo = await mk('Northgate', 'NGT')
    await c.query(
      `insert into company_disciplines (company_id, discipline_code)
       values ($1,'A'), ($2,'M'), ($3,'M')`, [arch, mep, mepTwo])

    // The fixtures belong to this account, not to the published set. That is
    // what isolates them: every library reads "the account's fork, or the
    // published default if it has none", so an account with its own rows never
    // sees the shipped ones and the counts below mean what they say. Deleting
    // the shipped rows instead would reach across every other suite sharing
    // this database.
    await c.query(
      `insert into checklist_templates (organisation_id, type, reference, heading, title,
                                        prompt, discipline, sort_order)
       values ($1,'handover','HO-001','Statutory','Building regulations completion certificate',
               'From building control.','A',10),
              ($1,'handover','HO-002','Mechanical','Commissioning records',
               'All plant.','M',20),
              ($1,'handover','HO-003','General','O&M manuals',null,null,30)`, [org])

    const coreTemplate = (await c.query(
      `insert into scope_templates (organisation_id, name, discipline, is_core)
       values ($1,'Standard services',null,true) returning id`, [org])).rows[0].id
    const archTemplate = (await c.query(
      `insert into scope_templates (organisation_id, name, discipline, is_core)
       values ($1,'Architectural services','A',false) returning id`, [org])).rows[0].id
    await c.query(
      `insert into scope_template_items (template_id, reference, heading, description, riba_stage)
       values ($1,'STD-01','General','Attend design team meetings','3'),
              ($1,'STD-02','General','Produce a fee proposal','2'),
              ($2,'ARC-01','Production information','Produce the general arrangement drawings','4'),
              ($2,'ARC-02','Production information','Produce the door schedule','4')`,
      [coreTemplate, archTemplate])

    return { admin, cara, org, project, arch, mep, mepTwo, coreTemplate, archTemplate }
  })

  await asUser(w.admin, (c) => c.query('select import_programme($1,$2,$3)', [
    w.project, 'Rev 1', JSON.stringify([
      { task_uid: '1480', description: 'Commissioning and handover', start_date: '2027-11-15',
        finish_date: '2028-02-25', percent_complete: 0, level: 1, task_type: 'Task' },
    ])]))
})

describe('one table, one kind column', () => {
  test('every kind the engine answers to is declared once', async () => {
    const k = await asUser(w.admin, (c) => c.query('select unnest(tracked_kinds()) as k'))
    expect(k.rows.map((r) => r.k)).toEqual(expect.arrayContaining([
      'planning', 'bc', 'scope', 'breeam',
      'checklist:precon', 'checklist:client', 'checklist:handover',
      'checklist:highways', 'checklist:utilities',
    ]))
  })

  test('a kind nothing answers to is refused, not stored', async () => {
    expect(await denied(w.admin,
      `insert into tracked_items (project_id, kind, reference, title)
       values ($1,'checklist:invented','X-1','Something')`, [w.project]))
      .toMatch(/tracked_items_kind_is_known/)
  })

  test('there is one table, not five', async () => {
    const t = await asUser(w.admin, (c) =>
      c.query(`select table_name from information_schema.tables
               where table_schema = 'public'
                 and table_name in ('planning_conditions','building_control','scope_items',
                                    'breeam_credits','checklists')`))
    expect(t.rows).toEqual([])
  })
})

describe('loading a checklist copies the template', () => {
  test('it pre-assigns only where exactly one company holds the discipline', async () => {
    const out = (await asUser(w.admin, (c) =>
      c.query(`select load_checklist($1,'handover') as o`, [w.project]))).rows[0].o
    expect(out.added).toBe(3)

    const rows = await asUser(w.admin, (c) =>
      c.query(`select reference, company_id, holders from v_tracked_items
               where project_id = $1 and kind = 'checklist:handover' order by reference`,
        [w.project]))

    // A: one holder, so it is assigned. M: two holders, so it is left blank --
    // that is a decision, and a wrong default gets accepted silently where a
    // blank gets asked about. No discipline: nothing to assign from.
    expect(rows.rows[0]).toMatchObject({ reference: 'HO-001', company_id: w.arch, holders: 1 })
    expect(rows.rows[1]).toMatchObject({ reference: 'HO-002', company_id: null, holders: 2 })
    expect(rows.rows[2]).toMatchObject({ reference: 'HO-003', company_id: null })
  })

  test('loading twice adds what is new and disturbs nothing', async () => {
    await asUser(w.admin, (c) => c.query(
      `select set_response(
        (select id from tracked_items where project_id=$1 and reference='HO-003'),
        'Received from the contractor on 4 March.')`, [w.project]))

    const out = (await asUser(w.admin, (c) =>
      c.query(`select load_checklist($1,'handover') as o`, [w.project]))).rows[0].o
    expect(out.added).toBe(0)

    const r = await asUser(w.admin, (c) =>
      c.query(`select count(*)::int as n,
                      (select response from tracked_items
                       where project_id=$1 and reference='HO-003') as answer
               from tracked_items where project_id = $1 and kind = 'checklist:handover'`,
        [w.project]))
    expect(r.rows[0].n).toBe(3)
    expect(r.rows[0].answer).toBe('Received from the contractor on 4 March.')
  })

  test('editing the template afterwards leaves the loaded project untouched', async () => {
    // The thing that gets "improved" into a live link by someone being helpful.
    // No fork call: this account's templates are already its own.
    await asUser(w.admin, (c) => c.query(
      `update checklist_templates set title = 'Reworded in the template'
       where organisation_id = $1 and reference = 'HO-001'`, [w.org]))

    const r = await asUser(w.admin, (c) =>
      c.query(`select title from tracked_items where project_id=$1 and reference='HO-001'`,
        [w.project]))
    expect(r.rows[0].title).toBe('Building regulations completion certificate')
  })

  test('and the published template cannot be edited at all', async () => {
    // The published library is what every account that has not forked is
    // reading, so one tenant editing it would edit it for all of them. Not an
    // error: the row policy simply does not match, and nothing is updated.
    const r = await asUser(w.admin, (c) => c.query(
      `update checklist_templates set title = 'Tampered' where organisation_id is null`))
    expect(r.rowCount).toBe(0)
  })
})

describe('a struck-out row leaves the denominator but stays on the page', () => {
  test('required = false drops it from the total and keeps it visible', async () => {
    const before = (await asUser(w.admin, (c) =>
      c.query(`select total, struck_out from tracked_progress($1)
               where kind = 'checklist:handover'`, [w.project]))).rows[0]
    expect(before.total).toBe(3)
    expect(before.struck_out).toBe(0)

    await asUser(w.admin, (c) => c.query(
      `update tracked_items set required = false
       where project_id = $1 and reference = 'HO-002'`, [w.project]))

    const after = (await asUser(w.admin, (c) =>
      c.query(`select total, struck_out from tracked_progress($1)
               where kind = 'checklist:handover'`, [w.project]))).rows[0]
    // Out of the denominator...
    expect(after.total).toBe(2)
    expect(after.struck_out).toBe(1)

    // ...but still there. Deleting it would lose the decision that it was not
    // needed, which is precisely what somebody asks about later.
    const still = await asUser(w.admin, (c) =>
      c.query(`select required from v_tracked_items
               where project_id = $1 and reference = 'HO-002'`, [w.project]))
    expect(still.rows).toHaveLength(1)
    expect(still.rows[0].required).toBe(false)
  })

  test('a template row cannot be deleted, only struck out', async () => {
    await asUser(w.admin, (c) => c.query(
      `delete from tracked_items where project_id = $1 and reference = 'HO-002'`, [w.project]))
    const still = await asUser(w.admin, (c) =>
      c.query(`select count(*)::int as n from tracked_items
               where project_id = $1 and reference = 'HO-002'`, [w.project]))
    expect(still.rows[0].n).toBe(1)
  })

  test('a row added on the project may be deleted, because nothing was decided', async () => {
    await asUser(w.admin, (c) => c.query(
      `insert into tracked_items (project_id, kind, reference, title, custom, created_by)
       values ($1,'checklist:handover','HO-900','Typed by mistake',true,$2)`,
      [w.project, w.admin]))
    await asUser(w.admin, (c) => c.query(
      `delete from tracked_items where project_id = $1 and reference = 'HO-900'`, [w.project]))
    const gone = await asUser(w.admin, (c) =>
      c.query(`select count(*)::int as n from tracked_items
               where project_id = $1 and reference = 'HO-900'`, [w.project]))
    expect(gone.rows[0].n).toBe(0)
  })
})

describe('scope templates apply as a selection, per discipline', () => {
  test('no company is offered a discipline template it does not hold', async () => {
    // The bug that shipped once: a discipline-tagged row added to the one flat
    // template, with the apply flow not filtering, so a mechanical engineer
    // could receive architectural production-information duties.
    const forArch = await asUser(w.admin, (c) =>
      c.query('select name from suggested_scope_templates($1,$2) order by name',
        [w.project, w.arch]))
    const forMep = await asUser(w.admin, (c) =>
      c.query('select name from suggested_scope_templates($1,$2) order by name',
        [w.project, w.mep]))

    expect(forArch.rows.map((r) => r.name))
      .toEqual(['Architectural services', 'Standard services'])
    // The core standard, and nothing architectural.
    expect(forMep.rows.map((r) => r.name)).toEqual(['Standard services'])
  })

  test('applying stores the template name as it was, not a live join', async () => {
    await asUser(w.admin, (c) => c.query(
      'select apply_scope_templates($1,$2,$3)',
      [w.project, w.arch, [w.coreTemplate, w.archTemplate]]))

    const rows = await asUser(w.admin, (c) =>
      c.query(`select template_name, ext->>'template_reference' as ref
               from tracked_items where project_id=$1 and kind='scope' order by ref`,
        [w.project]))
    expect(rows.rows.map((r) => r.ref)).toEqual(['ARC-01', 'ARC-02', 'STD-01', 'STD-02'])

    // Rename the template; the applied rows keep what they were given. No fork
    // call: this account's templates are already its own, and forking here
    // would pull the shipped library in beside them.
    await asUser(w.admin, (c) => c.query(
      `update scope_templates set name = 'Renamed later'
       where organisation_id = $1 and is_core`, [w.org]))

    const after = await asUser(w.admin, (c) =>
      c.query(`select distinct template_name from tracked_items
               where project_id=$1 and kind='scope' order by 1`, [w.project]))
    expect(after.rows.map((r) => r.template_name))
      .toEqual(['Architectural services', 'Standard services'])
  })

  test('dedup is on company and template, not on reference alone', async () => {
    // Two templates are free to reuse the same numbering internally, and must
    // not collide because the numbers happen to.
    const before = await asUser(w.admin, (c) =>
      c.query(`select count(*)::int as n from tracked_items where project_id=$1 and kind='scope'`,
        [w.project]))

    // The same core template applied to a DIFFERENT company adds its rows again.
    await asUser(w.admin, (c) => c.query(
      'select apply_scope_templates($1,$2,$3)', [w.project, w.mep, [w.coreTemplate]]))
    const added = await asUser(w.admin, (c) =>
      c.query(`select count(*)::int as n from tracked_items where project_id=$1 and kind='scope'`,
        [w.project]))
    expect(added.rows[0].n).toBe(before.rows[0].n + 2)

    // Applying the same template to the same company again adds nothing.
    await asUser(w.admin, (c) => c.query(
      'select apply_scope_templates($1,$2,$3)', [w.project, w.mep, [w.coreTemplate]]))
    const again = await asUser(w.admin, (c) =>
      c.query(`select count(*)::int as n from tracked_items where project_id=$1 and kind='scope'`,
        [w.project]))
    expect(again.rows[0].n).toBe(added.rows[0].n)
  })
})

describe('a response is an answer, and its author is visible', () => {
  test('a machine suggestion is distinguishable from a person’s answer', async () => {
    const id = (await asUser(w.admin, (c) =>
      c.query(`select id from tracked_items where project_id=$1 and reference='HO-001'`,
        [w.project]))).rows[0].id

    await asUser(w.admin, (c) =>
      c.query(`select set_response($1,'Suggested from the tender pack.','suggested')`, [id]))
    const suggested = await asUser(w.admin, (c) =>
      c.query('select response_source, awaiting_acceptance from v_tracked_items where id=$1',
        [id]))
    expect(suggested.rows[0]).toEqual({
      response_source: 'suggested', awaiting_acceptance: true,
    })

    // A person accepting it is a deliberate act, recorded as theirs.
    await asUser(w.admin, (c) => c.query('select accept_response($1)', [id]))
    const accepted = await asUser(w.admin, (c) =>
      c.query('select response_source, response_by, awaiting_acceptance from v_tracked_items where id=$1',
        [id]))
    expect(accepted.rows[0]).toEqual({
      response_source: 'person', response_by: w.admin, awaiting_acceptance: false,
    })
  })

  test('the provenance cannot be forged by writing the column', async () => {
    const id = (await asUser(w.admin, (c) =>
      c.query(`select id from tracked_items where project_id=$1 and reference='HO-001'`,
        [w.project]))).rows[0].id
    expect(await denied(w.admin,
      `update tracked_items set response = 'Planted', response_source = 'person' where id = $1`,
      [id])).toMatch(/permission denied/)
  })

  test('a response with no author is refused by the constraint', async () => {
    expect(await denied(w.admin,
      `insert into tracked_items (project_id, kind, reference, title, response)
       values ($1,'planning','PC-900','Orphan answer','said so')`, [w.project]))
      .toMatch(/tracked_items_response_is_whole/)
  })
})

describe('the utilities asymmetry is typed, not free-form', () => {
  test('the sequence dates are accepted', async () => {
    await asUser(w.admin, (c) => c.query(
      `insert into tracked_items (project_id, kind, reference, title, ext, created_by)
       values ($1,'checklist:utilities','UT-001','Electricity connection',
               '{"supplier":"UKPN","date_enquiry":"2026-03-01","date_quote":"2026-05-14"}'::jsonb,
               $2)`, [w.project, w.admin]))
    const r = await asUser(w.admin, (c) =>
      c.query(`select ext->>'date_quote' as q from tracked_items
               where project_id=$1 and reference='UT-001'`, [w.project]))
    expect(r.rows[0].q).toBe('2026-05-14')
  })

  test('and anything else in ext is refused, so it does not become a junk drawer', async () => {
    expect(await denied(w.admin,
      `insert into tracked_items (project_id, kind, reference, title, ext, created_by)
       values ($1,'checklist:utilities','UT-002','Gas','{"whatever":"here"}'::jsonb,$2)`,
      [w.project, w.admin])).toMatch(/tracked_items_utilities_ext/)
  })
})

describe('the engine joins the rest of the product', () => {
  test('an item anchored to the programme moves with it, and reaches the inspector', async () => {
    const id = (await asUser(w.admin, (c) =>
      c.query(`select id from tracked_items where project_id=$1 and reference='HO-003'`,
        [w.project]))).rows[0].id
    await asUser(w.admin, (c) => c.query(
      `update tracked_items set programme_task_uid='1480', offset_days=-14 where id=$1`, [id]))

    const before = await asUser(w.admin, (c) =>
      c.query('select due from v_tracked_items where id=$1', [id]))
    expect(before.rows[0].due.toISOString().slice(0, 10)).toBe('2028-02-11')

    const deps = await asUser(w.admin, (c) =>
      c.query(`select module, ref from programme_dependents($1,'1480')`, [w.project]))
    expect(deps.rows.map((r) => r.ref)).toContain('HO-003')
  })

  test('a consultant sees the project’s items and can answer their own', async () => {
    const seen = await asUser(w.cara, (c) =>
      c.query(`select count(*)::int as n from v_tracked_items where project_id=$1`, [w.project]))
    expect(seen.rows[0].n).toBeGreaterThan(0)

    const id = (await asUser(w.cara, (c) =>
      c.query(`select id from tracked_items where project_id=$1 and reference='HO-003'`,
        [w.project]))).rows[0].id
    await asUser(w.cara, (c) =>
      c.query(`select set_response($1,'Uploaded to the CDE.')`, [id]))
    const r = await asUser(w.admin, (c) =>
      c.query('select response_by from tracked_items where id=$1', [id]))
    expect(r.rows[0].response_by).toBe(w.cara)
  })

  test('and cannot load a checklist or apply a scope template', async () => {
    expect(await denied(w.cara, `select load_checklist($1,'client')`, [w.project]))
      .toMatch(/contractor's team/)
    expect(await denied(w.cara, 'select apply_scope_templates($1,$2,$3)',
      [w.project, w.arch, [w.coreTemplate]])).toMatch(/contractor's team/)
  })
})
