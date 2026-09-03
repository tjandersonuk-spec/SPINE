/**
 * Phase 12 — the commercial tier.
 *
 * The assertions TASKS.md names, ported from `changereq.js`, `newmodules.js`
 * and the risk sections of `bsa.js`, plus the rules each module exists to
 * enforce: proposed and approved are never one figure, exposure is expected
 * value, ownership of a warranty is a query, a decided submission round is
 * frozen, and approval is not implementation.
 *
 * The RLS here is the sharpest in the product, so most of these run as a
 * consultant rather than as an admin: what a rival cannot see is the point.
 */
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { Client } from 'pg'
import { asSuperuser, asUser, makePerson, refused } from './db'

type World = {
  admin: string; internal: string; cara: string; rival: string
  client: string; outsider: string
  org: string; project: string
  bel: string; ngt: string; sub: string
  drmA: string
}
let w: World

const denied = (who: string, sql: string, params: unknown[] = []) =>
  refused(() => asUser(who, (c) => c.query(sql, params)))
const num = (v: unknown) => Number(v)
const rows = <T = Record<string, unknown>>(who: string, sql: string, params: unknown[] = []) =>
  asUser(who, (c) => c.query(sql, params)).then((r) => r.rows as T[])
const one = async <T = Record<string, unknown>>(
  who: string, sql: string, params: unknown[] = [],
) => (await rows<T>(who, sql, params))[0]

beforeAll(async () => {
  w = await asSuperuser(async (c: Client) => {
    const admin = await makePerson(c, 'Ada Admin', 'p12-ada@hbc.example')
    const internal = await makePerson(c, 'Ian Internal', 'p12-ian@hbc.example')
    const cara = await makePerson(c, 'Cara Consultant', 'p12-cara@bel.example')
    const rival = await makePerson(c, 'Rhys Rival', 'p12-rhys@ngt.example')
    const client = await makePerson(c, 'Cleo Client', 'p12-cleo@client.example')
    const outsider = await makePerson(c, 'Otto Outside', 'p12-otto@elsewhere.example')

    const org = (await c.query(
      `insert into organisations (name, slug, status) values ('HBC12','hbc12','active')
       returning id`)).rows[0].id
    const project = (await c.query(
      `insert into projects (organisation_id, name, code) values ($1,'Brackenfield','BRK12')
       returning id`, [org])).rows[0].id

    // A consultant reaches their project company through the account's
    // catalogue, which is what organisation_members.company_id references --
    // so the fixture builds both, the way the product does.
    const cat = async (name: string) => (await c.query(
      `insert into catalogue_companies (organisation_id, name, company_type)
       values ($1,$2,'consultant') returning id`, [org, name])).rows[0].id
    const catBel = await cat('Bellweather')
    const catNgt = await cat('Northgate')
    const catSub = await cat('Substrata')

    const mk = async (name: string, code: string, catalogue: string, parent?: string) =>
      (await c.query(
        `insert into companies
           (project_id, name, originator_code, company_type, catalogue_company_id, parent_id)
         values ($1,$2,$3,'consultant',$4,$5) returning id`,
        [project, name, code, catalogue, parent ?? null])).rows[0].id
    const bel = await mk('Bellweather', 'BEL', catBel)
    const ngt = await mk('Northgate', 'NGT', catNgt)
    // A specialist appointed UNDER Bellweather: my_company_tree() recurses, so
    // Cara is answerable for its fees and must see them.
    const sub = await mk('Substrata', 'SUB', catSub, bel)

    for (const [p, role, co] of [
      [admin, 'admin', null], [internal, 'internal', null],
      [cara, 'consultant', catBel], [rival, 'consultant', catNgt],
      [client, 'client', null],
    ] as const) {
      await c.query(
        `insert into organisation_members (organisation_id, profile_id, role, company_id)
         values ($1,$2,$3,$4)`, [org, p, role, co])
    }
    for (const p of [cara, rival, client]) {
      await c.query(
        `insert into project_members (project_id, profile_id, project_role)
         values ($1,$2,'member')`, [project, p])
    }

    // Bellweather holds A; nobody holds S. A warranty on an S-led item is the
    // unallocated case.
    await c.query(
      `insert into company_disciplines (company_id, discipline_code)
       values ($1,'A'), ($2,'M')`, [bel, ngt])
    const drmA = (await c.query(
      `insert into drm_items (project_id, ref, category_code, item, lead_discipline)
       values ($1,'04.060','04','Roof covering','A') returning id`, [project])).rows[0].id
    await c.query(
      `insert into drm_items (project_id, ref, category_code, item, lead_discipline)
       values ($1,'05.010','05','Structural frame','S')`, [project])

    // A programme, so the anchored dates resolve.
    await c.query(
      `insert into programme_tasks
         (project_id, task_uid, description, start_date, finish_date, level, task_type)
       values ($1,'1100','Stage 4 design','2026-01-05','2026-03-27',1,'Task'),
              ($1,'1200','Construction','2026-04-06','2026-12-18',1,'Task')`, [project])

    return { admin, internal, cara, rival, client, outsider, org, project, bel, ngt, sub, drmA }
  })
})

/** A clean commercial slate before each test. */
beforeEach(async () => {
  await asSuperuser(async (c: Client) => {
    await c.query('delete from invoices where project_id = $1', [w.project])
    await c.query('delete from payment_schedule where project_id = $1', [w.project])
    await c.query('update change_requests set variation_id = null where project_id = $1',
      [w.project])
    await c.query('delete from fees where project_id = $1', [w.project])
    await c.query('delete from risks where project_id = $1', [w.project])
    await c.query('delete from materials where project_id = $1', [w.project])
    await c.query('delete from warranties where project_id = $1', [w.project])
    await c.query('delete from precon_budget where project_id = $1', [w.project])
    await c.query('delete from change_requests where project_id = $1', [w.project])
  })
})

/* ------------------------------------------------------------------ fees */

async function fee(
  company: string, kind: 'fee' | 'variation', value: number,
  status: 'Proposed' | 'Approved' | 'Rejected' = 'Proposed', ref?: string,
) {
  return asSuperuser((c) => c.query(
    `insert into fees (project_id, company_id, reference, kind, value, status, date_approved)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [w.project, company, ref ?? `${kind === 'fee' ? 'FEE' : 'VAR'}-${Math.random().toString(36).slice(2, 7)}`,
     kind, value, status, status === 'Approved' ? '2026-02-01' : null])
    .then((r) => r.rows[0].id as string))
}

describe('fees', () => {
  test('proposed and approved are never one figure', async () => {
    await fee(w.bel, 'fee', 100000, 'Approved')
    await fee(w.bel, 'variation', 15000, 'Approved')
    await fee(w.bel, 'variation', 40000, 'Proposed')

    const p = await one(w.admin,
      'select * from fee_position($1) where company_id = $2', [w.project, w.bel])
    expect(num(p.fee_approved)).toBe(100000)
    expect(num(p.variations_approved)).toBe(15000)
    expect(num(p.variations_proposed)).toBe(40000)
    // The approved total is the two approved figures and nothing else. A
    // report that mixed the proposed forty thousand in would read as 155,000
    // committed, which is not true of a penny of it.
    expect(num(p.approved_total)).toBe(115000)
  })

  test('an approved fee has an approval date and only an approved one does', async () => {
    expect(await refused(() => asSuperuser((c) => c.query(
      `insert into fees (project_id, company_id, reference, kind, value, status)
       values ($1,$2,'BAD-1','fee',10,'Approved')`, [w.project, w.bel]))))
      .toMatch(/fee_approval_is_whole/)
    expect(await refused(() => asSuperuser((c) => c.query(
      `insert into fees (project_id, company_id, reference, kind, value, status, date_approved)
       values ($1,$2,'BAD-2','fee',10,'Proposed','2026-01-01')`, [w.project, w.bel]))))
      .toMatch(/fee_approval_is_whole/)
  })

  test('a consultant proposes their own fee but cannot approve it', async () => {
    const f = await fee(w.bel, 'fee', 50000)
    // The status is outside the update grant, so the column write is refused...
    expect(await denied(w.cara, `update fees set status = 'Approved' where id = $1`, [f]))
      .toMatch(/permission denied/i)
    // ...and so is the function, which is the path that would look legitimate.
    expect(await denied(w.cara, 'select approve_fee($1, true)', [f]))
      .toMatch(/Not permitted/)
    await asUser(w.admin, (c) => c.query('select approve_fee($1, true)', [f]))
    const r = await one(w.admin, 'select status, date_approved from fees where id = $1', [f])
    expect(r.status).toBe('Approved')
    expect(r.date_approved).not.toBeNull()
  })

  test('a consultant sees their own company tree and not a rival', async () => {
    await fee(w.bel, 'fee', 100000, 'Approved', 'FEE-BEL')
    await fee(w.ngt, 'fee', 250000, 'Approved', 'FEE-NGT')
    await fee(w.sub, 'fee', 30000, 'Approved', 'FEE-SUB')

    const mine = await rows(w.cara, 'select reference from fees order by reference')
    // Bellweather's own, and the specialist it appointed underneath — a firm
    // is answerable for the fees of the people it brought on.
    expect(mine.map((r) => r.reference)).toEqual(['FEE-BEL', 'FEE-SUB'])

    const theirs = await rows(w.rival, 'select reference from fees order by reference')
    expect(theirs.map((r) => r.reference)).toEqual(['FEE-NGT'])

    // And the derived function is scoped by the same policy, because it is
    // security invoker over the same tables. A CSV endpoint that bypassed this
    // is how a consultant learns what a competitor charges.
    const pos = await rows(w.cara, 'select company_name from fee_position($1)', [w.project])
    expect(pos.map((r) => r.company_name).sort()).toEqual(['Bellweather', 'Substrata'])

    // Host staff and the client see the whole picture.
    expect((await rows(w.admin, 'select 1 from fees')).length).toBe(3)
    expect((await rows(w.client, 'select 1 from fees')).length).toBe(3)
    expect((await rows(w.outsider, 'select 1 from fees')).length).toBe(0)
  })
})

/* ---------------------------------------------------- payment schedule */

async function instalment(company: string, value: number, uid: string | null, offset = 0) {
  return asSuperuser((c) => c.query(
    `insert into payment_schedule
       (project_id, company_id, reference, value, programme_task_uid, offset_days)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [w.project, company, 'PS-' + Math.random().toString(36).slice(2, 7), value, uid, offset])
    .then((r) => r.rows[0].id as string))
}

describe('the payment schedule', () => {
  test('no instalment date is stored — it comes off the programme', async () => {
    const i = await instalment(w.bel, 20000, '1100', 0)
    expect((await one(w.admin, 'select due from v_payment_schedule where id = $1', [i])).due)
      .toEqual(new Date('2026-03-27T00:00:00.000Z'))

    // Reschedule the line. Nothing is written to payment_schedule at all.
    await asSuperuser((c) => c.query(
      `update programme_tasks set finish_date = '2026-05-15'
        where project_id = $1 and task_uid = '1100'`, [w.project]))
    expect((await one(w.admin, 'select due from v_payment_schedule where id = $1', [i])).due)
      .toEqual(new Date('2026-05-15T00:00:00.000Z'))
    await asSuperuser((c) => c.query(
      `update programme_tasks set finish_date = '2026-03-27'
        where project_id = $1 and task_uid = '1100'`, [w.project]))
  })

  test('agreement is stored, with who and when; the rest stays derived', async () => {
    const i = await instalment(w.bel, 20000, '1100')
    expect(await denied(w.cara,
      `update payment_schedule set status = 'Agreed' where id = $1`, [i]))
      .toMatch(/permission denied/i)
    expect(await denied(w.cara, 'select agree_payment_schedule($1,$2)', [w.project, w.bel]))
      .toMatch(/Not permitted/)

    const n = await one(w.admin,
      'select agree_payment_schedule($1,$2) as n', [w.project, w.bel])
    expect(num(n.n)).toBe(1)
    const r = await one(w.admin, 'select * from payment_schedule where id = $1', [i])
    expect(r.status).toBe('Agreed')
    expect(r.agreed_by).toBe(w.admin)
    expect(r.agreed_at).not.toBeNull()
  })

  test('agreed by nobody at no time is refused', async () => {
    expect(await refused(() => asSuperuser((c) => c.query(
      `insert into payment_schedule (project_id, company_id, reference, value, status)
       values ($1,$2,'PS-BAD',1000,'Agreed')`, [w.project, w.bel]))))
      .toMatch(/schedule_agreement_is_whole/)
  })

  test('a proposed instalment still counts in the planned curve', async () => {
    await instalment(w.bel, 30000, '1100')       // Proposed
    const agreed = await instalment(w.bel, 10000, '1100')
    await asUser(w.admin, (c) =>
      c.query('select agree_payment_schedule($1,$2,$3)', [w.project, w.bel, [agreed]]))

    const curve = await rows(w.admin, 'select * from cashflow_curve($1,$2)', [w.project, w.bel])
    expect(curve).toHaveLength(1)
    // Both count in the planned curve — leaving the un-agreed one out would
    // make the curve optimistic — and the agreed subtotal is carried
    // separately so the optimism is visible rather than assumed.
    expect(num(curve[0].planned)).toBe(40000)
    expect(num(curve[0].planned_agreed)).toBe(10000)

    const p = await one(w.admin,
      'select * from fee_position($1) where company_id = $2', [w.project, w.bel])
    expect(num(p.scheduled)).toBe(40000)
    expect(num(p.scheduled_proposed)).toBe(30000)
    expect(p.instalments_unagreed).toBe(1)
  })

  test('the two silent checks', async () => {
    // One: an instalment whose date has passed with nothing claimed.
    const past = await instalment(w.bel, 20000, null)
    await asSuperuser((c) => c.query(
      `update payment_schedule set due_date_override = '2020-01-01' where id = $1`, [past]))
    let s = await one(w.admin, 'select * from v_payment_schedule where id = $1', [past])
    expect(s.due_uninvoiced).toBe(true)
    expect(num(s.invoiced)).toBe(0)

    await asSuperuser((c) => c.query(
      `insert into invoices (project_id, company_id, schedule_id, reference, value, date_submitted)
       values ($1,$2,$3,'INV-1',20000,'2020-02-01')`, [w.project, w.bel, past]))
    s = await one(w.admin, 'select * from v_payment_schedule where id = $1', [past])
    expect(s.due_uninvoiced).toBe(false)
    expect(num(s.invoiced)).toBe(20000)

    // Two: the schedule does not add up to the approved fee. Almost always an
    // approved variation nobody added to the schedule.
    await fee(w.bel, 'fee', 100000, 'Approved')
    await fee(w.bel, 'variation', 15000, 'Approved')
    const p = await one(w.admin,
      'select * from fee_position($1) where company_id = $2', [w.project, w.bel])
    expect(num(p.approved_total)).toBe(115000)
    expect(num(p.scheduled)).toBe(20000)
    expect(num(p.schedule_gap)).toBe(-95000)
  })

  test('an invoice cannot be mapped to another company’s instalment', async () => {
    const theirs = await instalment(w.ngt, 20000, '1100')
    expect(await refused(() => asSuperuser((c) => c.query(
      `insert into invoices (project_id, company_id, schedule_id, reference, value, date_submitted)
       values ($1,$2,$3,'INV-X',20000,'2026-01-01')`, [w.project, w.bel, theirs]))))
      .toMatch(/invoice_schedule_matches_company/)
  })
})

describe('invoices', () => {
  test('a claimant cannot certify their own invoice', async () => {
    const i = await asSuperuser((c) => c.query(
      `insert into invoices (project_id, company_id, reference, value, date_submitted)
       values ($1,$2,'INV-2',5000,'2026-01-05') returning id`, [w.project, w.bel])
      .then((r) => r.rows[0].id))
    expect(await denied(w.cara, `update invoices set status = 'Certified' where id = $1`, [i]))
      .toMatch(/permission denied/i)
    expect(await denied(w.cara, `select certify_invoice($1,'Certified')`, [i]))
      .toMatch(/Not permitted/)
    await asUser(w.admin, (c) => c.query(`select certify_invoice($1,'Paid')`, [i]))
    const r = await one(w.admin, 'select * from invoices where id = $1', [i])
    expect(r.status).toBe('Paid')
    expect(r.date_paid).not.toBeNull()
    expect(r.certified_by).toBe(w.admin)
  })

  test('an invoice with no document held is flagged', async () => {
    const i = await asSuperuser((c) => c.query(
      `insert into invoices (project_id, company_id, reference, value, date_submitted)
       values ($1,$2,'INV-3',5000,'2026-01-05') returning id`, [w.project, w.bel])
      .then((r) => r.rows[0].id))
    expect((await one(w.admin, 'select has_document from v_invoices where id = $1', [i]))
      .has_document).toBe(false)
    await asSuperuser((c) => c.query(
      `insert into evidence (project_id, entity_type, entity_id, name)
       values ($1,'invoice',$2,'Application 3.pdf')`, [w.project, i]))
    expect((await one(w.admin, 'select has_document from v_invoices where id = $1', [i]))
      .has_document).toBe(true)
  })
})

/* -------------------------------------------------------------- precon */

describe('the pre-construction budget', () => {
  const line = async (ref: string, budget: number, category = 'consultant') =>
    asSuperuser((c) => c.query(
      `insert into precon_budget (project_id, reference, category, title, budget)
       values ($1,$2,$3,'A line',$4) returning id`, [w.project, ref, category, budget])
      .then((r) => r.rows[0].id as string))

  const quote = async (lineId: string, supplier: string, base: number) =>
    asSuperuser((c) => c.query(
      `insert into precon_quotes (project_id, budget_line_id, supplier, base_value)
       values ($1,$2,$3,$4) returning id`, [w.project, lineId, supplier, base])
      .then((r) => r.rows[0].id as string))

  test('host staff only, and that includes the consultant who quoted into it', async () => {
    await line('PB-001', 40000)
    expect((await rows(w.admin, 'select 1 from precon_budget')).length).toBe(1)
    expect((await rows(w.internal, 'select 1 from precon_budget')).length).toBe(1)
    // Cara's firm may well be one of the quotes in here. She still cannot see it.
    expect((await rows(w.cara, 'select 1 from precon_budget')).length).toBe(0)
    // Nor the client: what the contractor forecast for its own consultants is
    // not the client's business.
    expect((await rows(w.client, 'select 1 from precon_budget')).length).toBe(0)
  })

  test('a project admin is not enough, because they may be the bidder', async () => {
    await asSuperuser((c) => c.query(
      `update project_members set project_role = 'project_admin'
        where project_id = $1 and profile_id = $2`, [w.project, w.cara]))
    await line('PB-002', 10000)
    expect((await rows(w.cara, 'select 1 from precon_budget')).length).toBe(0)
    expect(await denied(w.cara,
      `insert into precon_budget (project_id, reference, category, title)
       values ($1,'PB-X','survey','Sneaky')`, [w.project])).toMatch(/policy/i)
    await asSuperuser((c) => c.query(
      `update project_members set project_role = 'member'
        where project_id = $1 and profile_id = $2`, [w.project, w.cara]))
  })

  test('adjustments level the comparison and require a label', async () => {
    const l = await line('PB-003', 30000)
    const a = await quote(l, 'Groundsure', 24000)
    const b = await quote(l, 'Terra Firma', 27500)

    // Twelve boreholes against fourteen, and no interpretative report.
    await asSuperuser((c) => c.query(
      `insert into precon_quote_adjustments (quote_id, label, value)
       values ($1,'Two further boreholes to match the scope',3200),
              ($1,'Interpretative report, excluded',1800)`, [a]))

    const qs = await rows(w.admin,
      `select source_name, base_value, adjustments, levelled_value, adjustment_count
         from v_precon_quotes where budget_line_id = $1 order by source_name`, [l])
    expect(qs.map((q) => [q.source_name, num(q.base_value), num(q.levelled_value)]))
      .toEqual([['Groundsure', 24000, 29000], ['Terra Firma', 27500, 27500]])
    // The submitted figure is kept: "what did they actually quote" is a
    // different question from "what is comparable", and the cheapest
    // submission is no longer the cheapest once levelled.
    expect(qs[0].adjustment_count).toBe(2)

    // A plugged number with no explanation is worse than no adjustment.
    expect(await refused(() => asSuperuser((c) => c.query(
      `insert into precon_quote_adjustments (quote_id, label, value) values ($1,'   ',500)`,
      [b])))).toMatch(/precon_quote_adjustments_label_check/)
  })

  test('the forecast follows the chosen quote, not the cheapest', async () => {
    const l = await line('PB-004', 30000)
    const a = await quote(l, 'Groundsure', 24000)
    await quote(l, 'Terra Firma', 27500)

    // Nothing chosen: the forecast is the budget, and the line is undecided.
    let b = await one(w.admin, 'select * from v_precon_budget where id = $1', [l])
    expect(num(b.forecast)).toBe(30000)
    expect(num(b.lowest_levelled)).toBe(24000)
    let t = await one(w.admin, 'select * from precon_totals($1)', [w.project])
    expect(t.undecided).toBe(1)

    await asUser(w.admin, (c) => c.query('select set_preferred_quote($1,$2)', [l, a]))
    b = await one(w.admin, 'select * from v_precon_budget where id = $1', [l])
    expect(num(b.forecast)).toBe(24000)
    expect(num(b.variance)).toBe(-6000)
    expect(b.preferred_source).toBe('Groundsure')
    t = await one(w.admin, 'select * from precon_totals($1)', [w.project])
    expect(t.undecided).toBe(0)
  })

  test('a preferred quote must be one of this line’s own', async () => {
    const l1 = await line('PB-005', 10000)
    const l2 = await line('PB-006', 10000)
    const q2 = await quote(l2, 'Elsewhere', 9000)
    expect(await denied(w.admin, 'select set_preferred_quote($1,$2)', [l1, q2]))
      .toMatch(/different budget line/)
  })

  test('a struck-out line leaves every total but stays on the page', async () => {
    const l = await line('PB-007', 25000)
    await line('PB-008', 15000)
    await asSuperuser((c) => c.query(
      'update precon_budget set required = false where id = $1', [l]))
    const t = await one(w.admin, 'select * from precon_totals($1)', [w.project])
    expect(t.lines).toBe(1)
    expect(t.struck_out).toBe(1)
    expect(num(t.budget)).toBe(15000)
    // Still there, which is what keeps the decision that it was not needed.
    expect((await rows(w.admin, 'select 1 from precon_budget')).length).toBe(2)
  })

  test('the one thread outwards is read from the fee side', async () => {
    const l = await line('PB-009', 40000)
    const f = await fee(w.bel, 'fee', 38000, 'Approved')
    await asSuperuser((c) => c.query(
      'update fees set budget_line_ids = array[$2::uuid] where id = $1', [f, l]))
    const b = await one(w.admin, 'select * from v_precon_budget where id = $1', [l])
    expect(b.appointed_fees).toBe(1)
    expect(num(b.appointed_approved)).toBe(38000)
  })
})

/* ---------------------------------------------------------------- risks */

async function risk(patch: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    project_id: w.project, kind: 'risk',
    reference: 'RSK-' + Math.random().toString(36).slice(2, 7),
    title: 'A risk', likelihood: 3, impact_cost: 0, status: 'Open', raised_by: w.admin,
  }
  const rec = { ...base, ...patch }
  const keys = Object.keys(rec)
  return asSuperuser((c) => c.query(
    `insert into risks (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')})
     returning id`, keys.map((k) => rec[k])).then((r) => r.rows[0].id as string))
}

describe('the risk register', () => {
  test('the impact band is derived from the cost, never chosen', async () => {
    // The commonest argument in a risk workshop, removed: two people cannot
    // score the same eighty-thousand-pound item differently.
    for (const [cost, band, name] of [
      [9999, 1, 'Minor'], [10000, 2, 'Moderate'], [50000, 3, 'Significant'],
      [150000, 4, 'Major'], [500000, 5, 'Severe'],
    ] as [number, number, string][]) {
      const r = await one(w.admin,
        'select risk_impact_band($1) as b, risk_impact_name(risk_impact_band($1)) as n', [cost])
      expect([num(r.b), r.n]).toEqual([band, name])
    }
    // An opportunity's impact is a saving, and a saving of eighty thousand is
    // just as significant.
    expect(num((await one(w.admin, 'select risk_impact_band($1) as b', [-80000])).b)).toBe(3)
  })

  test('expected value is cost times likelihood, and zero once finished', async () => {
    const r = await risk({ likelihood: 4, impact_cost: 80000, person_id: w.admin })
    let v = await one(w.admin, 'select * from v_risks where id = $1', [r])
    expect(num(v.likelihood_pct)).toBeCloseTo(0.75, 10)
    expect(v.likelihood_name).toBe('Likely')
    expect(num(v.band)).toBe(3)
    expect(num(v.score)).toBe(12)
    expect(num(v.expected_value)).toBe(60000)

    await asSuperuser((c) => c.query(`update risks set status = 'Closed' where id = $1`, [r]))
    v = await one(w.admin, 'select * from v_risks where id = $1', [r])
    expect(v.done).toBe(true)
    // No longer exposure, so no longer expected value.
    expect(num(v.expected_value)).toBe(0)
  })

  test('the summary is expected value, never the raw total', async () => {
    await risk({ likelihood: 4, impact_cost: 80000, person_id: w.admin })
    await risk({ likelihood: 2, impact_cost: 200000, person_id: w.admin })
    const t = await one(w.admin, 'select * from risk_totals($1)', [w.project])
    expect(t.live).toBe(2)
    // 60,000 + 50,000. The raw total is 280,000 and is returned only so a page
    // can label it as what it is: what everything would cost if it all
    // happened. Adding those up and calling it exposure is how a risk report
    // stops being believed.
    expect(num(t.expected)).toBe(110000)
    expect(num(t.gross)).toBe(280000)
  })

  test('a risk and an opportunity have different vocabularies', async () => {
    const o = await risk({ kind: 'opportunity', status: 'Identified', impact_cost: 60000 })
    const v = await one(w.admin, 'select * from v_risks where id = $1', [o])
    expect(v.done).toBe(false)
    await asSuperuser((c) => c.query(
      `update risks set status = 'Implemented' where id = $1`, [o]))
    expect((await one(w.admin, 'select done from v_risks where id = $1', [o])).done).toBe(true)
    // A status from the other kind's list is refused.
    expect(await refused(() => asSuperuser((c) => c.query(
      `update risks set status = 'Mitigating' where id = $1`, [o]))))
      .toMatch(/risk_status_is_known/)
  })

  test('an unowned risk is a gap, and reads as one', async () => {
    const r = await risk({ likelihood: 5, impact_cost: 200000 })
    const v = await one(w.admin, 'select state, state_kind from v_risks where id = $1', [r])
    expect(v.state).toBe('Unowned')
    expect(v.state_kind).toBe('gap')
    const t = await one(w.admin, 'select * from risk_totals($1)', [w.project])
    expect(t.unowned).toBe(1)
  })

  test('the matrix returns every cell, and names the unowned cluster', async () => {
    await risk({ likelihood: 5, impact_cost: 600000 })                     // 5,5 unowned
    await risk({ likelihood: 5, impact_cost: 600000, person_id: w.admin })  // 5,5 owned
    await risk({ likelihood: 1, impact_cost: 100, person_id: w.admin })     // 1,1
    const m = await rows(w.admin, 'select * from risk_matrix($1)', [w.project])
    // A grid with holes in it cannot be read as a grid.
    expect(m).toHaveLength(25)
    const top = m.find((c) => num(c.likelihood) === 5 && num(c.band) === 5)!
    expect([top.items, top.unowned]).toEqual([2, 1])
  })

  test('closed by default: nobody but the raiser, the owner and the named', async () => {
    // The inverse of the task list, where an empty audience means everyone.
    const r = await risk({ raised_by: w.cara, person_id: w.rival, impact_cost: 90000 })
    expect((await rows(w.cara, 'select 1 from risks where id = $1', [r])).length).toBe(1)
    expect((await rows(w.rival, 'select 1 from risks where id = $1', [r])).length).toBe(1)
    // Admin overrides everything.
    expect((await rows(w.admin, 'select 1 from risks where id = $1', [r])).length).toBe(1)
    // `internal` gets NO risk override, which is the clause most easily
    // written one word too wide.
    expect((await rows(w.internal, 'select 1 from risks where id = $1', [r])).length).toBe(0)
    expect((await rows(w.client, 'select 1 from risks where id = $1', [r])).length).toBe(0)

    await asSuperuser((c) => c.query(
      `update risks set visibility = jsonb_build_object('mode','named','people',
         jsonb_build_array($2::text)) where id = $1`, [r, w.internal]))
    expect((await rows(w.internal, 'select 1 from risks where id = $1', [r])).length).toBe(1)
  })

  test('a realised risk becomes one task and points at it', async () => {
    const r = await risk({
      likelihood: 5, impact_cost: 600000, person_id: w.admin,
      mitigation: 'Chase the survey.', programme_task_uid: '1200',
    })
    const issue = (await one<{ realise_risk: string }>(
      w.admin, 'select realise_risk($1) as realise_risk', [r])).realise_risk

    const v = await one(w.admin, 'select * from v_risks where id = $1', [r])
    expect(v.status).toBe('Realised')
    expect(v.issue_id).toBe(issue)
    expect(v.state_kind).toBe('stop')

    const i = await one(w.admin, 'select * from issues where id = $1', [issue])
    expect(i.origin_entity).toBe('risk')
    expect(i.origin_id).toBe(r)
    // Score 25 of 25, so it arrives at the top of the queue.
    expect(num(i.priority)).toBe(100)
    // The mitigation travels, because the person picking the task up needs it.
    expect(String(i.description)).toMatch(/Chase the survey/)
    // The date came with it, still anchored rather than copied as a value.
    expect(i.programme_task_uid).toBe('1200')

    // Pressing the button twice must not produce two tasks for one risk.
    expect((await one<{ realise_risk: string }>(
      w.admin, 'select realise_risk($1) as realise_risk', [r])).realise_risk).toBe(issue)
    expect((await rows(w.admin,
      `select 1 from issues where origin_entity = 'risk' and origin_id = $1`, [r])).length)
      .toBe(1)

    // And the risk does not get an action list of its own: what it has is a
    // link to the one task.
    expect((await one(w.admin, 'select issue_reference from v_risks where id = $1', [r]))
      .issue_reference).toBe(i.reference)
  })

  test('realised without a task is refused outright', async () => {
    const r = await risk()
    expect(await refused(() => asSuperuser((c) => c.query(
      `update risks set status = 'Realised' where id = $1`, [r]))))
      .toMatch(/risk_realised_has_a_task/)
  })

  test('an opportunity is implemented, not realised', async () => {
    const o = await risk({ kind: 'opportunity', status: 'Accepted' })
    expect(await denied(w.admin, 'select realise_risk($1)', [o]))
      .toMatch(/implemented, not realised/)
  })

  test('the library loads with no owner and no date', async () => {
    // The fixtures belong to this account rather than the published set: the
    // loader reads "the account's fork, or the published default if it has
    // none", so an account with its own two rows never sees the shipped
    // thirty-four and the counts below mean what they say.
    await asSuperuser((c) => c.query(
      `insert into risk_templates (organisation_id, reference, kind, title, category, likelihood)
       values ($1,'RT-01','risk','Late statutory approval','Statutory',4),
              ($1,'RT-02','opportunity','Reuse site-won material','Ground',3)`, [w.org]))
    const r = await one(w.admin, 'select * from load_risk_library($1)', [w.project])
    expect([r.added, r.skipped]).toEqual([2, 0])

    const loaded = await rows(w.admin,
      'select * from v_risks where project_id = $1 order by kind', [w.project])
    expect(loaded).toHaveLength(2)
    for (const x of loaded) {
      // A loader that guessed an owner or a review date would be inventing a
      // decision somebody has to be accountable for.
      expect(x.person_id).toBeNull()
      expect(x.programme_task_uid).toBeNull()
      expect(x.due_date_override).toBeNull()
      expect(num(x.impact_cost)).toBe(0)
    }
    expect(loaded.map((x) => x.status)).toEqual(['Identified', 'Open'])
    expect(loaded.map((x) => String(x.reference).split('-')[0])).toEqual(['OPP', 'RSK'])

    // Skip on title match, like every other template loader here.
    const again = await one(w.admin, 'select * from load_risk_library($1)', [w.project])
    expect([again.added, again.skipped]).toEqual([0, 2])
    await asSuperuser((c) => c.query(
      'delete from risk_templates where organisation_id = $1', [w.org]))
  })
})

/* ------------------------------------------------------ change requests */

async function change(patch: Record<string, unknown> = {}) {
  const ref = 'CHG-' + Math.random().toString(36).slice(2, 7)
  return asSuperuser(async (c: Client) => {
    const id = (await c.query(
      `insert into change_requests (project_id, reference, title, raised_by)
       values ($1,$2,'A change',$3) returning id`, [w.project, ref, w.admin])).rows[0].id
    const keys = Object.keys(patch)
    if (keys.length) {
      await c.query(`update change_requests set ${
        keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`,
        [id, ...keys.map((k) => patch[k])])
    }
    return id as string
  })
}

const item = (changeId: string, description: string) =>
  asSuperuser((c) => c.query(
    `insert into change_request_items (change_request_id, entity_type, description)
     values ($1,'other',$2) returning id`, [changeId, description])
    .then((r) => r.rows[0].id as string))

describe('approval is not implementation', () => {
  test('implemented is refused while an amendment is outstanding', async () => {
    const cr = await change({ status: 'Approved' })
    const a = await item(cr, 'Revise the GA drawings')
    await item(cr, 'Update the room data sheets')

    expect(await denied(w.admin, `select set_change_status($1,'Implemented')`, [cr]))
      .toMatch(/2 of 2 amendment\(s\) are still outstanding/)

    await asUser(w.admin, (c) => c.query('select tick_change_item($1,true)', [a]))
    expect(await denied(w.admin, `select set_change_status($1,'Implemented')`, [cr]))
      .toMatch(/1 of 2/)
  })

  test('approved with nothing listed is flagged, and cannot be implemented', async () => {
    const cr = await change({ status: 'Approved' })
    const v = await one(w.admin, 'select * from v_change_requests where id = $1', [cr])
    expect(v.approved_with_nothing_listed).toBe(true)
    expect(v.amendments).toBe(0)
    // Either the list was never filled in or the change alters nothing, and
    // both need somebody to say which.
    expect(await denied(w.admin, `select set_change_status($1,'Implemented')`, [cr]))
      .toMatch(/Nothing is listed as needing amendment/)

    const gap = await rows(w.admin, 'select * from change_implementation_gap($1)', [w.project])
    expect(gap.map((g) => g.nothing_listed)).toEqual([true])
  })

  test('un-ticking an item knocks the status back from implemented', async () => {
    const cr = await change({ status: 'Approved' })
    const a = await item(cr, 'Revise the GA drawings')
    await asUser(w.admin, (c) => c.query('select tick_change_item($1,true)', [a]))
    await asUser(w.admin, (c) => c.query(`select set_change_status($1,'Implemented')`, [cr]))
    expect((await one(w.admin, 'select status from change_requests where id = $1', [cr])).status)
      .toBe('Implemented')

    await asUser(w.admin, (c) => c.query('select tick_change_item($1,false)', [a]))
    // A change marked implemented on the strength of a tick that turns out to
    // be wrong is not implemented.
    expect((await one(w.admin, 'select status from change_requests where id = $1', [cr])).status)
      .toBe('Approved')
    const i = await one(w.admin, 'select * from change_request_items where id = $1', [a])
    expect(i.done_at).toBeNull()
    expect(i.done_by).toBeNull()
  })

  test('who ticked an item is not writable', async () => {
    const cr = await change({ status: 'Approved' })
    const a = await item(cr, 'Revise the GA drawings')
    expect(await denied(w.cara,
      `update change_request_items set done_at = now(), done_by = $2 where id = $1`,
      [a, w.cara])).toMatch(/permission denied/i)
    await asUser(w.cara, (c) => c.query('select tick_change_item($1,true)', [a]))
    expect((await one(w.admin, 'select done_by from change_request_items where id = $1', [a]))
      .done_by).toBe(w.cara)
  })

  test('a consultant cannot approve a change request', async () => {
    const cr = await change({ status: 'Submitted' })
    expect(await denied(w.cara, `select set_change_status($1,'Approved')`, [cr]))
      .toMatch(/Not permitted to decide/)
    // The status column is outside the grant too, so the direct write fails
    // as well as the function.
    expect(await denied(w.cara, `update change_requests set status = 'Approved' where id = $1`,
      [cr])).toMatch(/permission denied/i)
  })

  test('the register holds no money — it points at a variation', async () => {
    const v = await fee(w.bel, 'variation', 12500, 'Approved')
    const cr = await change({ status: 'Approved', variation_id: v, impact_cost: 'Increase' })
    const row = await one(w.admin, 'select * from v_change_requests where id = $1', [cr])
    expect(num(row.variation_value)).toBe(12500)
    expect(row.variation_status).toBe('Approved')
    expect(row.approved_without_a_variation).toBe(false)

    // A base fee is not a variation: pointing at one would put the whole
    // appointment on a single change request.
    const base = await fee(w.bel, 'fee', 90000, 'Approved')
    expect(await refused(() => asSuperuser((c) => c.query(
      'update change_requests set variation_id = $2 where id = $1', [cr, base]))))
      .toMatch(/variation_is_a_variation/)
  })

  test('approved with a cost expectation and no variation is flagged', async () => {
    const cr = await change({ status: 'Approved', impact_cost: 'Increase' })
    expect((await one(w.admin,
      'select approved_without_a_variation from v_change_requests where id = $1', [cr]))
      .approved_without_a_variation).toBe(true)
  })

  test('a decision due after the change takes effect is reported, not blocked', async () => {
    // Sometimes that is genuinely the situation, and refusing the save would
    // only mean the dates get fudged into something that reads as fine.
    const cr = await change({
      decision_task_uid: '1200', decision_anchor: 'finish',
      effective_task_uid: '1100', effective_anchor: 'finish',
    })
    const v = await one(w.admin, 'select * from v_change_requests where id = $1', [cr])
    expect(v.decision_after_effective).toBe(true)
    expect(v.decision_due).not.toBeNull()
  })

  test('nothing acts on approval', async () => {
    // No trigger may edit a drawing, a scope row or anything else when a
    // change is approved: an automatic edit is a second source of truth
    // arriving with nobody reading it.
    const t = await rows(w.admin, `
      select tgname, c.relname
      from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      where not tg.tgisinternal
        and c.relname in ('change_requests','change_request_items')`)
    expect(t).toEqual([])
  })
})

/* ---------------------------------------------------------- warranties */

describe('warranties', () => {
  const warranty = async (ref: string, drmRef: string | null) =>
    asSuperuser((c) => c.query(
      `insert into warranties (project_id, reference, drm_ref, title)
       values ($1,$2,$3,'A warranty') returning id`, [w.project, ref, drmRef])
      .then((r) => r.rows[0].id as string))

  test('there is no company_id column, and this is the test that says so', async () => {
    const cols = await rows(w.admin, `
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'warranties'`)
    // The next engineer's instinct is to normalise the owner into a column.
    // That would silently reintroduce an owner that goes stale the moment the
    // matrix changes, which is the whole thing this design avoids.
    expect(cols.map((c) => c.column_name)).not.toContain('company_id')
  })

  test('the owner is resolved live through the DRM lead discipline', async () => {
    const wy = await warranty('WTY-001', '04.060')
    expect((await rows(w.admin, 'select * from warranty_owner($1)', [wy]))
      .map((r) => r.company_name)).toEqual(['Bellweather'])

    // Reassign the matrix. No write to warranties at all.
    await asSuperuser((c) => c.query(
      `update drm_items set lead_discipline = 'M' where project_id = $1 and ref = '04.060'`,
      [w.project]))
    expect((await rows(w.admin, 'select * from warranty_owner($1)', [wy]))
      .map((r) => r.company_name)).toEqual(['Northgate'])
    await asSuperuser((c) => c.query(
      `update drm_items set lead_discipline = 'A' where project_id = $1 and ref = '04.060'`,
      [w.project]))
  })

  test('no owner is an absence, and it is the same gap the matrix shows', async () => {
    // Nobody on this project holds S.
    const wy = await warranty('WTY-002', '05.010')
    expect(await rows(w.admin, 'select * from warranty_owner($1)', [wy])).toEqual([])
    const v = await one(w.admin, 'select * from v_warranties where id = $1', [wy])
    expect(v.unallocated).toBe(true)
    expect(v.owners).toEqual([])
    expect(v.holders).toBe(0)

    // A warranty linked to nothing at all is unallocated too.
    const orphan = await warranty('WTY-003', null)
    expect((await one(w.admin, 'select unallocated from v_warranties where id = $1', [orphan]))
      .unallocated).toBe(true)

    const t = await one(w.admin, 'select * from warranty_totals($1)', [w.project])
    expect(t.unallocated).toBe(2)
  })

  test('two holders of the lead discipline surface as two, not one', async () => {
    await asSuperuser((c) => c.query(
      `insert into company_disciplines (company_id, discipline_code) values ($1,'A')`, [w.ngt]))
    const wy = await warranty('WTY-004', '04.060')
    const v = await one(w.admin, 'select * from v_warranties where id = $1', [wy])
    // The matrix's own ambiguity, surfaced rather than resolved by picking one.
    expect(v.owners).toEqual(['Bellweather', 'Northgate'])
    expect(v.holders).toBe(2)
    await asSuperuser((c) => c.query(
      `delete from company_disciplines where company_id = $1 and discipline_code = 'A'`,
      [w.ngt]))
  })

  test('the read policy follows the resolved owner', async () => {
    await warranty('WTY-005', '04.060')   // A — Bellweather's
    await warranty('WTY-006', '05.010')   // S — nobody's
    expect((await rows(w.admin, 'select 1 from warranties')).length).toBe(2)
    // Cara's firm holds A, so she sees the one warranty resolved to her.
    expect((await rows(w.cara, 'select reference from warranties')).map((r) => r.reference))
      .toEqual(['WTY-005'])
    // Northgate holds M and neither of these, so Rhys sees nothing.
    expect((await rows(w.rival, 'select 1 from warranties')).length).toBe(0)
  })
})

/* ----------------------------------------------------- material samples */

describe('material samples', () => {
  const material = async (ref: string) =>
    asSuperuser((c) => c.query(
      `insert into materials (project_id, reference, title, company_id)
       values ($1,$2,'Facing brick',$3) returning id`, [w.project, ref, w.bel])
      .then((r) => r.rows[0].id as string))

  test('every round is a row and a decided one is frozen', async () => {
    const m = await material('MAT-001')
    const r1 = (await one<{ submit_material_round: string }>(w.cara,
      `select submit_material_round($1,'Sample A') as submit_material_round`, [m]))
      .submit_material_round
    await asUser(w.admin, (c) =>
      c.query(`select decide_material_round($1,'Rejected','Wrong blend.')`, [r1]))

    // A correction is a new round, because a rejection that can be edited away
    // after a later approval is exactly the record this table keeps.
    expect(await denied(w.admin,
      `update material_submissions set comments = 'never mind' where id = $1`, [r1]))
      .toMatch(/already been decided/)

    const r2 = (await one<{ submit_material_round: string }>(w.cara,
      `select submit_material_round($1,'Sample B') as submit_material_round`, [m]))
      .submit_material_round
    await asUser(w.admin, (c) => c.query(`select decide_material_round($1,'Approved')`, [r2]))

    const v = await one(w.admin, 'select * from v_materials where id = $1', [m])
    expect(v.rounds).toBe(2)
    expect(v.latest_round).toBe(2)
    expect(v.decision).toBe('Approved')
    expect(v.is_done).toBe(true)
    // THE POINT: a rejection stays on the record after a later approval.
    expect(v.was_rejected).toBe(true)
    expect(v.rejections).toBe(1)

    const t = await one(w.admin, 'select * from material_totals($1)', [w.project])
    expect(t.ever_rejected).toBe(1)
  })

  test('only the design manager may decide', async () => {
    const m = await material('MAT-002')
    const r = (await one<{ submit_material_round: string }>(w.cara,
      'select submit_material_round($1) as submit_material_round', [m]))
      .submit_material_round
    // A consultant approving their own sample is what this refuses, and it is
    // refused by the database rather than by a hidden button.
    expect(await denied(w.cara, `select decide_material_round($1,'Approved')`, [r]))
      .toMatch(/Only the design manager/)
    // Account `internal` is not the design manager either.
    expect(await denied(w.internal, `select decide_material_round($1,'Approved')`, [r]))
      .toMatch(/Only the design manager/)
    // And the decision columns are outside the update grant, so the direct
    // write fails as well as the function.
    expect(await denied(w.cara,
      `update material_submissions set decision = 'Approved' where id = $1`, [r]))
      .toMatch(/permission denied/i)
  })

  test('a round cannot be deleted to tidy away a rejection', async () => {
    const m = await material('MAT-003')
    const r = (await one<{ submit_material_round: string }>(w.cara,
      'select submit_material_round($1) as submit_material_round', [m]))
      .submit_material_round
    await asUser(w.admin, (c) => c.query(`select decide_material_round($1,'Rejected')`, [r]))
    expect(await denied(w.admin, 'delete from material_submissions where id = $1', [r]))
      .toMatch(/permission denied/i)
  })

  test('two rounds cannot be open at once', async () => {
    const m = await material('MAT-004')
    await asUser(w.cara, (c) => c.query('select submit_material_round($1)', [m]))
    expect(await denied(w.cara, 'select submit_material_round($1)', [m]))
      .toMatch(/already awaiting a decision/)
  })

  test('a decision cannot be made twice', async () => {
    const m = await material('MAT-005')
    const r = (await one<{ submit_material_round: string }>(w.cara,
      'select submit_material_round($1) as submit_material_round', [m]))
      .submit_material_round
    await asUser(w.admin, (c) => c.query(`select decide_material_round($1,'Approved')`, [r]))
    expect(await denied(w.admin, `select decide_material_round($1,'Rejected')`, [r]))
      .toMatch(/already decided/)
  })
})

/* ----------------------------------------------- the programme spine */

describe('the line inspector reaches this phase', () => {
  test('every anchored record on a line appears, scoped by its own audience', async () => {
    await instalment(w.bel, 20000, '1200')
    await instalment(w.ngt, 50000, '1200')
    await risk({ programme_task_uid: '1200', raised_by: w.cara, person_id: w.cara })
    await asSuperuser((c) => c.query(
      `insert into warranties (project_id, reference, drm_ref, title, programme_task_uid)
       values ($1,'WTY-100','04.060','Roof warranty','1200')`, [w.project]))
    await asSuperuser((c) => c.query(
      `insert into materials (project_id, reference, title, programme_task_uid)
       values ($1,'MAT-100','Facing brick','1200')`, [w.project]))

    const mine = await rows(w.cara,
      `select module, ref from programme_dependents($1,'1200') order by module, ref`,
      [w.project])
    const modules = mine.map((r) => r.module)
    expect(modules).toContain('Instalment')
    expect(modules).toContain('Risk')
    expect(modules).toContain('Warranty')
    expect(modules).toContain('Material sample')
    // One instalment, not two: a consultant clicking a programme line must not
    // learn that a rival has money against it.
    expect(mine.filter((r) => r.module === 'Instalment')).toHaveLength(1)

    // The admin sees both.
    expect((await rows(w.admin,
      `select 1 from programme_dependents($1,'1200') where module = 'Instalment'`, [w.project]))
      .length).toBe(2)

    // And a rival sees neither the risk nor the warranty.
    const theirs = await rows(w.rival,
      `select module from programme_dependents($1,'1200')`, [w.project])
    expect(theirs.map((r) => r.module)).not.toContain('Risk')
    expect(theirs.map((r) => r.module)).not.toContain('Warranty')
  })
})

/* ------------------------------------------- the corrected admin override */

describe('the admin override is the admin override', () => {
  /**
   * Found by the risk test above, and it was a fault in the Phase 6 primitive
   * rather than in the risk register: can_see() returned true for all account
   * STAFF before it looked at the mode, so every internal member of the
   * contractor saw every `named` record on the project. Nothing tested it,
   * which is why it survived six phases.
   */
  const named = (people: string[]) =>
    JSON.stringify({ mode: 'named', people })

  test('internal sees an internal-mode record — that is what the mode means', async () => {
    expect((await one(w.internal,
      `select can_see($1, '{"mode":"internal"}'::jsonb) as v`, [w.project])).v).toBe(true)
    // And a consultant does not.
    expect((await one(w.cara,
      `select can_see($1, '{"mode":"internal"}'::jsonb) as v`, [w.project])).v).toBe(false)
  })

  test('internal does not see a named-mode record it is not named on', async () => {
    expect((await one(w.internal,
      'select can_see($1, $2::jsonb) as v', [w.project, named([])])).v).toBe(false)
    expect((await one(w.internal,
      'select can_see($1, $2::jsonb) as v', [w.project, named([w.internal])])).v).toBe(true)
  })

  test('an account admin and a project admin both override', async () => {
    expect((await one(w.admin,
      'select can_see($1, $2::jsonb) as v', [w.project, named([])])).v).toBe(true)

    await asSuperuser((c) => c.query(
      `update project_members set project_role = 'project_admin'
        where project_id = $1 and profile_id = $2`, [w.project, w.cara]))
    // The design manager on this project, which is the role the prototype
    // gives the override to.
    expect((await one(w.cara,
      'select can_see($1, $2::jsonb) as v', [w.project, named([])])).v).toBe(true)
    await asSuperuser((c) => c.query(
      `update project_members set project_role = 'member'
        where project_id = $1 and profile_id = $2`, [w.project, w.cara]))
  })

  test('the raiser and the owner are never locked out of their own record', async () => {
    expect((await one(w.cara,
      'select can_see($1, $2::jsonb, $3, null) as v',
      [w.project, named([]), w.cara])).v).toBe(true)
    expect((await one(w.cara,
      'select can_see($1, $2::jsonb, null, $3) as v',
      [w.project, named([]), w.cara])).v).toBe(true)
  })

  test('a mode no branch understands is closed, not everyone', async () => {
    // visibility_is_valid() refuses one at write time; this is the second line
    // of defence, and the worst possible default would be to fall through.
    expect((await one(w.cara,
      `select can_see($1, '{"mode":"whatever"}'::jsonb) as v`, [w.project])).v).toBe(false)
    expect((await one(w.admin,
      `select can_see($1, '{"mode":"whatever"}'::jsonb) as v`, [w.project])).v).toBe(true)
  })

  test('parties mode follows the whole company tree, not just the one company', async () => {
    // A firm is answerable for the specialists it appointed under itself, so
    // naming the parent must reach the child.
    const vis = JSON.stringify({ mode: 'parties', companies: [w.bel], people: [] })
    expect((await one(w.cara, 'select can_see($1, $2::jsonb) as v', [w.project, vis])).v)
      .toBe(true)
    const subOnly = JSON.stringify({ mode: 'parties', companies: [w.sub], people: [] })
    // Cara's own company tree contains Substrata, so naming the child reaches
    // the parent's people too.
    expect((await one(w.cara, 'select can_see($1, $2::jsonb) as v', [w.project, subOnly])).v)
      .toBe(true)
    expect((await one(w.rival, 'select can_see($1, $2::jsonb) as v', [w.project, vis])).v)
      .toBe(false)
  })
})
