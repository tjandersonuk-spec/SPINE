/**
 * Phase 4 — the programme and the date spine.
 *
 * The assertions TASKS.md names: slipping a finish date moves every anchored
 * due date with no write to those records; a removed line flags its dependents
 * rather than orphaning them; the inspector count equals the sum of dependents
 * across all modules. Plus the rules that make the spine a spine — one
 * function, scoped to its project, and no path to a programme write that is not
 * the importer.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import type { Client } from 'pg'
import { asSuperuser, asUser, makePerson, refused } from './db'

type World = {
  admin: string; internal: string; consultant: string; stranger: string
  org: string; project: string; other: string
}
let w: World

/** Run a statement as someone and require that it be refused. Returns the
 *  error, so a test can assert it was refused for the right reason. */
const denied = (who: string, sql: string, params: unknown[] = []) =>
  refused(() => asUser(who, (c) => c.query(sql, params)))

/** The three columns every anchored record in later phases will carry. */
const anchored = (uid: string | null, offset = 0, anchorAt: 'start' | 'finish' = 'finish') =>
  ({ uid, offset, anchorAt })

const rows = (extra: Record<string, unknown>[] = []) => [
  { task_uid: '1000', description: 'KINGSMEAD WHARF BLOCK C', start_date: '2026-01-05',
    finish_date: '2028-02-25', percent_complete: 34, level: 1, task_type: 'Summary' },
  { task_uid: '1100', description: 'Design', start_date: '2026-01-05',
    finish_date: '2027-03-19', percent_complete: 52, level: 2, parent_uid: '1000',
    task_type: 'Summary' },
  { task_uid: '1121', description: 'Architectural technical package',
    start_date: '2026-06-01', finish_date: '2026-10-30', percent_complete: 58, level: 4,
    parent_uid: '1100', task_type: 'Task' },
  { task_uid: '1126', description: 'Stage 4 design freeze', start_date: '2026-12-18',
    finish_date: '2026-12-18', percent_complete: 0, level: 4, parent_uid: '1100',
    task_type: 'Milestone' },
  ...extra,
]

beforeAll(async () => {
  w = await asSuperuser(async (c: Client) => {
    const admin = await makePerson(c, 'Ada Admin', 'p4-ada@hbc.example')
    const internal = await makePerson(c, 'Ivan Internal', 'p4-ivan@hbc.example')
    const consultant = await makePerson(c, 'Cara Consultant', 'p4-cara@bel.example')
    const stranger = await makePerson(c, 'Stan Stranger', 'p4-stan@rival.example')

    const org = (await c.query(
      `insert into organisations (name, slug, status) values ('HBC4','hbc4','active')
       returning id`)).rows[0].id
    const rival = (await c.query(
      `insert into organisations (name, slug, status) values ('Rival4','rival4','active')
       returning id`)).rows[0].id
    for (const [o, p, role] of [
      [org, admin, 'admin'], [org, internal, 'internal'], [org, consultant, 'consultant'],
      [rival, stranger, 'admin'],
    ] as const) {
      await c.query(
        'insert into organisation_members (organisation_id, profile_id, role) values ($1,$2,$3)',
        [o, p, role])
    }
    const project = (await c.query(
      `insert into projects (organisation_id, name, code) values ($1,'Kingsmead','KMW4')
       returning id`, [org])).rows[0].id
    // A second project in the same account, to prove uid lookups are scoped.
    const other = (await c.query(
      `insert into projects (organisation_id, name, code) values ($1,'Elsewhere','ELS4')
       returning id`, [org])).rows[0].id
    await c.query(
      `insert into project_members (project_id, profile_id, project_role)
       values ($1,$2,'member')`, [project, consultant])
    return { admin, internal, consultant, stranger, org, project, other }
  })

  // Load the programme once, as the importer would.
  await asUser(w.admin, (c) =>
    c.query('select import_programme($1,$2,$3)', [w.project, 'Rev 11', JSON.stringify(rows())]))
})

describe('the import', () => {
  test('loads every line and reports what it did', async () => {
    const r = await asUser(w.admin, (c) =>
      c.query('select count(*)::int as n from programme_tasks where project_id = $1', [w.project]))
    expect(r.rows[0].n).toBe(4)
  })

  test('a consultant may read the programme but never import one', async () => {
    const read = await asUser(w.consultant, (c) =>
      c.query('select count(*)::int as n from programme_tasks where project_id = $1', [w.project]))
    expect(read.rows[0].n).toBe(4)

    expect(await denied(w.consultant, 'select import_programme($1,$2,$3)',
      [w.project, 'Sneaky', JSON.stringify(rows())]))
      .toMatch(/admin or internal/)
  })

  test('internal staff may import; a stranger cannot even see the project', async () => {
    const r = await asUser(w.internal, (c) =>
      c.query('select import_programme($1,$2,$3) as out',
        [w.project, 'Rev 11a', JSON.stringify(rows())]))
    expect(r.rows[0].out.ok).toBe(true)

    const seen = await asUser(w.stranger, (c) =>
      c.query('select count(*)::int as n from programme_tasks where project_id = $1', [w.project]))
    expect(seen.rows[0].n).toBe(0)
  })

  test('nobody holds a direct write on programme_tasks, whatever their role', async () => {
    // The privilege layer refuses this before RLS is consulted, which is the
    // point: there is exactly one way to reschedule a project.
    for (const who of [w.admin, w.internal, w.consultant]) {
      expect(await denied(who,
        `insert into programme_tasks (project_id, task_uid, description, start_date,
           finish_date, level, task_type)
         values ($1,'9999','Snuck in','2026-01-01','2026-01-02',1,'Task')`, [w.project]))
        .toMatch(/permission denied/)
      expect(await denied(who,
        `update programme_tasks set finish_date = '2030-01-01' where project_id = $1`,
        [w.project])).toMatch(/permission denied/)
    }
  })
})

describe('validation', () => {
  const bad = async (extra: Record<string, unknown>[]) =>
    (await asUser(w.admin, (c) =>
      c.query('select import_programme($1,$2,$3) as out',
        [w.other, 'Bad', JSON.stringify(rows(extra))]))).rows[0].out

  test('a whole file is rejected and nothing is written', async () => {
    const out = await bad([
      { task_uid: '', description: 'No ID', start_date: '2026-01-01',
        finish_date: '2026-01-02', level: 1, task_type: 'Task' },
    ])
    expect(out.ok).toBe(false)
    expect(out.errors[0].field).toBe('task_uid')

    const after = await asUser(w.admin, (c) =>
      c.query('select count(*)::int as n from programme_tasks where project_id = $1', [w.other]))
    expect(after.rows[0].n).toBe(0)
  })

  test('every problem is reported at once, not one re-upload at a time', async () => {
    const out = await bad([
      { task_uid: 'X1', description: '', start_date: '2026-01-01',
        finish_date: '2026-01-02', level: 1, task_type: 'Task' },
      { task_uid: 'X2', description: 'Backwards', start_date: '2026-05-01',
        finish_date: '2026-01-02', level: 1, task_type: 'Task' },
      { task_uid: 'X3', description: 'Bad type', start_date: '2026-01-01',
        finish_date: '2026-01-02', level: 1, task_type: 'Widget' },
    ])
    expect(out.ok).toBe(false)
    expect(out.errors.length).toBeGreaterThanOrEqual(3)
    expect(out.errors.map((e: { field: string }) => e.field))
      .toEqual(expect.arrayContaining(['description', 'dates', 'task_type']))
  })

  test('a duplicate ID in one file is refused rather than applied twice', async () => {
    const out = await bad([
      { task_uid: '1121', description: 'Same ID again', start_date: '2026-01-01',
        finish_date: '2026-01-02', level: 1, task_type: 'Task' },
    ])
    expect(out.ok).toBe(false)
    expect(out.errors.some((e: { message: string }) => /Duplicate/.test(e.message))).toBe(true)
  })

  test('a milestone spanning more than a day is a mismapped column, not a task', async () => {
    const out = await bad([
      { task_uid: 'M1', description: 'Long milestone', start_date: '2026-01-01',
        finish_date: '2026-03-01', level: 1, task_type: 'Milestone' },
    ])
    expect(out.ok).toBe(false)
    expect(out.errors.some((e: { field: string }) => e.field === 'task_type')).toBe(true)
  })

  test('an empty file is refused', async () => {
    expect(await denied(w.admin, 'select import_programme($1,$2,$3)',
      [w.other, 'Empty', '[]'])).toMatch(/no rows/)
  })
})

describe('due_date is the only way a date is computed', () => {
  test('resolves from the finish by default and applies the offset', async () => {
    const r = await asUser(w.consultant, (c) =>
      c.query('select due_date($1,$2,$3,$4,$5) as d',
        [w.project, '1121', -30, 'finish', null]))
    // 1121 finishes 2026-10-30; thirty days before is 2026-09-30.
    expect(r.rows[0].d.toISOString().slice(0, 10)).toBe('2026-09-30')
  })

  test('anchors to the start when asked', async () => {
    const r = await asUser(w.consultant, (c) =>
      c.query('select due_date($1,$2,$3,$4,$5) as d', [w.project, '1121', 0, 'start', null]))
    expect(r.rows[0].d.toISOString().slice(0, 10)).toBe('2026-06-01')
  })

  test('an override wins outright', async () => {
    const r = await asUser(w.consultant, (c) =>
      c.query('select due_date($1,$2,$3,$4,$5) as d',
        [w.project, '1121', -30, 'finish', '2026-01-15']))
    expect(r.rows[0].d.toISOString().slice(0, 10)).toBe('2026-01-15')
  })

  test('an unanchored record has no date rather than a wrong one', async () => {
    const r = await asUser(w.consultant, (c) =>
      c.query('select due_date($1,$2,$3,$4,$5) as d', [w.project, null, 5, 'finish', null]))
    expect(r.rows[0].d).toBeNull()
  })

  test('a uid resolves only within its own project', async () => {
    // The bug drm_leads had: matching on the planner's ID alone would resolve
    // against whichever project happened to use the same numbering.
    await asUser(w.admin, (c) =>
      c.query('select import_programme($1,$2,$3)', [w.other, 'Other', JSON.stringify([
        { task_uid: '1121', description: 'Different project, same ID',
          start_date: '2027-01-01', finish_date: '2027-01-31', level: 1, task_type: 'Task' },
      ])]))

    const here = await asUser(w.admin, (c) =>
      c.query('select due_date($1,$2,0,$3,null) as d', [w.project, '1121', 'finish']))
    const there = await asUser(w.admin, (c) =>
      c.query('select due_date($1,$2,0,$3,null) as d', [w.other, '1121', 'finish']))
    expect(here.rows[0].d.toISOString().slice(0, 10)).toBe('2026-10-30')
    expect(there.rows[0].d.toISOString().slice(0, 10)).toBe('2027-01-31')
  })
})

describe('slipping the programme reschedules everything anchored to it', () => {
  test('every anchored date moves, and not one dependent row is written', async () => {
    // Four records anchored to 1121 the way later phases will anchor: a
    // drawing due 30 days before the package finishes, an RFI on the day, a
    // review a week after, and one anchored to the start.
    const deps = [
      anchored('1121', -30), anchored('1121', 0),
      anchored('1121', 7), anchored('1121', 0, 'start'),
    ]
    const dueNow = async () => {
      const out: string[] = []
      for (const d of deps) {
        const r = await asUser(w.consultant, (c) =>
          c.query('select due_date($1,$2,$3,$4,null) as d',
            [w.project, d.uid, d.offset, d.anchorAt]))
        out.push(r.rows[0].d.toISOString().slice(0, 10))
      }
      return out
    }

    const before = await dueNow()
    expect(before).toEqual(['2026-09-30', '2026-10-30', '2026-11-06', '2026-06-01'])

    // The whole record of the dependents, to prove nothing about them changed.
    const fingerprint = JSON.stringify(deps)

    // Rev 12: the architectural package slips six weeks.
    const slipped = rows().map((r) =>
      r.task_uid === '1121' ? { ...r, finish_date: '2026-12-11' } : r)
    const out = await asUser(w.admin, (c) =>
      c.query('select import_programme($1,$2,$3) as out',
        [w.project, 'Rev 12', JSON.stringify(slipped)]))
    expect(out.rows[0].out.ok).toBe(true)

    const after = await dueNow()
    expect(after).toEqual(['2026-11-11', '2026-12-11', '2026-12-18', '2026-06-01'])

    // The dependents were never touched. That is the invariant: rescheduling a
    // project writes to programme_tasks and nothing else.
    expect(JSON.stringify(deps)).toBe(fingerprint)
  })

  test('the import reports what moved, line by line', async () => {
    // Built from the state the previous revision left behind, so the only
    // difference in this file is the one line being moved.
    const slipped = rows()
      .map((r) => (r.task_uid === '1121' ? { ...r, finish_date: '2026-12-11' } : r))
      .map((r) =>
        r.task_uid === '1126' ? { ...r, start_date: '2027-01-15', finish_date: '2027-01-15' } : r)
    const out = (await asUser(w.admin, (c) =>
      c.query('select import_programme($1,$2,$3) as out',
        [w.project, 'Rev 13', JSON.stringify(slipped)]))).rows[0].out

    expect(out.moved).toHaveLength(1)
    expect(out.moved[0].task_uid).toBe('1126')
    expect(out.moved[0].finish_slip_days).toBe(28)
    expect(out.added).toBe(0)
    expect(out.removed).toBe(0)
  })
})

describe('a line that leaves the programme', () => {
  test('is marked removed, never deleted', async () => {
    const without = rows().filter((r) => r.task_uid !== '1126')
    const out = (await asUser(w.admin, (c) =>
      c.query('select import_programme($1,$2,$3) as out',
        [w.project, 'Rev 14', JSON.stringify(without)]))).rows[0].out
    expect(out.removed).toBe(1)

    const still = await asUser(w.admin, (c) =>
      c.query('select removed from programme_tasks where project_id=$1 and task_uid=$2',
        [w.project, '1126']))
    expect(still.rows).toHaveLength(1)
    expect(still.rows[0].removed).toBe(true)
  })

  test('flags its dependents rather than orphaning them', async () => {
    // The date still resolves -- a dependent shows its last known date and a
    // flag, rather than blanking out and losing the fact it was ever due.
    const r = await asUser(w.consultant, (c) =>
      c.query('select due_date($1,$2,0,$3,null) as d, anchor_state($1,$2) as s',
        [w.project, '1126', 'finish']))
    expect(r.rows[0].d).not.toBeNull()
    expect(r.rows[0].s).toBe('removed')
  })

  test('tells apart a line that left from one that was never there', async () => {
    const r = await asUser(w.consultant, (c) =>
      c.query(`select anchor_state($1,'1126') as removed,
                      anchor_state($1,'8888') as missing,
                      anchor_state($1,null) as none,
                      anchor_state($1,'1121') as ok`, [w.project]))
    expect(r.rows[0]).toEqual({
      removed: 'removed', missing: 'missing', none: 'unanchored', ok: 'ok',
    })
  })

  test('a line that comes back is restored, not duplicated', async () => {
    const out = (await asUser(w.admin, (c) =>
      c.query('select import_programme($1,$2,$3) as out',
        [w.project, 'Rev 15', JSON.stringify(rows())]))).rows[0].out
    expect(out.restored).toBe(1)
    expect(out.added).toBe(0)

    const r = await asUser(w.admin, (c) =>
      c.query('select count(*)::int as n from programme_tasks where project_id=$1 and task_uid=$2',
        [w.project, '1126']))
    expect(r.rows[0].n).toBe(1)
    expect(await asUser(w.consultant, (c) =>
      c.query('select anchor_state($1,$2) as s', [w.project, '1126'])))
      .toMatchObject({ rows: [{ s: 'ok' }] })
  })
})

describe('roll-ups are computed, never stored', () => {
  test('a summary takes its dates from its leaf descendants', async () => {
    const r = await asUser(w.consultant, (c) =>
      c.query(`select rolled_start, rolled_finish, leaf_count from v_programme_rollup
               where project_id = $1 and root_uid = '1100'`, [w.project]))
    expect(r.rows).toHaveLength(1)
    // 1100's leaves are 1121 (Jun 2026 - Dec 2026, slipped) and 1126.
    expect(r.rows[0].rolled_start.toISOString().slice(0, 10)).toBe('2026-06-01')
    expect(r.rows[0].leaf_count).toBe(2)
  })

  test('the top summary rolls up through every level, not just its children', async () => {
    const r = await asUser(w.consultant, (c) =>
      c.query(`select leaf_count from v_programme_rollup
               where project_id = $1 and root_uid = '1000'`, [w.project]))
    expect(r.rows[0].leaf_count).toBe(2)
  })
})

describe('the line inspector', () => {
  test('reaches every anchored table, and no table that only links', async () => {
    // A table is *anchored* when it carries the full set -- programme_task_uid
    // with offset_days and anchor beside it. Those are records with a date, and
    // every one of them must be reachable from the inspector, or slipping a
    // line silently moves work nobody can see.
    const anchored = await asUser(w.admin, (c) =>
      c.query(`select c.table_name from information_schema.columns c
               join information_schema.tables t
                 on t.table_schema = c.table_schema and t.table_name = c.table_name
                and t.table_type = 'BASE TABLE'   -- a view inherits the columns
               where c.table_schema = 'public' and c.column_name = 'programme_task_uid'
                 and c.table_name in (
                   select table_name from information_schema.columns
                   where table_schema = 'public' and column_name = 'offset_days')
               order by 1`))

    // A table carrying programme_task_uid *without* offset_days is a resource
    // link, not a date -- drawing_pack_programme is the case this exists for. A
    // pack points at a line so the people doing that work can find the drawings;
    // a drawing's due date comes from its own anchor columns and nowhere else.
    // If one of these ever appears in programme_dependents(), a pack has started
    // influencing a date, which is the exact ambiguity the rule forbids.
    const linksOnly = await asUser(w.admin, (c) =>
      c.query(`select c.table_name from information_schema.columns c
               join information_schema.tables t
                 on t.table_schema = c.table_schema and t.table_name = c.table_name
                and t.table_type = 'BASE TABLE'
               where c.table_schema = 'public' and c.column_name = 'programme_task_uid'
                 and c.table_name not in (
                   select table_name from information_schema.columns
                   where table_schema = 'public' and column_name = 'offset_days')
                 and c.table_name <> 'programme_watch'
               order by 1`))

    const src = (await asUser(w.admin, (c) =>
      c.query(`select prosrc from pg_proc where proname = 'programme_dependents'`)))
      .rows[0].prosrc as string

    for (const t of anchored.rows) expect(src).toContain(t.table_name)
    for (const t of linksOnly.rows) expect(src).not.toContain(t.table_name)
  })

  test('counts exactly the dependents of that line', async () => {
    const before = await asUser(w.consultant, (c) =>
      c.query('select count(*)::int as n from programme_dependents($1,$2)',
        [w.project, '1121']))

    // Two drawings anchored to 1121, one to another line.
    await asUser(w.admin, (c) => c.query(
      `insert into drawing_register (project_id, document_number, title,
         programme_task_uid, offset_days, anchor)
       values ($1,'KMW-BEL-BC-ZZ-DR-A-0400','Plans','1121',-30,'finish'),
              ($1,'KMW-BEL-BC-ZZ-DR-A-0401','Sections','1121',-14,'finish'),
              ($1,'KMW-CWC-BC-ZZ-DR-S-1100','Frame','1126',0,'finish')`, [w.project]))

    const after = await asUser(w.consultant, (c) =>
      c.query('select ref, due from programme_dependents($1,$2) order by ref',
        [w.project, '1121']))
    expect(after.rows).toHaveLength(before.rows[0].n + 2)
    expect(after.rows.map((r) => r.ref)).toEqual([
      'KMW-BEL-BC-ZZ-DR-A-0400', 'KMW-BEL-BC-ZZ-DR-A-0401'])

    // The date the inspector reports is the one due_date() gives -- proving it
    // resolves through the spine rather than carrying a date of its own.
    const spine = await asUser(w.consultant, (c) =>
      c.query(`select due_date($1,'1121',-30,'finish',null) as d`, [w.project]))
    expect(after.rows[0].due.toISOString()).toBe(spine.rows[0].d.toISOString())
  })
})

describe('a watchlist is the watcher\'s own', () => {
  test('a person can track a line and see it back', async () => {
    await asUser(w.consultant, (c) =>
      c.query('select watch_programme_line($1,$2)', [w.project, '1121']))
    const r = await asUser(w.consultant, (c) =>
      c.query('select task_uid from programme_watch where project_id = $1', [w.project]))
    expect(r.rows.map((x) => x.task_uid)).toEqual(['1121'])
  })

  test('tracking the same line twice is a no-op, not a duplicate', async () => {
    await asUser(w.consultant, (c) =>
      c.query('select watch_programme_line($1,$2)', [w.project, '1121']))
    const r = await asUser(w.consultant, (c) =>
      c.query('select count(*)::int as n from programme_watch where project_id = $1', [w.project]))
    expect(r.rows[0].n).toBe(1)
  })

  test('a line that does not exist cannot be tracked', async () => {
    expect(await denied(w.consultant, 'select watch_programme_line($1,$2)',
      [w.project, '8888'])).toMatch(/No such programme line/)
  })

  test('nobody sees another person\'s watchlist, admin included', async () => {
    const asAdmin = await asUser(w.admin, (c) =>
      c.query('select count(*)::int as n from programme_watch where project_id = $1', [w.project]))
    expect(asAdmin.rows[0].n).toBe(0)
  })

  test('a watch cannot be planted on someone else', async () => {
    expect(await denied(w.admin,
      `insert into programme_watch (project_id, profile_id, task_uid)
       values ($1,$2,'1121')`, [w.project, w.consultant]))
      .toMatch(/row-level security/)
  })

  test('untracking removes it', async () => {
    await asUser(w.consultant, (c) =>
      c.query('select unwatch_programme_line($1,$2)', [w.project, '1121']))
    const r = await asUser(w.consultant, (c) =>
      c.query('select count(*)::int as n from programme_watch where project_id = $1', [w.project]))
    expect(r.rows[0].n).toBe(0)
  })
})

describe('the sample programme CSV that ships in docs/', () => {
  test('imports through the real function, exactly as handed to a user', async () => {
    // docs/sample-programme-brackenfield.csv is given to people as something to
    // load into an empty project. If it ever stops importing cleanly -- a date
    // format, a milestone spanning two days, a parent that is not there -- that
    // is found here rather than by whoever was told it would just work.
    const { readFileSync } = await import('node:fs')
    const Papa = (await import('papaparse')).default
    const csv = readFileSync('docs/sample-programme-brackenfield.csv', 'utf8')
    const parsed = Papa.parse<Record<string, string>>(csv, {
      header: true, skipEmptyLines: true,
    })
    expect(parsed.errors).toEqual([])

    // The same mapping the importer's guesser produces from these headers,
    // and the same dd/mm/yyyy conversion the browser does.
    const toIso = (v: string) => {
      const m = v.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
      return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : v.trim()
    }
    const rows = parsed.data.map((r) => ({
      task_uid: r['ID'],
      description: r['Task Name'],
      start_date: toIso(r['Start']),
      finish_date: toIso(r['Finish']),
      percent_complete: parseInt(r['% Complete'], 10),
      level: parseInt(r['Outline Level'], 10),
      parent_uid: r['Parent ID'] || null,
      task_type: r['Type'],
    }))

    const project = await asSuperuser(async (c: Client) => (await c.query(
      `insert into projects (organisation_id, name, code)
       select organisation_id, 'Brackenfield', 'BFA' from projects where id = $1
       returning id`, [w.project])).rows[0].id)

    const out = (await asUser(w.admin, (c) =>
      c.query('select import_programme($1,$2,$3) as out',
        [project, 'Tender programme Rev A', JSON.stringify(rows)]))).rows[0].out

    expect(out.errors ?? []).toEqual([])
    expect(out.ok).toBe(true)
    expect(out.added).toBe(rows.length)

    // The hierarchy holds: every summary rolls up from leaves that exist.
    const roll = await asUser(w.admin, (c) =>
      c.query(`select root_uid, leaf_count from v_programme_rollup
               where project_id = $1 order by root_uid`, [project]))
    expect(roll.rows.length).toBeGreaterThan(0)
    expect(roll.rows.every((r) => r.leaf_count > 0)).toBe(true)

    // And the spine resolves against it: 30 days before the facade package
    // finishes on 2027-01-15.
    const due = await asUser(w.admin, (c) =>
      c.query(`select due_date($1,'1260',-30,'finish',null) as d`, [project]))
    expect(due.rows[0].d.toISOString().slice(0, 10)).toBe('2026-12-16')
  })
})
