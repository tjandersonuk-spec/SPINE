/**
 * Phase 5 — the drawing register, packs and transmittals.
 *
 * The assertions TASKS.md names: a pack reflects a retitled drawing; linking a
 * pack to a programme line changes no due date; revising a drawing after a
 * transmittal shows "revised since issue" on the pack. Plus the two rules the
 * handover notes single out — import and reconcile are separate, and only PDFs
 * reach the register — and the one that makes a transmittal evidence at all:
 * the revision issued cannot be rewritten.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import type { Client } from 'pg'
import { asSuperuser, asUser, makePerson, refused } from './db'

type World = {
  admin: string; consultant: string; org: string; project: string
}
let w: World

const denied = (who: string, sql: string, params: unknown[] = []) =>
  refused(() => asUser(who, (c) => c.query(sql, params)))

/** A CDE export: the PDF and, for one drawing, its DWG alongside. */
const cdeRows = (over: Record<string, string>[] = []) => [
  { document_number: 'KMW-BEL-BC-ZZ-DR-A-0400', title: 'GA plans', revision: 'C01',
    workflow_status: 'Published', file_format: 'pdf' },
  { document_number: 'KMW-BEL-BC-ZZ-DR-A-0400', title: 'GA plans', revision: 'C01',
    workflow_status: 'Published', file_format: 'dwg' },
  { document_number: 'KMW-CWC-BC-ZZ-DR-S-1100', title: 'Frame layout', revision: 'P02',
    workflow_status: 'Shared', file_format: 'pdf' },
  ...over,
]

beforeAll(async () => {
  w = await asSuperuser(async (c: Client) => {
    const admin = await makePerson(c, 'Ada Admin', 'p5-ada@hbc.example')
    const consultant = await makePerson(c, 'Cara Consultant', 'p5-cara@bel.example')
    const org = (await c.query(
      `insert into organisations (name, slug, status) values ('HBC5','hbc5','active')
       returning id`)).rows[0].id
    for (const [p, role] of [[admin, 'admin'], [consultant, 'consultant']] as const) {
      await c.query(
        'insert into organisation_members (organisation_id, profile_id, role) values ($1,$2,$3)',
        [org, p, role])
    }
    const project = (await c.query(
      `insert into projects (organisation_id, name, code) values ($1,'Kingsmead','KMW5')
       returning id`, [org])).rows[0].id
    await c.query(
      `insert into project_members (project_id, profile_id, project_role)
       values ($1,$2,'member')`, [project, consultant])
    // Two firms with originator codes, so the register can resolve them live.
    await c.query(
      `insert into companies (project_id, name, originator_code, company_type)
       values ($1,'Bellweather Architects','BEL','consultant'),
              ($1,'Corewell Consulting','CWC','consultant')`,
      [project])
    return { admin, consultant, org, project }
  })

  await asUser(w.admin, (c) => c.query('select seed_bep($1)', [w.project]))
  // A programme to anchor drawings to.
  await asUser(w.admin, (c) => c.query('select import_programme($1,$2,$3)', [
    w.project, 'Rev 1', JSON.stringify([
      { task_uid: '1121', description: 'Architectural package', start_date: '2026-06-01',
        finish_date: '2026-10-30', percent_complete: 50, level: 1, task_type: 'Task' },
      { task_uid: '1122', description: 'Structural package', start_date: '2026-06-01',
        finish_date: '2026-09-25', percent_complete: 70, level: 1, task_type: 'Task' },
    ])]))
})

describe('the BEP is what makes a number mean something', () => {
  test('the originator field has no stored values — it is the directory, live', async () => {
    const codes = await asUser(w.consultant, (c) =>
      c.query(`select c.code from bep_fields f, bep_field_codes(f.id) c
               where f.project_id = $1 and f.position = 2 order by 1`, [w.project]))
    expect(codes.rows.map((r) => r.code)).toEqual(['BEL', 'CWC'])

    // Add a firm; the permitted codes change with no edit to the BEP.
    await asUser(w.admin, (c) => c.query(
      `insert into companies (project_id, name, originator_code, company_type)
       values ($1,'Meridian Building Services','MBE','subcontractor')`, [w.project]))
    const after = await asUser(w.consultant, (c) =>
      c.query(`select c.code from bep_fields f, bep_field_codes(f.id) c
               where f.project_id = $1 and f.position = 2 order by 1`, [w.project]))
    expect(after.rows.map((r) => r.code)).toEqual(['BEL', 'CWC', 'MBE'])
  })

  test('construction status comes from the revision prefix, longest match first', async () => {
    const r = await asUser(w.consultant, (c) =>
      c.query(`select construction_status($1,'P01') as p, construction_status($1,'C02') as c,
                      construction_status($1,'CR01') as cr, construction_status($1,'Z9') as z`,
        [w.project]))
    expect(r.rows[0]).toEqual({
      p: 'Preliminary', c: 'Construction', cr: 'Construction (revised)', z: null,
    })
  })

  test('a name that breaks the convention says why', async () => {
    const r = await asUser(w.consultant, (c) =>
      c.query(`select naming_error($1,'KMW-BEL-BC-ZZ-DR-A-0400') as ok,
                      naming_error($1,'KMW-BEL-BC-ZZ-DR-A') as short,
                      naming_error($1,'KMW-XYZ-BC-ZZ-DR-A-0400') as unknown_originator,
                      naming_error($1,'KMW-BEL-BC-ZZ-QQ-A-0400') as bad_type`, [w.project]))
    expect(r.rows[0].ok).toBeNull()
    expect(r.rows[0].short).toMatch(/Expected 7 fields/)
    expect(r.rows[0].unknown_originator).toMatch(/Originator "XYZ"/)
    expect(r.rows[0].bad_type).toMatch(/Type "QQ"/)
  })

  test('a consultant reads the convention but cannot rewrite it', async () => {
    const seen = await asUser(w.consultant, (c) =>
      c.query('select count(*)::int as n from bep_fields where project_id = $1', [w.project]))
    expect(seen.rows[0].n).toBe(7)
    // RLS on UPDATE filters rows rather than raising, so the statement runs and
    // changes nothing. Asserting on the data is the only honest check.
    await asUser(w.consultant, (c) =>
      c.query('update bep_fields set max_len = 99 where project_id = $1', [w.project]))
    const after = await asUser(w.admin, (c) =>
      c.query('select count(*)::int as n from bep_fields where project_id=$1 and max_len=99',
        [w.project]))
    expect(after.rows[0].n).toBe(0)
  })
})

describe('import and reconcile are separate', () => {
  test('importing writes the raw rows and touches the register not at all', async () => {
    const out = (await asUser(w.admin, (c) =>
      c.query('select import_documents($1,$2,$3) as o',
        [w.project, 'CDE export — 14 August', JSON.stringify(cdeRows())]))).rows[0].o
    expect(out.ok).toBe(true)
    expect(out.row_count).toBe(3)

    const reg = await asUser(w.admin, (c) =>
      c.query('select count(*)::int as n from drawing_register where project_id = $1',
        [w.project]))
    expect(reg.rows[0].n).toBe(0)
  })

  test('the preview says what would change, and collapses DWG onto its PDF', async () => {
    const p = await asUser(w.admin, (c) =>
      c.query('select document_number, change from reconcile_preview($1) order by 1',
        [w.project]))
    // Three source rows, two register rows: the DWG is not a row of its own.
    expect(p.rows).toEqual([
      { document_number: 'KMW-BEL-BC-ZZ-DR-A-0400', change: 'new' },
      { document_number: 'KMW-CWC-BC-ZZ-DR-S-1100', change: 'new' },
    ])
  })

  test('only what a person accepts reaches the register', async () => {
    const out = (await asUser(w.admin, (c) =>
      c.query('select accept_into_register($1,$2) as o',
        [w.project, ['KMW-BEL-BC-ZZ-DR-A-0400']]))).rows[0].o
    expect(out.added).toBe(1)

    const reg = await asUser(w.admin, (c) =>
      c.query('select document_number from drawing_register where project_id = $1', [w.project]))
    expect(reg.rows.map((r) => r.document_number)).toEqual(['KMW-BEL-BC-ZZ-DR-A-0400'])
  })

  test('the DWG sets a flag on the PDF row rather than making a second row', async () => {
    const r = await asUser(w.consultant, (c) =>
      c.query(`select has_dwg, company_name, construction_status, naming_error
               from v_drawing_register where project_id = $1`, [w.project]))
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].has_dwg).toBe(true)
    expect(r.rows[0].company_name).toBe('Bellweather Architects')
    expect(r.rows[0].construction_status).toBe('Construction')
    expect(r.rows[0].naming_error).toBeNull()
  })

  test('nobody can mark a drawing delivered that the CDE has never seen', async () => {
    // revision is not in the update grant: it comes from reconciliation alone.
    expect(await denied(w.admin,
      `update drawing_register set revision = 'C99' where project_id = $1`, [w.project]))
      .toMatch(/permission denied/)
  })

  test('a consultant may not import or reconcile', async () => {
    expect(await denied(w.consultant, 'select import_documents($1,$2,$3)',
      [w.project, 'Sneaky', JSON.stringify(cdeRows())])).toMatch(/contractor's team/)
    expect(await denied(w.consultant, 'select accept_into_register($1,$2)',
      [w.project, ['KMW-CWC-BC-ZZ-DR-S-1100']])).toMatch(/contractor's team/)
  })
})

describe('planned and delivered are the same row', () => {
  test('a drawing can be expected before it exists, and is then overdue', async () => {
    await asUser(w.admin, (c) => c.query(
      `insert into drawing_register (project_id, document_number, title,
         programme_task_uid, offset_days, anchor)
       values ($1,'KMW-BEL-BC-GF-DR-A-0100','Ground floor plan','1121',-60,'finish')`,
      [w.project]))

    const r = await asUser(w.consultant, (c) =>
      c.query(`select awaited, overdue, due from v_drawing_register
               where project_id = $1 and document_number = $2`,
        [w.project, 'KMW-BEL-BC-GF-DR-A-0100']))
    expect(r.rows[0].awaited).toBe(true)
    // 1121 finishes 2026-10-30; sixty days before is 2026-08-31, already past.
    expect(r.rows[0].due.toISOString().slice(0, 10)).toBe('2026-08-31')
    expect(r.rows[0].overdue).toBe(true)
  })

  test('a delivered drawing is not overdue however late it was', async () => {
    const r = await asUser(w.consultant, (c) =>
      c.query(`select awaited, overdue from v_drawing_register
               where project_id = $1 and document_number = $2`,
        [w.project, 'KMW-BEL-BC-ZZ-DR-A-0400']))
    expect(r.rows[0].awaited).toBe(false)
    expect(r.rows[0].overdue).toBe(false)
  })

  test('slipping the programme moves the drawing, with no write to the register', async () => {
    const before = await asUser(w.consultant, (c) =>
      c.query(`select due from v_drawing_register where project_id = $1
               and document_number = 'KMW-BEL-BC-GF-DR-A-0100'`, [w.project]))
    expect(before.rows[0].due.toISOString().slice(0, 10)).toBe('2026-08-31')

    await asUser(w.admin, (c) => c.query('select import_programme($1,$2,$3)', [
      w.project, 'Rev 2', JSON.stringify([
        { task_uid: '1121', description: 'Architectural package', start_date: '2026-06-01',
          finish_date: '2026-12-11', percent_complete: 50, level: 1, task_type: 'Task' },
        { task_uid: '1122', description: 'Structural package', start_date: '2026-06-01',
          finish_date: '2026-09-25', percent_complete: 70, level: 1, task_type: 'Task' },
      ])]))

    const after = await asUser(w.consultant, (c) =>
      c.query(`select due, overdue from v_drawing_register where project_id = $1
               and document_number = 'KMW-BEL-BC-GF-DR-A-0100'`, [w.project]))
    expect(after.rows[0].due.toISOString().slice(0, 10)).toBe('2026-10-12')
    expect(after.rows[0].overdue).toBe(false)
  })
})

describe('a pack holds references, not copies', () => {
  let pack: string
  let drawingA: string

  beforeAll(async () => {
    pack = (await asUser(w.admin, (c) =>
      c.query(`select create_pack($1,'Stage 4 architectural','For construction issue') as id`,
        [w.project]))).rows[0].id
    const ids = await asUser(w.admin, (c) =>
      c.query(`select id, document_number from drawing_register where project_id = $1
               order by document_number`, [w.project]))
    drawingA = ids.rows[0].id
    await asUser(w.admin, (c) => c.query(
      `insert into drawing_pack_items (pack_id, drawing_id) select $1, id
       from drawing_register where project_id = $2`, [pack, w.project]))
  })

  test('retitling a drawing shows through the pack immediately', async () => {
    await asUser(w.admin, (c) => c.query(
      `update drawing_register set title = 'GA plans — revised layout' where id = $1`,
      [drawingA]))
    const r = await asUser(w.consultant, (c) =>
      c.query(`select r.title from drawing_pack_items i
               join v_drawing_register r on r.id = i.drawing_id
               where i.pack_id = $1 and r.id = $2`, [pack, drawingA]))
    expect(r.rows[0].title).toBe('GA plans — revised layout')
  })

  test('linking a pack to a programme line changes no due date', async () => {
    const before = await asUser(w.consultant, (c) =>
      c.query(`select document_number, due from v_drawing_register
               where project_id = $1 order by document_number`, [w.project]))

    // Link the pack to a line whose dates are nothing like the drawings'.
    await asUser(w.admin, (c) => c.query(
      `insert into drawing_pack_programme (pack_id, programme_task_uid) values ($1,'1122')`,
      [pack]))

    const after = await asUser(w.consultant, (c) =>
      c.query(`select document_number, due from v_drawing_register
               where project_id = $1 order by document_number`, [w.project]))
    expect(after.rows).toEqual(before.rows)
  })
})

describe('a transmittal is evidence', () => {
  let pack: string

  beforeAll(async () => {
    pack = (await asUser(w.admin, (c) =>
      c.query(`select id from drawing_packs where project_id = $1 limit 1`, [w.project])))
      .rows[0].id
  })

  test('issuing a pack expands to drawings and freezes the revision', async () => {
    const out = (await asUser(w.admin, (c) =>
      c.query(`select issue_transmittal($1,'Email','For construction',null,$2,null,null) as o`,
        [w.project, pack]))).rows[0].o
    expect(out.ok).toBe(true)
    expect(out.reference).toMatch(/^TX-\d{3}$/)
    // The pack holds two drawings but one has never been delivered, so only the
    // delivered one can be issued.
    expect(out.drawing_count).toBe(1)

    const items = await asUser(w.consultant, (c) =>
      c.query(`select revision_at_issue from transmittal_items where transmittal_id = $1`,
        [out.transmittal_id]))
    expect(items.rows[0].revision_at_issue).toBe('C01')
  })

  test('the transmittal stores drawings, never the pack', async () => {
    const cols = await asUser(w.admin, (c) =>
      c.query(`select column_name from information_schema.columns
               where table_schema='public' and table_name in ('transmittals','transmittal_items')`))
    expect(cols.rows.map((r) => r.column_name)).not.toContain('pack_id')
  })

  test('the revision issued cannot be rewritten, by anyone', async () => {
    expect(await denied(w.admin,
      `update transmittal_items set revision_at_issue = 'C99'`))
      .toMatch(/permission denied/)
  })

  test('transmittals are append-only: no update, no delete', async () => {
    expect(await denied(w.admin, `update transmittals set reason = 'changed my mind'`))
      .toMatch(/permission denied/)
    expect(await denied(w.admin, `delete from transmittals`)).toMatch(/permission denied/)
  })

  test('revising a drawing after issue shows as revised since issue on the pack', async () => {
    const before = await asUser(w.consultant, (c) =>
      c.query('select revised_since_issue from v_drawing_packs where id = $1', [pack]))
    expect(Number(before.rows[0].revised_since_issue)).toBe(0)

    // The CDE returns the drawing at a new revision, and it is accepted.
    await asUser(w.admin, (c) => c.query('select import_documents($1,$2,$3)', [
      w.project, 'CDE export — 2 September', JSON.stringify(cdeRows().map((r) =>
        r.document_number === 'KMW-BEL-BC-ZZ-DR-A-0400' ? { ...r, revision: 'C02' } : r))]))
    await asUser(w.admin, (c) => c.query('select accept_into_register($1,$2)',
      [w.project, ['KMW-BEL-BC-ZZ-DR-A-0400']]))

    const after = await asUser(w.consultant, (c) =>
      c.query('select revised_since_issue from v_drawing_packs where id = $1', [pack]))
    expect(Number(after.rows[0].revised_since_issue)).toBe(1)

    // And the frozen record did not follow it.
    const frozen = await asUser(w.consultant, (c) =>
      c.query('select distinct revision_at_issue from transmittal_items'))
    expect(frozen.rows.map((r) => r.revision_at_issue)).toEqual(['C01'])
  })

  test('a transmittal carrying nothing deliverable is refused', async () => {
    const empty = (await asUser(w.admin, (c) =>
      c.query(`select create_pack($1,'Empty pack',null) as id`, [w.project]))).rows[0].id
    expect(await denied(w.admin,
      `select issue_transmittal($1,'Email',null,null,$2,null,null)`, [w.project, empty]))
      .toMatch(/at least one drawing/)
  })

  test('references are generated, never typed, and do not repeat', async () => {
    const drawing = (await asUser(w.admin, (c) => c.query(
      `select id from drawing_register where project_id = $1 and revision is not null limit 1`,
      [w.project]))).rows[0].id

    const out = (await asUser(w.admin, (c) =>
      c.query(`select issue_transmittal($1,'Email',null,null,null,$2,null) as o`,
        [w.project, [drawing]]))).rows[0].o
    expect(out.reference).toBe('TX-002')

    const all = await asUser(w.consultant, (c) =>
      c.query('select reference from transmittals where project_id = $1 order by reference',
        [w.project]))
    expect(all.rows.map((r) => r.reference)).toEqual(['TX-001', 'TX-002'])
  })
})

describe('who a transmittal went to', () => {
  test('named recipients are recorded with their distribution', async () => {
    const co = (await asUser(w.admin, (c) =>
      c.query(`select id from companies where project_id=$1 and originator_code='BEL'`,
        [w.project]))).rows[0].id
    const person = (await asSuperuser(async (c: Client) => (await c.query(
      `insert into project_people (project_id, company_id, name, job_role, email)
       values ($1,$2,'Priya Nair','Project architect','priya@bel.example') returning id`,
      [w.project, co])).rows[0].id))

    const drawing = (await asUser(w.admin, (c) => c.query(
      `select id from drawing_register where project_id=$1 and revision is not null limit 1`,
      [w.project]))).rows[0].id

    const out = (await asUser(w.admin, (c) =>
      c.query(`select issue_transmittal($1,'Email','For construction',null,null,$2,$3) as o`, [
        w.project, [drawing],
        JSON.stringify([{ company_id: co, person_id: person, distribution: 'action' }]),
      ]))).rows[0].o
    expect(out.ok).toBe(true)

    const r = await asUser(w.consultant, (c) =>
      c.query(`select company_id, person_id, distribution from transmittal_recipients
               where transmittal_id = $1`, [out.transmittal_id]))
    expect(r.rows).toEqual([{ company_id: co, person_id: person, distribution: 'action' }])
  })

  test('an empty distribution is the whole project, not a missing one', async () => {
    const drawing = (await asUser(w.admin, (c) => c.query(
      `select id from drawing_register where project_id=$1 and revision is not null limit 1`,
      [w.project]))).rows[0].id
    const out = (await asUser(w.admin, (c) =>
      c.query(`select issue_transmittal($1,'CDE',null,null,null,$2,null) as o`,
        [w.project, [drawing]]))).rows[0].o

    const r = await asUser(w.consultant, (c) =>
      c.query('select count(*)::int as n from transmittal_recipients where transmittal_id = $1',
        [out.transmittal_id]))
    expect(r.rows[0].n).toBe(0)

    // And a consultant on the project can still see it — that is what an empty
    // distribution means.
    const seen = await asUser(w.consultant, (c) =>
      c.query('select reference from transmittals where id = $1', [out.transmittal_id]))
    expect(seen.rows).toHaveLength(1)
  })

  test('a recipient is always a named person, never a firm in the abstract', async () => {
    // person_id sits in the primary key, so Postgres makes it NOT NULL whatever
    // the column declaration says. That is the right behaviour -- a drawing is
    // distributed to someone -- but it is worth pinning, because a caller
    // passing a company alone gets a constraint error rather than a silent
    // company-wide row.
    const co = (await asUser(w.admin, (c) =>
      c.query(`select id from companies where project_id=$1 limit 1`, [w.project]))).rows[0].id
    const nullable = await asUser(w.admin, (c) =>
      c.query(`select is_nullable from information_schema.columns
               where table_name='transmittal_recipients' and column_name='person_id'`))
    expect(nullable.rows[0].is_nullable).toBe('NO')

    const drawing = (await asUser(w.admin, (c) => c.query(
      `select id from drawing_register where project_id=$1 and revision is not null limit 1`,
      [w.project]))).rows[0].id
    expect(await denied(w.admin,
      `select issue_transmittal($1,'Email',null,null,null,$2,$3)`, [
        w.project, [drawing],
        JSON.stringify([{ company_id: co, person_id: null, distribution: 'information' }]),
      ])).toMatch(/null value|not-null/)
  })
})
