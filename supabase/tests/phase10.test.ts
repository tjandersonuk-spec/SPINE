/**
 * Phase 10 — the Building Safety Act regime.
 *
 * The assertions TASKS.md names: a synthetic classification event from a
 * non-PDB user is refused; the work-status function returns the correct state
 * for every case; the objection window follows the host setting.
 *
 * The classification test drives the function directly rather than through a
 * screen, on purpose. Hiding a control is not a permission, and the thing that
 * has to be true is that the database refuses it.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import type { Client } from 'pg'
import { asSuperuser, asUser, makePerson, refused } from './db'

type World = {
  admin: string; pdb: string; internal: string; other: string
  org: string; project: string; ordinary: string
  pdbCompany: string; otherCompany: string
}
let w: World

const denied = (who: string, sql: string, params: unknown[] = []) =>
  refused(() => asUser(who, (c) => c.query(sql, params)))

/** A change request in whatever BSA state the test needs. */
async function change(patch: Record<string, unknown> = {}, project?: string) {
  const p = project ?? w.project
  const ref = 'CHG-' + Math.random().toString(36).slice(2, 8)
  return asSuperuser(async (c: Client) => {
    const id = (await c.query(
      `insert into change_requests (project_id, reference, title, raised_by)
       values ($1,$2,'A change',$3) returning id`, [p, ref, w.admin])).rows[0].id
    // A classification is a person, a moment and a reason together, and the
    // constraint enforces it -- so a fixture setting the class supplies all
    // four, exactly as classify_change() does.
    if (patch.bsa_class && !patch.bsa_class_by) {
      patch = { ...patch, bsa_class_by: w.admin, bsa_class_at: new Date().toISOString(),
                bsa_class_note: 'Set by the fixture.' }
    }
    const keys = Object.keys(patch)
    if (keys.length) {
      await c.query(
        `update change_requests set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}
         where id = $1`, [id, ...keys.map((k) => patch[k])])
    }
    return id as string
  })
}

const status = async (id: string) =>
  (await asUser(w.admin, (c) => c.query('select * from work_status($1)', [id]))).rows[0]

beforeAll(async () => {
  w = await asSuperuser(async (c: Client) => {
    const admin = await makePerson(c, 'Ada Admin', 'p10-ada@hbc.example')
    const pdb = await makePerson(c, 'Pia Designer', 'p10-pia@pdb.example')
    const internal = await makePerson(c, 'Ian Internal', 'p10-ian@hbc.example')
    const other = await makePerson(c, 'Cara Consultant', 'p10-cara@bel.example')

    const org = (await c.query(
      `insert into organisations (name, slug, status) values ('HBC10','hbc10','active')
       returning id`)).rows[0].id
    for (const [p, role] of [
      [admin, 'admin'], [pdb, 'consultant'], [internal, 'internal'], [other, 'consultant'],
    ] as const) {
      await c.query(
        'insert into organisation_members (organisation_id, profile_id, role) values ($1,$2,$3)',
        [org, p, role])
    }

    // An HRB project, and an ordinary one that must never see any of this.
    const project = (await c.query(
      `insert into projects (organisation_id, name, code, hrb, hrb_notify_days, hrb_major_weeks)
       values ($1,'Kingsmead Tower','KMT',true,14,6) returning id`, [org])).rows[0].id
    const ordinary = (await c.query(
      `insert into projects (organisation_id, name, code) values ($1,'Low Rise','LOW')
       returning id`, [org])).rows[0].id

    for (const p of [pdb, internal, other]) {
      for (const proj of [project, ordinary]) {
        await c.query(
          `insert into project_members (project_id, profile_id, project_role)
           values ($1,$2,'member')`, [proj, p])
      }
    }

    const catPdb = (await c.query(
      `insert into catalogue_companies (organisation_id, name, company_type)
       values ($1,'Safewright','consultant') returning id`, [org])).rows[0].id
    const catOther = (await c.query(
      `insert into catalogue_companies (organisation_id, name, company_type)
       values ($1,'Bellweather','consultant') returning id`, [org])).rows[0].id

    const pdbCompany = (await c.query(
      `insert into companies (project_id, name, originator_code, company_type,
                              catalogue_company_id)
       values ($1,'Safewright','SFW','consultant',$2) returning id`,
      [project, catPdb])).rows[0].id
    const otherCompany = (await c.query(
      `insert into companies (project_id, name, originator_code, company_type,
                              catalogue_company_id)
       values ($1,'Bellweather','BEL','consultant',$2) returning id`,
      [project, catOther])).rows[0].id

    // Safewright holds the statutory duty; Bellweather does not.
    await c.query(
      `insert into company_disciplines (company_id, discipline_code)
       values ($1,'PDB'), ($2,'A')`, [pdbCompany, otherCompany])
    await c.query(
      `update organisation_members set company_id = $1
       where organisation_id = $2 and profile_id = $3`, [catPdb, org, pdb])
    await c.query(
      `update organisation_members set company_id = $1
       where organisation_id = $2 and profile_id = $3`, [catOther, org, other])

    return { admin, pdb, internal, other, org, project, ordinary, pdbCompany, otherCompany }
  })
})

describe('the regime is inert unless the project is a higher-risk building', () => {
  test('an ordinary project reports proceed and nothing else', async () => {
    const id = await change({}, w.ordinary)
    expect(await status(id)).toEqual({
      state: 'not_hrb', verdict: 'proceed',
      detail: 'This project is not a higher-risk building.',
    })
  })

  test('and a change on it cannot be classified at all', async () => {
    const id = await change({}, w.ordinary)
    expect(await denied(w.admin, `select classify_change($1,'Major','Because')`, [id]))
      .toMatch(/not a higher-risk building/)
  })
})

describe('only the duty-holder may classify', () => {
  test('the Principal Designer (BSA) may', async () => {
    const id = await change()
    await asUser(w.pdb, (c) => c.query(
      `select classify_change($1,'Notifiable','Agreed with the client and the PC on 3 March.')`,
      [id]))
    const r = await asUser(w.admin, (c) =>
      c.query('select bsa_class, bsa_class_by, bsa_class_note from change_requests where id=$1',
        [id]))
    expect(r.rows[0]).toEqual({
      bsa_class: 'Notifiable',
      bsa_class_by: w.pdb,
      bsa_class_note: 'Agreed with the client and the PC on 3 March.',
    })
  })

  test('an account admin may, because somebody must be able to', async () => {
    const id = await change()
    await asUser(w.admin, (c) =>
      c.query(`select classify_change($1,'Recordable','Minor, recorded.')`, [id]))
    const r = await asUser(w.admin, (c) =>
      c.query('select bsa_class from change_requests where id=$1', [id]))
    expect(r.rows[0].bsa_class).toBe('Recordable')
  })

  test('the contractor’s internal staff may NOT — it is a duty, not a seniority', async () => {
    // The assertion TASKS.md names, driven at the function rather than at a
    // screen: hiding a control is not a permission.
    const id = await change()
    expect(await denied(w.internal, `select classify_change($1,'Major','I am senior.')`, [id]))
      .toMatch(/Principal Designer/)
  })

  test('nor may a consultant who does not hold the discipline', async () => {
    const id = await change()
    expect(await denied(w.other, `select classify_change($1,'Recordable','Looks minor.')`, [id]))
      .toMatch(/Principal Designer/)
  })

  test('and nobody may write the columns directly', async () => {
    // The guard is only a guard if the column is unreachable around it.
    const id = await change()
    for (const who of [w.internal, w.other, w.admin, w.pdb]) {
      expect(await denied(who,
        `update change_requests set bsa_class = 'Recordable', bsa_controlled = true
         where id = $1`, [id])).toMatch(/permission denied/)
    }
  })

  test('a classification with no written basis is refused', async () => {
    const id = await change()
    expect(await denied(w.pdb, `select classify_change($1,'Major','   ')`, [id]))
      .toMatch(/written basis/)
  })

  test('the app never suggests a category — an unclassified change stays unclassified', async () => {
    const id = await change({ bsa_controlled: true })
    const r = await asUser(w.admin, (c) =>
      c.query('select bsa_class from change_requests where id=$1', [id]))
    expect(r.rows[0].bsa_class).toBeNull()
    expect((await status(id)).state).toBe('unclassified')
  })
})

describe('may work proceed — every state', () => {
  const cases: [string, Record<string, unknown>, string, string][] = [
    ['not controlled', {}, 'not_controlled', 'proceed'],
    ['controlled but unclassified',
      { bsa_controlled: true }, 'unclassified', 'stop'],
    ['recordable',
      { bsa_controlled: true, bsa_class: 'Recordable' }, 'recordable', 'proceed'],
    ['objected, whatever else is true',
      { bsa_controlled: true, bsa_class: 'Notifiable', bsa_notified_at: '2026-01-01',
        bsa_objected: true }, 'objected', 'stop'],
    ['notifiable and not notified',
      { bsa_controlled: true, bsa_class: 'Notifiable' }, 'notifiable_unnotified', 'stop'],
    ['notified, inside the window',
      { bsa_controlled: true, bsa_class: 'Notifiable', bsa_notified_at: 'today' },
      'notifiable_in_window', 'warn'],
    ['notified, window closed',
      { bsa_controlled: true, bsa_class: 'Notifiable', bsa_notified_at: '2026-01-01' },
      'notifiable_clear', 'proceed'],
    ['major, nothing submitted',
      { bsa_controlled: true, bsa_class: 'Major' }, 'major_unsubmitted', 'stop'],
    ['major, awaiting determination',
      { bsa_controlled: true, bsa_class: 'Major', bsa_app_submitted: '2026-06-01' },
      'major_awaiting', 'stop'],
    ['major, refused',
      { bsa_controlled: true, bsa_class: 'Major', bsa_app_submitted: '2026-06-01',
        bsa_app_decided: '2026-07-01', bsa_app_outcome: 'Rejected' },
      'major_rejected', 'stop'],
    ['major, approved',
      { bsa_controlled: true, bsa_class: 'Major', bsa_app_submitted: '2026-06-01',
        bsa_app_decided: '2026-07-01', bsa_app_outcome: 'Approved' },
      'major_approved', 'proceed'],
    ['major, decided with no outcome recorded',
      { bsa_controlled: true, bsa_class: 'Major', bsa_app_submitted: '2026-06-01',
        bsa_app_decided: '2026-07-01' },
      'major_undetermined', 'stop'],
  ]

  for (const [name, patch, state, verdict] of cases) {
    test(name, async () => {
      const p = { ...patch }
      if (p.bsa_notified_at === 'today') p.bsa_notified_at = new Date().toISOString().slice(0, 10)
      const id = await change(p)
      const r = await status(id)
      expect(r.state, name).toBe(state)
      expect(r.verdict, name).toBe(verdict)
    })
  }

  test('every state the function can return is covered above', async () => {
    // A state nobody tested is a state nobody has thought about.
    const src = (await asUser(w.admin, (c) =>
      c.query(`select prosrc from pg_proc where proname = 'work_status'`))).rows[0].prosrc
    // Only the state CTE, not the verdict lookup below it — otherwise
    // 'proceed' and 'warn' read as states.
    const body = String(src)
    const stateBlock = body.slice(body.indexOf('as state'))
    const states = new Set(
      [...body.slice(0, body.indexOf('end as state')).matchAll(/then '([a-z_]+)'/g)]
        .map((m) => m[1]))
    states.add('major_undetermined')   // the else branch
    states.add('not_hrb')              // covered by its own describe
    void stateBlock
    const tested = new Set([...cases.map((c) => c[2]), 'not_hrb'])
    expect([...states].filter((s) => !tested.has(s))).toEqual([])
  })
})

describe('the periods are the host’s, not constants', () => {
  test('widening the objection window changes the answer', async () => {
    const notified = new Date()
    notified.setDate(notified.getDate() - 20)
    const id = await change({
      bsa_controlled: true, bsa_class: 'Notifiable',
      bsa_notified_at: notified.toISOString().slice(0, 10),
    })

    // 14 days: the window has closed.
    expect((await status(id)).state).toBe('notifiable_clear')

    // The published figures disagree — ten working days and fourteen days are
    // both quoted — so this is a setting. At 28 days the same change is still
    // inside its window.
    await asUser(w.admin, (c) =>
      c.query('update projects set hrb_notify_days = 28 where id = $1', [w.project]))
    expect((await status(id)).state).toBe('notifiable_in_window')

    await asUser(w.admin, (c) =>
      c.query('update projects set hrb_notify_days = 14 where id = $1', [w.project]))
  })

  test('and the determination period reaches the wording', async () => {
    const id = await change({
      bsa_controlled: true, bsa_class: 'Major', bsa_app_submitted: '2026-06-01',
    })
    expect((await status(id)).detail).toContain('2026-07-13')  // six weeks on
  })
})

describe('the regulator outranks the commercial state', () => {
  test('an approved change awaiting determination reads as work must stop', async () => {
    const id = await change({
      status: 'Approved', bsa_controlled: true, bsa_class: 'Major',
      bsa_app_submitted: '2026-06-01',
    })
    const r = await asUser(w.admin, (c) =>
      c.query('select status, headline_status, bsa_verdict from v_change_requests where id=$1',
        [id]))
    expect(r.rows[0].status).toBe('Approved')
    expect(r.rows[0].headline_status).toBe('Work must stop')
    expect(r.rows[0].bsa_verdict).toBe('stop')
  })

  test('an approval that named nothing to amend is flagged', async () => {
    const id = await change({ status: 'Approved' })
    const r = await asUser(w.admin, (c) =>
      c.query('select approved_with_nothing_listed from v_change_requests where id=$1', [id]))
    expect(r.rows[0].approved_with_nothing_listed).toBe(true)

    await asUser(w.admin, (c) => c.query(
      `insert into change_request_items (change_request_id, entity_type, description)
       values ($1,'drawing','Reissue the GA at C02')`, [id]))
    const after = await asUser(w.admin, (c) =>
      c.query(`select approved_with_nothing_listed, amendments, amendments_outstanding
               from v_change_requests where id=$1`, [id]))
    expect(after.rows[0]).toEqual({
      approved_with_nothing_listed: false, amendments: 1, amendments_outstanding: 1,
    })
  })
})

describe('the golden thread is a designation plus a baseline', () => {
  let moved: string
  let never: string

  beforeAll(async () => {
    await asUser(w.admin, (c) => c.query('select import_programme($1,$2,$3)', [
      w.project, 'Rev 1', JSON.stringify([
        { task_uid: '1121', description: 'Architectural package', start_date: '2026-06-01',
          finish_date: '2026-10-30', percent_complete: 50, level: 1, task_type: 'Task' },
      ])]))
    moved = (await asUser(w.admin, (c) => c.query(
      `insert into drawing_register (project_id, document_number, title, revision, golden_thread)
       values ($1,'KMT-SFW-BC-ZZ-DR-A-0400','Fire strategy','C01',true) returning id`,
      [w.project]))).rows[0].id
    never = (await asUser(w.admin, (c) => c.query(
      `insert into drawing_register (project_id, document_number, title, golden_thread,
         programme_task_uid, offset_days)
       values ($1,'KMT-SFW-BC-ZZ-DR-A-0401','Compartmentation plan',true,'1121',-30)
       returning id`, [w.project]))).rows[0].id
    // A designated drawing that has not moved, and an undesignated one that has.
    await asUser(w.admin, (c) => c.query(
      `insert into drawing_register (project_id, document_number, title, revision, golden_thread)
       values ($1,'KMT-SFW-BC-ZZ-DR-A-0402','Stair detail','C01',true),
              ($1,'KMT-BEL-BC-ZZ-DR-A-9000','Landscaping','C01',false)`, [w.project]))
  })

  test('the baseline is stamped once, at Gateway 2', async () => {
    const out = (await asUser(w.admin, (c) =>
      c.query('select stamp_g2_baseline($1) as o', [w.project]))).rows[0].o
    // Two designated drawings have a revision to baseline; the never-issued one
    // has nothing to stamp.
    expect(out.baselined).toBe(2)
  })

  test('and never moves afterwards', async () => {
    await asSuperuser((c: Client) =>
      c.query(`update drawing_register set revision = 'C02' where id = $1`, [moved]))
    const again = (await asUser(w.admin, (c) =>
      c.query('select stamp_g2_baseline($1) as o', [w.project]))).rows[0].o
    expect(again.baselined).toBe(0)

    const r = await asUser(w.admin, (c) =>
      c.query('select g2_revision, revision from drawing_register where id=$1', [moved]))
    expect(r.rows[0]).toEqual({ g2_revision: 'C01', revision: 'C02' })
  })

  test('the first report is what has moved since', async () => {
    const r = await asUser(w.admin, (c) =>
      c.query('select document_number, g2_revision, revision_now from golden_thread_moved($1)',
        [w.project]))
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({
      document_number: 'KMT-SFW-BC-ZZ-DR-A-0400', g2_revision: 'C01', revision_now: 'C02',
    })
  })

  test('the second is what was designated and never issued at all', async () => {
    // The quieter of the two, and usually the more serious: a drawing nobody
    // produced does not appear on a list of things that changed.
    const r = await asUser(w.admin, (c) =>
      c.query('select document_number, due from golden_thread_never_issued($1)', [w.project]))
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].document_number).toBe('KMT-SFW-BC-ZZ-DR-A-0401')
    expect(r.rows[0].due.toISOString().slice(0, 10)).toBe('2026-09-30')
    void never
  })

  test('the baseline cannot be written by hand', async () => {
    expect(await denied(w.admin,
      `update drawing_register set g2_revision = 'C99' where id = $1`, [moved]))
      .toMatch(/permission denied/)
  })
})

describe('occurrences are their own record', () => {
  test('they are not risks, and not merged into anything', async () => {
    const t = await asUser(w.admin, (c) =>
      c.query(`select column_name from information_schema.columns
               where table_schema='public' and table_name='occurrences'
                 and column_name in ('likelihood','impact','risk_score')`))
    expect(t.rows).toEqual([])
  })

  test('an assessment either way must state its reasoning', async () => {
    expect(await denied(w.admin,
      `insert into occurrences (project_id, reference, title, status)
       values ($1,'MOR-001','Temporary propping removed early','Not reportable')`, [w.project]))
      .toMatch(/occurrence_assessment_is_reasoned/)

    // Including "not reportable" — that is the record somebody asks for later.
    await asUser(w.admin, (c) => c.query(
      `insert into occurrences (project_id, reference, title, status, assessment, raised_by)
       values ($1,'MOR-001','Temporary propping removed early','Not reportable',
               'No structural risk to occupants; below the reporting threshold.',$2)`,
      [w.project, w.admin]))
    const r = await asUser(w.admin, (c) =>
      c.query('select status, assessment from occurrences where project_id=$1', [w.project]))
    expect(r.rows[0].status).toBe('Not reportable')
  })

  test('they default to the contractor’s own staff', async () => {
    const seen = await asUser(w.other, (c) =>
      c.query('select count(*)::int as n from occurrences where project_id=$1', [w.project]))
    expect(seen.rows[0].n).toBe(0)

    const admin = await asUser(w.admin, (c) =>
      c.query('select count(*)::int as n from occurrences where project_id=$1', [w.project]))
    expect(admin.rows[0].n).toBe(1)
  })
})
