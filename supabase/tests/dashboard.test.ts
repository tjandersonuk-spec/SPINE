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

type Metric = { sort_order: number; value: string; label: string; alert: boolean; tail: string | null }

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
