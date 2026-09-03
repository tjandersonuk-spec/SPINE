/**
 * The sample project, and the two product bugs it found.
 *
 * `seed_sample_data()` builds one believable job across every module. That
 * makes it the widest integration test there is: it exercises every table,
 * every check constraint and every definer function in one transaction, and it
 * has already caught two things no unit test would have.
 *
 * The assertions below are not "the seed inserted rows". They are that the
 * derivations read something meaningful off it -- because a seed that loads
 * without error and leaves every page empty is worse than no seed at all.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import type { Client } from 'pg'
import { asSuperuser, asUser, makePerson } from './db'

let admin: string
let project: string

const rows = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  asUser(admin, (c) => c.query(sql, params)).then((r) => r.rows as T[])
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await rows<T>(sql, params))[0]
const num = (v: unknown) => Number(v)

beforeAll(async () => {
  await asSuperuser(async (c: Client) => {
    admin = await makePerson(c, 'Sam Sample', 'sample-sam@hbc.example')
    const org = (await c.query(
      `insert into organisations (name, slug, status) values ('Sample Co','sample-co','active')
       returning id`)).rows[0].id
    await c.query(
      `insert into organisation_members (organisation_id, profile_id, role)
       values ($1, $2, 'admin')`, [org, admin])
    project = (await asUser(admin, (u) =>
      u.query(`select create_project($1,'Kingsmead Wharf Block C','KWC') as id`, [org])
    )).rows[0].id
  })
  // Seeded as the admin, which is the only role the function permits.
  await asUser(admin, (c) => c.query('select seed_sample_data($1)', [project]))
}, 120_000)

describe('the sample project fills every module', () => {
  test('the directory, the programme and the matrix are all there', async () => {
    const r = await one<Record<string, string>>(`
      select (select count(*) from companies where project_id = $1) as companies,
             (select count(*) from programme_tasks where project_id = $1) as tasks,
             (select count(*) from drm_items where project_id = $1) as duties,
             (select count(*) from drawing_register where project_id = $1) as drawings,
             (select count(*) from tracked_items where project_id = $1) as tracked,
             (select count(*) from issues where project_id = $1) as issues,
             (select count(*) from risks where project_id = $1) as risks,
             (select count(*) from fees where project_id = $1) as fees,
             (select count(*) from change_requests where project_id = $1) as changes`,
      [project])
    expect(num(r.companies)).toBeGreaterThanOrEqual(16)
    expect(num(r.tasks)).toBe(36)
    expect(num(r.duties)).toBe(100)
    expect(num(r.drawings)).toBeGreaterThan(40)
    expect(num(r.tracked)).toBeGreaterThan(80)
    expect(num(r.issues)).toBeGreaterThan(15)
    expect(num(r.risks)).toBeGreaterThan(10)
    expect(num(r.fees)).toBeGreaterThan(15)
    expect(num(r.changes)).toBe(8)
  })

  test('every dated row anchors to the programme rather than carrying a typed date', async () => {
    // The invariant the whole product rests on. A sample project that typed its
    // dates would teach the wrong thing and would not move when the programme
    // is re-imported.
    for (const t of ['drawing_register', 'issues', 'tracked_items', 'materials',
                     'payment_schedule', 'warranties', 'risks']) {
      const r = await one<{ n: string }>(
        `select count(*) as n from ${t}
         where project_id = $1 and programme_task_uid is null
           and due_date_override is null`, [project])
      expect(num(r.n), `${t} rows with neither an anchor nor an override`).toBe(0)
    }
  })

  test('the pages have something to show, not an empty state', async () => {
    const gaps = await one<{ n: string }>('select count(*) as n from drm_gaps($1)', [project])
    expect(num(gaps.n)).toBeGreaterThan(0)

    const reg = await one<Record<string, string>>(`
      select count(*) filter (where overdue) as overdue,
             count(*) filter (where awaited) as awaited,
             count(*) filter (where coalesce(naming_error,'') <> '') as bad_names
      from v_drawing_register where project_id = $1`, [project])
    expect(num(reg.overdue)).toBeGreaterThan(0)
    expect(num(reg.awaited)).toBeGreaterThan(num(reg.overdue))
    // Exactly one number breaks the convention, on purpose.
    expect(num(reg.bad_names)).toBe(1)

    const quiet = await rows('select * from gone_quiet($1)', [project])
    expect(quiet.length).toBeGreaterThan(0)

    const gt = await one<Record<string, string>>(`
      select (select count(*) from golden_thread_moved($1)) as moved,
             (select count(*) from golden_thread_never_issued($1)) as never`, [project])
    expect(num(gt.moved)).toBeGreaterThan(0)
    expect(num(gt.never)).toBeGreaterThan(0)
  })

  test('the change requests put something in most of the twelve work states', async () => {
    const r = await rows<{ state: string }>(
      `select (work_status(id)).state as state from change_requests where project_id = $1`,
      [project])
    const states = new Set(r.map((x) => x.state))
    // Proceeding, waiting out a notification period, waiting on a major
    // application, objected to, and not yet classified: the states that decide
    // whether anybody may build anything.
    for (const s of ['not_controlled', 'notifiable_clear', 'notifiable_in_window',
                     'major_awaiting', 'major_approved', 'objected', 'unclassified']) {
      expect(states.has(s), `no change request is in state ${s}`).toBe(true)
    }
  })

  test('a prerequisite that is outstanding caps the rating, which is the point', async () => {
    const t = await one<Record<string, string>>(
      'select * from breeam_totals($1)', [project])
    expect(num(t.score_targeted)).toBeGreaterThan(30)
    expect(t.rating_targeted_on_score).toBe('Excellent')
    // Capped below what the score alone would give, by the one prerequisite
    // that is not verified.
    expect(t.rating_targeted).toBe('Very good')
    expect(t.capped_targeted).toBe(true)
  })

  test('no licensed scheme content is shipped', async () => {
    // The demonstration scheme is fictional and says so. If this ever starts
    // failing it is because somebody pasted a real scheme into the seed.
    const s = await one<{ name: string; version: string }>(
      'select name, version from breeam_schemes where project_id = $1', [project])
    expect(s.version).toBe('DEMO-2026')
    expect(s.name).toMatch(/fictional/i)
  })
})

describe('one counter per prefix', () => {
  // next_reference() holds no grant for `authenticated` -- it is reached only
  // from the definer functions that generate a reference -- so these ask it
  // directly, which is the only way to compare two callers' keys.
  const seq = (kind: string, prefix: string) =>
    asSuperuser((c) =>
      c.query(`select next_reference($1, $2, $3) as r`, [project, kind, prefix])
    ).then((r) => r.rows[0].r as string)

  test('two callers sharing a prefix share a counter', async () => {
    // raise_issue() asked for 'issue_TSK' and realise_risk() asked for 'TSK'.
    // Keyed on the kind those are two counters, and the second one hands out
    // TSK-001 over the top of the first -- a unique-violation, not a confusing
    // number. Keyed on the prefix, as it is now, they are one counter.
    const a = await seq('issue_TSK', 'TSK')
    const b = await seq('TSK', 'TSK')
    expect(b).not.toBe(a)
    expect(Number(b.slice(4))).toBe(Number(a.slice(4)) + 1)
  })

  test('the seeded references are behind the counter, so the next one is free', async () => {
    const r = await seq('anything', 'RFI')
    const clash = await one<{ n: string }>(
      'select count(*) as n from issues where project_id = $1 and reference = $2',
      [project, r])
    expect(num(clash.n)).toBe(0)
  })
})

describe('the score is a percentage, and every reader agrees', () => {
  test('the report prints the same number the rating was decided on', async () => {
    // report_metrics() multiplied by 100 while breeam_totals() compared the
    // same value straight against the scheme's thresholds, so a project on
    // course for 74 per cent reported 7430%.
    const t = await one<Record<string, string>>('select * from breeam_totals($1)', [project])
    const m = await one<{ value: string }>(
      `select value from report_metrics($1, 'internal') where label like '%BREEAM%'`,
      [project])
    expect(m.value).toBe(`${Math.round(num(t.score_achieved))}%`)
  })
})
