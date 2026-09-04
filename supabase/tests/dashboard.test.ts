/**
 * The dashboard's figures, and the one rule that makes them trustworthy.
 *
 * The prototype computes its dashboard numbers separately from its report
 * numbers. That is the arrangement this asserts against: `dashboard_metrics()`
 * resolves which audience the caller is and then *delegates* to
 * `report_metrics()`, so a figure on the dashboard and the same figure in the
 * report are the same query. Two functions counting overdue drawings is how
 * they end up disagreeing in front of somebody who has both open.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import type { Client } from 'pg'
import { asSuperuser, asUser, makePerson, refused } from './db'

type World = {
  boss: string; cara: string; clive: string; stranger: string
  org: string; project: string; caraCo: string
}
let w: World

type Metric = {
  sort_order: number; value: string; label: string; alert: boolean
  tail: string | null; unit: string | null; detail_key: string | null
}

const rows = <T = Record<string, unknown>>(who: string, sql: string, params: unknown[] = []) =>
  asUser(who, (c) => c.query(sql, params)).then((r) => r.rows as T[])

beforeAll(async () => {
  w = await asSuperuser(async (c: Client) => {
    const boss = await makePerson(c, 'Bea Boss', 'dash-bea@hbc.example')
    const cara = await makePerson(c, 'Cara Consultant', 'dash-cara@bel.example')
    const clive = await makePerson(c, 'Clive Client', 'dash-clive@dev.example')
    const stranger = await makePerson(c, 'Sid Stranger', 'dash-sid@nowhere.example')
    const org = (await c.query(
      `insert into organisations (name, slug, status)
       values ('HBC','dash-hbc','active') returning id`)).rows[0].id
    await c.query(
      `insert into organisation_members (organisation_id, profile_id, role)
       values ($1,$2,'admin'), ($1,$3,'consultant'), ($1,$4,'client')`,
      [org, boss, cara, clive])

    const project = (await asUser(boss, (u) =>
      u.query(`select create_project($1,'Kingsmead Wharf Block C','DSH') as id`, [org])
    )).rows[0].id
    await asUser(boss, (u) => u.query('select seed_sample_data($1)', [project]))
    await c.query(
      `insert into project_members (project_id, profile_id, project_role)
       values ($1,$2,'member'), ($1,$3,'member')`, [project, cara, clive])

    // Put Cara at a real firm. my_company_on_project() resolves through the
    // account membership's catalogue company, not the directory row, so it is
    // the membership that has to carry it.
    const caraCo = (await c.query(
      `select id, catalogue_company_id from companies
       where project_id = $1 and company_type <> 'client' and catalogue_company_id is not null
       order by name limit 1`, [project])).rows[0]
    await c.query(
      `update organisation_members set company_id = $3
       where organisation_id = $1 and profile_id = $2`,
      [org, cara, caraCo.catalogue_company_id])

    return { boss, cara, clive, stranger, org, project, caraCo: caraCo.id }
  })
})

describe('the dashboard and the report cannot disagree', () => {
  test('an admin’s dashboard is the internal report’s own metrics', async () => {
    const dash = await rows<Metric>(w.boss, 'select * from dashboard_metrics($1)', [w.project])
    const report = await rows<Metric>(w.boss,
      `select * from report_metrics($1,'internal')`, [w.project])
    expect(dash).toEqual(report)
    // And it is not empty, or the equality above holds vacuously.
    expect(dash.length).toBeGreaterThan(4)
  })

  test('a client’s dashboard is the client report’s, not the internal one', async () => {
    const dash = await rows<Metric>(w.clive, 'select * from dashboard_metrics($1)', [w.project])
    const client = await rows<Metric>(w.clive,
      `select * from report_metrics($1,'client')`, [w.project])
    expect(dash).toEqual(client)

    // The tiles a client must never be handed, checked by what they say rather
    // than by trusting the audience argument.
    const labels = dash.map((m) => m.label).join(' | ')
    expect(labels).not.toMatch(/fee|risk|change request/i)
  })

  test('a consultant gets their own company’s figures', async () => {
    const dash = await rows<Metric>(w.cara, 'select * from dashboard_metrics($1)', [w.project])
    expect(dash.length).toBeGreaterThan(0)
    const labels = dash.map((m) => m.label).join(' | ')
    expect(labels).toMatch(/against us|our /i)
    // A rival's figures are not reachable by asking for them.
    const msg = await refused(() => asUser(w.cara, (c) => c.query(
      `select * from report_metrics($1,'internal')`, [w.project])))
    expect(msg).toMatch(/not permitted/i)
  })

  test('somebody who is not on the project is refused, not shown an empty strip', async () => {
    // Empty would read as "this project has nothing in it".
    const msg = await refused(() => asUser(w.stranger, (c) =>
      c.query('select * from dashboard_metrics($1)', [w.project])))
    expect(msg).toMatch(/not found/i)
  })
})

describe('the internal strip carries the compliance headlines', () => {
  test('planning, building control and the checklists are all on it', async () => {
    // The prototype has these three and ours stopped at fees, so a design
    // manager scanning the dashboard could not see the statutory position at
    // all without opening three more pages.
    const labels = (await rows<Metric>(w.boss, 'select * from dashboard_metrics($1)', [w.project]))
      .map((m) => m.label)
    expect(labels.join(' | ')).toMatch(/Planning conditions discharged/)
    expect(labels.join(' | ')).toMatch(/Building control items closed/)
    expect(labels.join(' | ')).toMatch(/Checklist items complete/)
  })

  test('every metric is ordered, and no two share a position', async () => {
    // sort_order is what the page renders by; a duplicate is a pair of tiles
    // that swap places between loads.
    const orders = (await rows<Metric>(w.boss, 'select * from dashboard_metrics($1)', [w.project]))
      .map((m) => m.sort_order)
    expect(new Set(orders).size).toBe(orders.length)
    expect([...orders]).toEqual([...orders].sort((a, b) => a - b))
  })
})

describe('the appointments bar reads the directory’s own answer', () => {
  test('it buckets every non-client company exactly once', async () => {
    const bar = await rows<{ state: string; companies: number }>(
      w.boss, 'select * from appointment_summary($1)', [w.project])
    const total = bar.reduce((a, b) => a + Number(b.companies), 0)
    const companies = await rows<{ n: string }>(w.boss,
      `select count(*) as n from companies
       where project_id = $1 and company_type <> 'client'`, [w.project])
    expect(total).toBe(Number(companies[0].n))
    expect(bar.every((b) => ['complete', 'partial', 'none'].includes(b.state))).toBe(true)
  })

  test('a company with nothing uploaded counts as not started, not partial', async () => {
    // The sample project uploads no appointment documents, so every company is
    // in the 'none' bucket. If that ever becomes 'partial' the bucketing has
    // started reading a slot list rather than the files behind it.
    const bar = await rows<{ state: string; companies: number }>(
      w.boss, 'select * from appointment_summary($1)', [w.project])
    expect(bar.find((b) => b.state === 'none')?.companies).toBeGreaterThan(0)
  })
})

/**
 * A figure and the list behind it are the same claim.
 *
 * The whole risk of making a tile clickable is that the number and the rows it
 * opens are computed twice and quietly stop agreeing — which is worse than not
 * opening at all, because the reader now has two answers and no way to tell
 * which is wrong. Both come out of the same file; this is what keeps them
 * coming out the same.
 */
describe('opening a figure shows exactly what it counted', () => {
  /** The number a tile is claiming, per key: some claim their value, some the
   *  overdue count in their tail, and the risk tile claims a count inside its
   *  own label. */
  const claimed = (m: Metric): number => {
    switch (m.detail_key) {
      case 'documents':
      case 'planning':
      case 'bc':
      case 'checklists':
        return Number(/(\d+) overdue/.exec(m.tail ?? '')?.[1] ?? -1)
      case 'risks':
        return Number(/, (\d+) live/.exec(m.label)?.[1] ?? -1)
      default:
        return Number(m.value)
    }
  }

  test('every key a tile offers returns that many rows', async () => {
    const metrics = await rows<Metric>(w.boss, 'select * from dashboard_metrics($1)', [w.project])
    const openable = metrics.filter((m) => m.detail_key)
    // The sample project is deliberately wrong in several places, so several
    // tiles must be openable or this test proves nothing.
    expect(openable.length).toBeGreaterThan(3)

    for (const m of openable) {
      const items = await rows(w.boss, 'select * from metric_items($1,$2)',
        [w.project, m.detail_key])
      expect(items.length, `${m.detail_key} (${m.label}): ${m.value} / ${m.tail}`)
        .toBe(claimed(m))
    }
  })

  test('a key nothing offers returns nothing rather than everything', async () => {
    // The union has no else branch; a typo must not fall through to a list.
    const items = await rows(w.boss, 'select * from metric_items($1,$2)',
      [w.project, 'nonsense'])
    expect(items).toEqual([])
  })

  test('every row names the page it lives on', async () => {
    const items = await rows<{ link: string }>(w.boss,
      `select * from metric_items($1,'issues')`, [w.project])
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((i) => i.link.length > 0)).toBe(true)
  })
})

describe('a health cell opens the names behind it', () => {
  test('the counts on the table are the lengths of the lists', async () => {
    const health = await rows<{
      company_id: string; company_name: string
      appointment_gaps: number; overdue_drawings: number
      open_issues: number; quiet_issues: number
    }>(w.boss, 'select * from consultant_health($1)', [w.project])
    expect(health.length).toBeGreaterThan(0)

    for (const h of health.slice(0, 6)) {
      for (const [kind, n] of [
        ['appointment', h.appointment_gaps], ['overdue', h.overdue_drawings],
        ['open', h.open_issues], ['quiet', h.quiet_issues],
      ] as const) {
        const items = await rows(w.boss, 'select * from company_items($1,$2,$3)',
          [w.project, h.company_id, kind])
        expect(items.length, `${h.company_name} / ${kind}`).toBe(Number(n))
      }
    }
  })

  test('a consultant cannot open a rival’s, or their own', async () => {
    // Consultant health names firms and ranks them. It is refused rather than
    // returned empty: empty would read as "that firm has nothing outstanding".
    const msg = await refused(() => asUser(w.cara, (c) =>
      c.query('select * from company_items($1,$2,$3)', [w.project, w.caraCo, 'open'])))
    expect(msg).toMatch(/internal to the contractor/i)
  })
})

describe('the appointments bar opens its bucket', () => {
  test('each bucket lists exactly the companies it counted', async () => {
    const bar = await rows<{ state: string; companies: number }>(
      w.boss, 'select * from appointment_summary($1)', [w.project])
    for (const b of bar) {
      const items = await rows(w.boss, 'select * from appointment_companies($1,$2)',
        [w.project, b.state])
      expect(items.length, b.state).toBe(Number(b.companies))
    }
  })
})

describe('no figure carries a character the transport can corrupt', () => {
  test('labels, values and tails are plain ASCII', async () => {
    // A pound sign or an em dash written in SQL reaches the database already
    // mangled when the migration is pasted through a client that guesses the
    // encoding, and the dashboard then prints the mangling. Currency is a
    // rendering decision: `unit` says money, and the client formats it.
    for (const audience of ['internal', 'client']) {
      const metrics = await rows<Metric & { unit: string | null }>(w.boss,
        'select * from report_metrics($1,$2)', [w.project, audience])
      for (const m of metrics) {
        const text = [m.value, m.label, m.tail].filter(Boolean).join(' ')
        // eslint-disable-next-line no-control-regex
        expect(/^[\x20-\x7E]*$/.test(text), `${audience}: ${text}`).toBe(true)
      }
    }
  })

  test('a money figure is a number, not a formatted string', async () => {
    const metrics = await rows<Metric & { unit: string | null }>(w.boss,
      `select * from report_metrics($1,'internal')`, [w.project])
    const money = metrics.filter((m) => m.unit === 'money')
    expect(money.length).toBeGreaterThan(0)
    for (const m of money) expect(Number.isFinite(Number(m.value))).toBe(true)
  })
})

/**
 * A remark becomes a task that remembers where it was made.
 *
 * The point of putting a discussion on every record is that the thing said
 * there becomes the thing done. Two properties make that worth having, and
 * both are easy to lose: the task has to carry the remark and point back at
 * the record, and it has to say which register it came out of — otherwise a
 * task raised on a building control item and one typed into the issues tab are
 * indistinguishable, and the list cannot be filtered by the thing that made
 * raising it there worthwhile.
 */
describe('a discussion post becomes a task that knows where it came from', () => {
  test('the remark and the task are one write', async () => {
    const item = await rows<{ id: string }>(w.boss,
      `select id from tracked_items where project_id = $1 and kind = 'bc' limit 1`,
      [w.project])
    expect(item.length).toBe(1)

    const out = (await rows<{ discuss_and_raise: {
      ok: boolean; id: string; reference: string; comment_id: string
    } }>(w.boss,
      `select discuss_and_raise($1,'bc',$2,$3,$4)`,
      [w.project, item[0].id, 'The survey has not come back, so this is stuck',
       'Chase the intrusive survey']))[0].discuss_and_raise

    expect(out.ok).toBe(true)
    expect(out.reference).toMatch(/^TSK-/)

    const issue = await rows<{
      category: string; origin_entity: string; origin_id: string
      origin_comment_id: string; description: string
    }>(w.boss,
      `select category, origin_entity, origin_id, origin_comment_id, description
       from issues where id = $1`, [out.id])

    // Where it came from, as three separate facts: the register, the row, and
    // the remark itself.
    expect(issue[0].origin_entity).toBe('bc')
    expect(issue[0].origin_id).toBe(item[0].id)
    expect(issue[0].origin_comment_id).toBe(out.comment_id)
    // The remark is the description rather than being retyped, or the two say
    // different things about the same problem within a minute of each other.
    expect(issue[0].description).toBe('The survey has not come back, so this is stuck')
    expect(issue[0].category).toBe('Building control')

    // And the comment is on the record, where somebody reading the item finds it.
    const c = await rows<{ body: string; entity_type: string }>(w.boss,
      'select body, entity_type from comments where id = $1', [out.comment_id])
    expect(c[0].entity_type).toBe('bc')
  })

  test('an empty remark raises nothing, rather than a task with no context', async () => {
    const item = await rows<{ id: string }>(w.boss,
      `select id from tracked_items where project_id = $1 and kind = 'bc' limit 1`,
      [w.project])
    const msg = await refused(() => asUser(w.boss, (c) =>
      c.query(`select discuss_and_raise($1,'bc',$2,'   ','A title')`,
        [w.project, item[0].id])))
    expect(msg).toMatch(/needs something in it/i)
  })

  test('the category names the checklist, not just "a checklist"', async () => {
    // "Handover checklist" is a filter somebody would use; "checklist" is one
    // that returns four registers at once.
    const cat = await rows<{ discussion_category: string }>(w.boss,
      `select discussion_category('checklist:handover')`)
    expect(cat[0].discussion_category).toBe('Handover checklist')
  })

  test('the filter offers only categories that have something behind them', async () => {
    const cats = await rows<{ category: string; open_items: number; total: number }>(
      w.boss, 'select * from issue_categories($1)', [w.project])
    expect(cats.length).toBeGreaterThan(0)
    for (const c of cats) {
      expect(Number(c.total)).toBeGreaterThan(0)
      const n = await rows<{ n: string }>(w.boss,
        'select count(*) as n from v_issues where project_id = $1 and category = $2',
        [w.project, c.category])
      expect(Number(n[0].n)).toBe(Number(c.total))
    }
  })

  test('a task typed into the issues tab still has no origin', async () => {
    // The three new parameters are defaulted, and a task raised here did not
    // come out of a register — pretending otherwise would put it in a filter
    // it does not belong to.
    const out = (await rows<{ raise_issue: { id: string } }>(w.boss,
      `select raise_issue($1,'Typed straight in')`, [w.project]))[0].raise_issue
    const issue = await rows<{ category: string | null; origin_entity: string | null }>(
      w.boss, 'select category, origin_entity from issues where id = $1', [out.id])
    expect(issue[0].origin_entity).toBeNull()
    expect(issue[0].category).toBeNull()
  })
})
