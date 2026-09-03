/**
 * Phase 14 — portfolio dashboards and snapshots.
 *
 * The two assertions TASKS.md names are both structural, and both are the kind
 * that only a test can hold: no live figure is ever read from a snapshot, and a
 * project on the host home is one the signed-in person is a member of.
 *
 * The first is enforced by scanning pg_proc rather than by reading the code,
 * because the failure it guards against is a future function quietly reaching
 * for the stored number because it is faster.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import type { Client } from 'pg'
import { asSuperuser, asUser, makePerson, refused } from './db'

type World = {
  admin: string; internal: string; cara: string; rival: string; outsider: string
  org: string; otherOrg: string
  alpha: string; bravo: string; charlie: string; foreign: string
  catBel: string; belAlpha: string; belBravo: string; ngtAlpha: string
}
let w: World

const denied = (who: string, sql: string, params: unknown[] = []) =>
  refused(() => asUser(who, (c) => c.query(sql, params)))
const rows = <T = Record<string, unknown>>(who: string, sql: string, params: unknown[] = []) =>
  asUser(who, (c) => c.query(sql, params)).then((r) => r.rows as T[])
const one = async <T = Record<string, unknown>>(
  who: string, sql: string, params: unknown[] = [],
) => (await rows<T>(who, sql, params))[0]
const num = (v: unknown) => Number(v)

beforeAll(async () => {
  w = await asSuperuser(async (c: Client) => {
    const admin = await makePerson(c, 'Ada Admin', 'p14-ada@hbc.example')
    const internal = await makePerson(c, 'Ian Internal', 'p14-ian@hbc.example')
    const cara = await makePerson(c, 'Cara Consultant', 'p14-cara@bel.example')
    const rival = await makePerson(c, 'Rhys Rival', 'p14-rhys@ngt.example')
    const outsider = await makePerson(c, 'Otto Outside', 'p14-otto@elsewhere.example')

    const org = (await c.query(
      `insert into organisations (name, slug, status) values ('HBC14','hbc14','active')
       returning id`)).rows[0].id
    // A second account, so account isolation has something to fail at.
    const otherOrg = (await c.query(
      `insert into organisations (name, slug, status) values ('Rival Build','rival14','active')
       returning id`)).rows[0].id

    const mkProject = async (o: string, name: string, code: string, hrb = false) =>
      (await c.query(
        `insert into projects (organisation_id, name, code, riba_stage, hrb)
         values ($1,$2,$3,'4',$4) returning id`, [o, name, code, hrb])).rows[0].id
    const alpha = await mkProject(org, 'Brackenfield', 'ALPHA')
    const bravo = await mkProject(org, 'Kingsmead', 'BRAVO', true)
    const charlie = await mkProject(org, 'Whitlow', 'CHARLIE')
    const foreign = await mkProject(otherOrg, 'Not ours', 'FOREIGN')

    const cat = async (o: string, name: string) => (await c.query(
      `insert into catalogue_companies (organisation_id, name, company_type)
       values ($1,$2,'consultant') returning id`, [o, name])).rows[0].id
    const catBel = await cat(org, 'Bellweather')
    const catNgt = await cat(org, 'Northgate')

    const mkCo = async (project: string, name: string, code: string, catalogue: string) =>
      (await c.query(
        `insert into companies
           (project_id, name, originator_code, company_type, catalogue_company_id)
         values ($1,$2,$3,'consultant',$4) returning id`,
        [project, name, code, catalogue])).rows[0].id
    // The SAME firm on two projects — two `companies` rows, one catalogue entry.
    const belAlpha = await mkCo(alpha, 'Bellweather', 'BEL', catBel)
    const belBravo = await mkCo(bravo, 'Bellweather', 'BEL', catBel)
    const ngtAlpha = await mkCo(alpha, 'Northgate', 'NGT', catNgt)

    for (const [p, role, co] of [
      [admin, 'admin', null], [internal, 'internal', null],
      [cara, 'consultant', catBel], [rival, 'consultant', catNgt],
    ] as const) {
      await c.query(
        `insert into organisation_members (organisation_id, profile_id, role, company_id)
         values ($1,$2,$3,$4)`, [org, p, role, co])
    }
    // Cara is on ALPHA only — not BRAVO, not CHARLIE.
    await c.query(
      `insert into project_members (project_id, profile_id, project_role)
       values ($1,$2,'member')`, [alpha, cara])
    await c.query(
      `insert into project_members (project_id, profile_id, project_role)
       values ($1,$2,'member')`, [alpha, rival])

    await c.query(
      `insert into company_disciplines (company_id, discipline_code)
       values ($1,'A'), ($2,'A'), ($3,'M')`, [belAlpha, belBravo, ngtAlpha])

    // A matrix gap on ALPHA: nobody holds S.
    await c.query(
      `insert into drm_items (project_id, ref, category_code, item, lead_discipline)
       values ($1,'04.060','04','Roof covering','A'),
              ($1,'05.010','05','Structural frame','S')`, [alpha])

    // A stop-work on BRAVO, which is the higher-risk building.
    await c.query(
      `insert into change_requests
         (project_id, reference, title, status, raised_by, bsa_controlled, bsa_class,
          bsa_class_by, bsa_class_at, bsa_class_note)
       values ($1,'CHG-001','Alter the escape strategy','Approved',$2,true,'Notifiable',
               $2, now(), 'Alters a fire safety provision.')`, [bravo, admin])
    // And an ordinary decision waiting on ALPHA.
    await c.query(
      `insert into change_requests (project_id, reference, title, status, raised_by)
       values ($1,'CHG-100','Revise the roof build-up','Submitted',$2)`, [alpha, admin])

    await c.query(
      `insert into programme_tasks
         (project_id, task_uid, description, start_date, finish_date, level, task_type,
          percent_complete)
       values ($1,'1100','Stage 4','2026-01-05','2026-06-30',1,'Task',50)`, [alpha])

    // Client requirements on ALPHA, one of two confirmed.
    await c.query(
      `insert into tracked_items (project_id, kind, reference, title, status, required)
       values ($1,'checklist:client','CLI-001','Confirm FF&E','Complete',true),
              ($1,'checklist:client','CLI-002','Confirm signage','Not started',true)`,
      [alpha])

    return { admin, internal, cara, rival, outsider, org, otherOrg,
             alpha, bravo, charlie, foreign, catBel, belAlpha, belBravo, ngtAlpha }
  })
})

/* ------------------------------------------------- the two named assertions */

describe('no live figure is ever read from a snapshot', () => {
  test('only the writer and the two trend readers touch the table', async () => {
    // take_daily_snapshots() is absent on purpose: it loops and calls
    // take_snapshot(), and never names the table itself.
    // The guard, and it is structural on purpose. The failure it protects
    // against is a future function reaching for the stored number because it is
    // faster — which would put a figure up to a day old on a live page, and the
    // staleness would only show up as an argument about whose screen was right.
    const fns = await rows<{ proname: string }>(w.admin, `
      select p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosrc ~ '\\msnapshots\\M'
      order by 1`)
    expect(fns.map((f) => f.proname)).toEqual([
      'portfolio_trend', 'project_trend', 'take_snapshot',
    ])
  })

  test('the live portfolio disagrees with a doctored snapshot, and is right', async () => {
    // Write a snapshot with figures that are plainly wrong, then read the live
    // page. If any of these numbers appeared, something was reading the table.
    await asSuperuser((c) => c.query(
      `insert into snapshots (project_id, date, overdue, drm_gaps, open_tasks, risk_expected)
       values ($1, current_date, 999, 888, 777, 666666)
       on conflict (project_id, date) do update set
         overdue = 999, drm_gaps = 888, open_tasks = 777, risk_expected = 666666`,
      [w.alpha]))

    const p = await one(w.admin,
      'select * from portfolio_projects() where project_id = $1', [w.alpha])
    expect(num(p.overdue_documents)).toBe(0)
    expect(num(p.drm_gaps)).toBe(1)      // the S item nobody holds
    expect(num(p.open_tasks)).toBe(0)

    const s = await one(w.admin, 'select * from portfolio_summary($1)', [w.org])
    expect(num(s.overdue_documents)).toBe(0)
    expect(num(s.drm_gaps)).toBe(1)

    // The trend, which is the one thing that may read it, sees the doctored row.
    const t = await rows(w.admin, 'select * from project_trend($1)', [w.alpha])
    expect(num(t[t.length - 1].overdue)).toBe(999)

    await asSuperuser((c) => c.query('delete from snapshots where project_id = $1', [w.alpha]))
  })

  test('nobody may write one by hand', async () => {
    // No insert, update or delete policy at all: the definer job is the only
    // writer, so a stored figure cannot be edited into agreeing with an
    // argument about last month.
    expect(await denied(w.admin,
      `insert into snapshots (project_id, date) values ($1, current_date)`, [w.alpha]))
      .toMatch(/permission denied|policy/i)
    // And the job itself is not callable from a session.
    expect(await denied(w.admin, 'select take_snapshot($1)', [w.alpha]))
      .toMatch(/permission denied/i)
    expect(await denied(w.admin, 'select take_daily_snapshots()'))
      .toMatch(/permission denied/i)
  })
})

describe('a project on the host home is one you are a member of', () => {
  test('account staff see every project in their account and no other', async () => {
    for (const who of [w.admin, w.internal]) {
      const codes = (await rows(who, 'select code from portfolio_projects()'))
        .map((r) => r.code).sort()
      expect(codes).toEqual(['ALPHA', 'BRAVO', 'CHARLIE'])
      // Another account's project is not theirs, and account isolation is
      // absolute.
      expect(codes).not.toContain('FOREIGN')
    }
  })

  test('a consultant sees only the projects they are on', async () => {
    const codes = (await rows(w.cara, 'select code from portfolio_projects()'))
      .map((r) => r.code)
    expect(codes).toEqual(['ALPHA'])
    // Bellweather is appointed on BRAVO too, but Cara is not a member of it —
    // being your firm's job is not the same as being yours.
    expect(codes).not.toContain('BRAVO')
  })

  test('somebody with no memberships gets an empty list, not an error', async () => {
    // A confirmed login with zero memberships is a normal, supported state.
    expect(await rows(w.outsider, 'select * from portfolio_projects()')).toEqual([])
    expect(await rows(w.outsider, 'select * from my_decisions()')).toEqual([])
    const s = await one(w.outsider, 'select * from portfolio_summary()')
    expect(num(s.projects)).toBe(0)
  })
})

/* --------------------------------------------------------- the host home */

describe('the host home', () => {
  test('worst first, and a stop-work outranks everything', async () => {
    const list = await rows(w.admin, 'select * from portfolio_projects()')
    // BRAVO has one stop-work; ALPHA has a matrix gap and a decision waiting.
    // A stop-work means somebody must put their tools down, so it sorts above.
    expect(list[0].code).toBe('BRAVO')
    expect(num(list[0].stop_works)).toBe(1)
    expect(num(list.find((r) => r.code === 'ALPHA')!.stop_works)).toBe(0)
    expect(list.map((r) => r.code)).toEqual(['BRAVO', 'ALPHA', 'CHARLIE'])
  })

  test('each row carries what the brief asks for', async () => {
    const a = await one(w.admin,
      'select * from portfolio_projects() where code = $1', ['ALPHA'])
    expect(a.stage).toBe('4')
    expect(a.hrb).toBe(false)
    expect(a.account_name).toBe('HBC14')
    expect(num(a.drm_gaps)).toBe(1)
    expect(num(a.decisions_waiting)).toBe(1)     // CHG-100, submitted
    expect([num(a.client_done), num(a.client_total)]).toEqual([1, 2])
    // The programme position comes from the one timeline function, not a
    // second calculation.
    expect(num(a.percent_complete)).toBe(50)

    const b = await one(w.admin,
      'select * from portfolio_projects() where code = $1', ['BRAVO'])
    expect(b.hrb).toBe(true)
  })

  test('the summary is live, and it is the sum of the rows', async () => {
    const list = await rows(w.admin, 'select * from portfolio_projects()')
    const s = await one(w.admin, 'select * from portfolio_summary($1)', [w.org])
    expect(num(s.projects)).toBe(list.length)
    expect(num(s.stop_works)).toBe(
      list.reduce((n, r) => n + num(r.stop_works), 0))
    expect(num(s.drm_gaps)).toBe(list.reduce((n, r) => n + num(r.drm_gaps), 0))
    expect(num(s.hrb_projects)).toBe(1)
  })

  test('scoped to one account when asked', async () => {
    const s = await one(w.admin, 'select * from portfolio_summary($1)', [w.otherOrg])
    // Ada is not a member of the other account, so it contributes nothing —
    // she must never discover an account exists that she is not in.
    expect(num(s.projects)).toBe(0)
  })
})

/* -------------------------------------------- consultant health, summed */

describe('consultant health across projects', () => {
  beforeAll(async () => {
    // Give Bellweather an overdue drawing on each of two projects, so the sum
    // is the point rather than a single row restated.
    await asSuperuser(async (c: Client) => {
      for (const [proj, ref] of [
        [w.alpha, 'ALPHA-BEL-001'], [w.bravo, 'BRAVO-BEL-001'],
      ] as const) {
        await c.query(
          `insert into drawing_register
             (project_id, document_number, title, due_date_override)
           values ($1,$2,'A late drawing','2020-01-01')`, [proj, ref])
      }
    })
  })

  test('the same firm on two projects is one row, gathered by catalogue entry', async () => {
    const h = await rows(w.admin, 'select * from portfolio_consultant_health($1)', [w.org])
    const bel = h.find((r) => r.company_name === 'Bellweather')!
    expect(bel).toBeDefined()
    // Two projects, one row. Matching on name would merge two genuinely
    // different firms that share one, and split one that was typed twice.
    expect(num(bel.projects)).toBe(2)
    expect(bel.catalogue_company_id).toBe(w.catBel)
    expect(num(bel.overdue_drawings)).toBe(2)
  })

  test('a consultant who is fine on one job and behind on another shows both', async () => {
    const h = await rows(w.admin, 'select * from portfolio_consultant_health($1)', [w.org])
    const bel = h.find((r) => r.company_name === 'Bellweather')!
    const ngt = h.find((r) => r.company_name === 'Northgate')
    // Northgate is on one project only.
    if (ngt) expect(num(ngt.projects)).toBe(1)
    // Worst first, like the per-project view.
    expect(num(h[0].concern_score)).toBeGreaterThanOrEqual(num(bel.concern_score))
  })

  test('it never leaves the contractor’s own staff', async () => {
    // consultant_health() is internal-only by its own definition, so the
    // roll-up inherits that rather than restating it — a consultant reading
    // their own position against a rival's is not what it is for.
    expect(await rows(w.cara, 'select * from portfolio_consultant_health()')).toEqual([])
    expect(await rows(w.rival, 'select * from portfolio_consultant_health()')).toEqual([])
  })
})

/* --------------------------------------------- the decision queue, everywhere */

describe('the decision queue across projects', () => {
  test('it is personal, and it says which project each item is on', async () => {
    // The opposite of report_attention(), and correctly so: a dashboard is read
    // by the person looking at it, a report by somebody else.
    const q = await rows(w.admin, 'select * from my_decisions()')
    for (const r of q) {
      expect(r.project_code).toBeTruthy()
      expect(['ALPHA', 'BRAVO', 'CHARLIE']).toContain(r.project_code)
    }
    const src = await one<{ prosrc: string }>(w.admin,
      `select prosrc from pg_proc where proname = 'decision_queue'`)
    expect(src.prosrc).toMatch(/auth\.uid\(\)/)
  })

  test('it spans only the projects that person is on', async () => {
    const q = await rows(w.cara, 'select distinct project_code from my_decisions()')
    for (const r of q) expect(r.project_code).toBe('ALPHA')
  })
})

/* ------------------------------------------------------------ snapshots */

describe('taking a snapshot', () => {
  test('records the live figures, and re-running replaces rather than fails', async () => {
    await asSuperuser((c) => c.query('select take_snapshot($1)', [w.alpha]))
    let s = await one(w.admin,
      'select * from snapshots where project_id = $1 and date = current_date', [w.alpha])
    expect(num(s.drm_gaps)).toBe(1)
    expect([num(s.client_done), num(s.client_total)]).toEqual([1, 2])
    // Two overdue drawings were added on ALPHA and BRAVO above; one is ALPHA's.
    expect(num(s.overdue)).toBe(1)

    // A job that cannot be safely retried is a job that eventually leaves a
    // hole, so a second run for the same date updates in place.
    await asSuperuser((c) => c.query('select take_snapshot($1)', [w.alpha]))
    const n = await one(w.admin,
      'select count(*) as n from snapshots where project_id = $1 and date = current_date',
      [w.alpha])
    expect(num(n.n)).toBe(1)

    // And it agrees with the live page it was taken from.
    const live = await one(w.admin,
      'select * from portfolio_projects() where project_id = $1', [w.alpha])
    s = await one(w.admin,
      'select * from snapshots where project_id = $1 and date = current_date', [w.alpha])
    expect(num(s.drm_gaps)).toBe(num(live.drm_gaps))
    expect(num(s.overdue)).toBe(num(live.overdue_documents))
  })

  test('the nightly job covers every live project', async () => {
    const n = await asSuperuser((c) =>
      c.query('select take_daily_snapshots() as n').then((r) => Number(r.rows[0].n)))
    // Three in this account plus the other account's, plus any from earlier
    // suites — every project on a live or archived account.
    expect(n).toBeGreaterThanOrEqual(4)
    const mine = await rows(w.admin,
      'select project_id from snapshots where date = current_date')
    // Ada sees rows only for projects she can see, because the policy says so.
    expect(mine.length).toBe(3)
  })

  test('a suspended account is skipped', async () => {
    await asSuperuser(async (c: Client) => {
      await c.query('delete from snapshots')
      await c.query(`update organisations set status = 'suspended' where id = $1`, [w.org])
      await c.query('select take_daily_snapshots()')
    })
    // A flat line through a suspension reads as a project that stalled rather
    // than one that was switched off.
    const n = await asSuperuser((c) => c.query(
      'select count(*) as n from snapshots where project_id = any($1)',
      [[w.alpha, w.bravo, w.charlie]]).then((r) => Number(r.rows[0].n)))
    expect(n).toBe(0)
    await asSuperuser((c) => c.query(
      `update organisations set status = 'active' where id = $1`, [w.org]))
  })

  test('a member reads their own project’s trend and nobody else’s', async () => {
    await asSuperuser(async (c: Client) => {
      await c.query('select take_snapshot($1)', [w.alpha])
      await c.query('select take_snapshot($1)', [w.bravo])
    })
    expect((await rows(w.cara, 'select * from project_trend($1)', [w.alpha])).length)
      .toBeGreaterThan(0)
    // Cara is not on BRAVO.
    expect(await rows(w.cara, 'select * from project_trend($1)', [w.bravo])).toEqual([])

    const pt = await rows(w.cara, 'select * from portfolio_trend()')
    for (const r of pt) expect(num(r.projects)).toBe(1)
  })
})
