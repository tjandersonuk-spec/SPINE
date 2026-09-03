/**
 * Phase 13 — period reports.
 *
 * Ported from `reports.js`, and weighted towards the NEGATIVE assertions,
 * because everything that makes this module correct is something a report does
 * not say. A client report that quietly gained a fee figure would look fine.
 *
 * The access-control tests drive the functions directly rather than through a
 * screen, on purpose: the prototype's own test tampers with a company id at the
 * view to prove the UI restriction is not the only restriction, and the same
 * has to be true here — a consultant asking for a rival's report must get a
 * refusal, not a UI dead end.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import type { Client } from 'pg'
import { asSuperuser, asUser, makePerson, refused } from './db'

type World = {
  admin: string; internal: string; cara: string; rival: string
  client: string; outsider: string
  org: string; project: string
  bel: string; ngt: string; sub: string; clientCo: string
}
let w: World

const denied = (who: string, sql: string, params: unknown[] = []) =>
  refused(() => asUser(who, (c) => c.query(sql, params)))
const rows = <T = Record<string, unknown>>(who: string, sql: string, params: unknown[] = []) =>
  asUser(who, (c) => c.query(sql, params)).then((r) => r.rows as T[])
const one = async <T = Record<string, unknown>>(
  who: string, sql: string, params: unknown[] = [],
) => (await rows<T>(who, sql, params))[0]

/** Every metric tile for an audience, as one blob of text — the shape most of
 *  the negative assertions want to search. */
const metricsText = async (who: string, audience: string, company?: string) =>
  (await rows(who, 'select * from report_metrics($1,$2,$3)',
    [w.project, audience, company ?? null]))
    .map((m) => `${m.value} ${m.label} ${m.tail ?? ''}`).join(' | ')

beforeAll(async () => {
  w = await asSuperuser(async (c: Client) => {
    const admin = await makePerson(c, 'Ada Admin', 'p13-ada@hbc.example')
    const internal = await makePerson(c, 'Ian Internal', 'p13-ian@hbc.example')
    const cara = await makePerson(c, 'Cara Consultant', 'p13-cara@bel.example')
    const rival = await makePerson(c, 'Rhys Rival', 'p13-rhys@ngt.example')
    const client = await makePerson(c, 'Cleo Client', 'p13-cleo@client.example')
    const outsider = await makePerson(c, 'Otto Outside', 'p13-otto@elsewhere.example')

    const org = (await c.query(
      `insert into organisations (name, slug, status) values ('HBC13','hbc13','active')
       returning id`)).rows[0].id
    const project = (await c.query(
      `insert into projects (organisation_id, name, code) values ($1,'Brackenfield','BRK13')
       returning id`, [org])).rows[0].id

    const cat = async (name: string, type = 'consultant') => (await c.query(
      `insert into catalogue_companies (organisation_id, name, company_type)
       values ($1,$2,$3) returning id`, [org, name, type])).rows[0].id
    const catBel = await cat('Bellweather')
    const catNgt = await cat('Northgate')
    const catSub = await cat('Substrata')
    const catCli = await cat('Meridian Trust', 'client')

    const mk = async (
      name: string, code: string, catalogue: string,
      type = 'consultant', parent?: string,
    ) => (await c.query(
      `insert into companies
         (project_id, name, originator_code, company_type, catalogue_company_id, parent_id)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [project, name, code, type, catalogue, parent ?? null])).rows[0].id
    const bel = await mk('Bellweather', 'BEL', catBel)
    const ngt = await mk('Northgate', 'NGT', catNgt)
    const sub = await mk('Substrata', 'SUB', catSub, 'consultant', bel)
    const clientCo = await mk('Meridian Trust', 'MER', catCli, 'client')

    for (const [p, role, co] of [
      [admin, 'admin', null], [internal, 'internal', null],
      [cara, 'consultant', catBel], [rival, 'consultant', catNgt],
      [client, 'client', catCli],
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

    await c.query(
      `insert into company_disciplines (company_id, discipline_code)
       values ($1,'A'), ($2,'M')`, [bel, ngt])
    await c.query(
      `insert into drm_items (project_id, ref, category_code, item, lead_discipline)
       values ($1,'04.060','04','Roof covering','A'),
              ($1,'05.010','05','Structural frame','S')`, [project])

    await c.query(
      `insert into programme_tasks
         (project_id, task_uid, description, start_date, finish_date, level, task_type,
          percent_complete)
       values ($1,'1100','Stage 4 design','2026-01-05','2026-03-27',1,'Task',100),
              ($1,'1200','Construction','2026-04-06','2026-12-18',1,'Task',0),
              ($1,'1300','Practical completion','2026-12-18','2026-12-18',1,'Milestone',0)`,
      [project])

    // Money, so a client report has something to leak if the gate is wrong.
    await c.query(
      `insert into fees (project_id, company_id, reference, kind, value, status, date_approved)
       values ($1,$2,'FEE-BEL','fee',250000,'Approved','2026-01-10'),
              ($1,$3,'FEE-NGT','fee',180000,'Approved','2026-01-10')`, [project, bel, ngt])
    await c.query(
      `insert into payment_schedule
         (project_id, company_id, reference, description, value, programme_task_uid)
       values ($1,$2,'PS-BEL-1','Stage 4 instalment',50000,'1100')`, [project, bel])
    await c.query(
      `insert into invoices (project_id, company_id, reference, value, date_submitted)
       values ($1,$2,'INV-BEL-1',50000, current_date - 2)`, [project, bel])

    // A costed risk, which the client must never see.
    await c.query(
      `insert into risks (project_id, reference, kind, title, likelihood, impact_cost,
                          status, raised_by, visibility)
       values ($1,'RSK-01','risk','Ground conditions worse than assumed',4,200000,'Open',$2,
               '{"mode":"named","people":[]}'::jsonb)`, [project, admin])

    // Tracked items across several kinds, so the compliance breakdown has
    // more than one row and the client exclusion has something to exclude.
    await c.query(
      `insert into tracked_items (project_id, kind, reference, title, company_id, status, required)
       values ($1,'planning','PC-001','Discharge condition 4',$2,'Discharged',true),
              ($1,'planning','PC-002','Discharge condition 7',$2,'Not started',true),
              ($1,'bc','BC-001','Fire strategy sign-off',$2,'Approved',true),
              ($1,'checklist:precon','PRE-001','Tender review question',null,'Complete',true),
              ($1,'checklist:client','CLI-001','Confirm FF&E standard',null,'Not started',true),
              ($1,'scope','SC-001','Produce the GA drawings',$2,'Not started',true)`,
      [project, bel])

    // A change request awaiting a decision from the client's own company, and
    // one awaiting a decision from a consultant.
    await c.query(
      `insert into change_requests
         (project_id, reference, title, status, raised_by, from_company_id, to_company_id,
          decision_task_uid)
       values ($1,'CHG-001','Revise the roof build-up','Submitted',$2,$3,$4,'1200'),
              ($1,'CHG-002','Relocate the substation','Under review',$2,$3,$5,'1200')`,
      [project, admin, bel, clientCo, ngt])

    return { admin, internal, cara, rival, client, outsider,
             org, project, bel, ngt, sub, clientCo }
  })
})

/* --------------------------------------------------------- nothing stored */

describe('a report is a query, not a document', () => {
  test('no table anywhere holds one', async () => {
    // Nothing is drafted, saved or versioned, so there is never a stale copy to
    // reconcile against the live project.
    const t = await rows(w.admin, `
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name like '%report%'`)
    expect(t).toEqual([])
  })

  test('the period is computed server-side, both ends inclusive', async () => {
    const wk = await one<{ start_date: Date; end_date: Date }>(w.admin,
      `select * from report_period('week','2026-03-27')`)
    expect([wk.start_date, wk.end_date].map((d) => d.toISOString().slice(0, 10)))
      .toEqual(['2026-03-21', '2026-03-27'])
    // Seven days, not six.
    const days = await one(w.admin,
      `select (end_date - start_date + 1) as n from report_period('week','2026-03-27')`)
    expect(Number(days.n)).toBe(7)

    const mo = await one<{ start_date: Date; label: string }>(w.admin,
      `select * from report_period('month','2026-03-27')`)
    expect(mo.start_date.toISOString().slice(0, 10)).toBe('2026-02-28')
    expect(mo.label).toBe('28 Feb 2026 – 27 Mar 2026')

    // An unknown kind is a week rather than an error: a report that refused to
    // render because of a typo in a dropdown would be worse than one that
    // showed the default period.
    expect((await one(w.admin, `select kind from report_period('fortnight')`)).kind)
      .toBe('week')
  })
})

/* ------------------------------------------------------- access control */

describe('access control mirrors role, and is enforced server-side', () => {
  test('account staff may generate all three', async () => {
    for (const who of [w.admin, w.internal]) {
      expect((await one<{ a: string[] }>(who,
        'select my_report_audiences($1) as a', [w.project])).a)
        .toEqual(['internal', 'client', 'consultant'])
    }
  })

  test('a client may only ever generate the client report', async () => {
    expect((await one<{ a: string[] }>(w.client,
      'select my_report_audiences($1) as a', [w.project])).a).toEqual(['client'])

    expect(await denied(w.client, 'select report_scope($1,$2)', [w.project, 'internal']))
      .toMatch(/Not permitted to generate the internal report/)
    expect(await denied(w.client, 'select report_scope($1,$2)', [w.project, 'consultant']))
      .toMatch(/Not permitted/)
    // And the content functions refuse too, not just the guard — every one of
    // them calls it first.
    expect(await denied(w.client, 'select * from report_metrics($1,$2)',
      [w.project, 'internal'])).toMatch(/Not permitted/)
    expect(await denied(w.client, 'select * from report_activity($1,$2)',
      [w.project, 'internal'])).toMatch(/Not permitted/)
    expect(await denied(w.client, 'select * from report_attention($1,$2)',
      [w.project, 'internal'])).toMatch(/Not permitted/)
  })

  test('a consultant may only ever generate their own', async () => {
    expect((await one<{ a: string[] }>(w.cara,
      'select my_report_audiences($1) as a', [w.project])).a).toEqual(['consultant'])
    expect(await denied(w.cara, 'select report_scope($1,$2)', [w.project, 'internal']))
      .toMatch(/Not permitted/)
    expect(await denied(w.cara, 'select report_scope($1,$2)', [w.project, 'client']))
      .toMatch(/Not permitted/)
  })

  test('a tampered company id is a refusal, not a UI dead end', async () => {
    // The whole point of the prototype's own test: prove the restriction is not
    // only in the interface. Cara asks for Northgate's report.
    expect(await denied(w.cara, 'select report_scope($1,$2,$3)',
      [w.project, 'consultant', w.ngt]))
      .toMatch(/Not permitted to generate a report for that company/)
    // Not "returns her own figures under Northgate's name", which would hide
    // the attempt and look like it worked.
    expect(await denied(w.cara, 'select * from report_metrics($1,$2,$3)',
      [w.project, 'consultant', w.ngt])).toMatch(/Not permitted/)

    // Her own company, and the specialist she appointed under it, are both hers.
    expect((await one<{ report_scope: string }>(w.cara,
      'select report_scope($1,$2,$3) as report_scope',
      [w.project, 'consultant', w.bel])).report_scope).toBe(w.bel)
    expect((await one<{ report_scope: string }>(w.cara,
      'select report_scope($1,$2,$3) as report_scope',
      [w.project, 'consultant', w.sub])).report_scope).toBe(w.sub)
  })

  test('account staff may generate a consultant report for any company', async () => {
    expect((await one<{ report_scope: string }>(w.admin,
      'select report_scope($1,$2,$3) as report_scope',
      [w.project, 'consultant', w.ngt])).report_scope).toBe(w.ngt)
    // But not for a company that is not on this project.
    expect(await denied(w.admin, 'select report_scope($1,$2,$3)',
      [w.project, 'consultant', w.admin])).toMatch(/No such company/)
    // And a consultant report with no company at all is meaningless.
    expect(await denied(w.admin, 'select report_scope($1,$2)', [w.project, 'consultant']))
      .toMatch(/needs a company/)
  })

  test('a company passed to a project-wide report is refused, not ignored', async () => {
    // A caller who thinks they are scoping something is wrong, and silently
    // dropping the argument would let them keep thinking it.
    expect(await denied(w.admin, 'select report_scope($1,$2,$3)',
      [w.project, 'internal', w.bel])).toMatch(/project-wide and takes no company/)
  })

  test('somebody off the project gets nothing at all', async () => {
    expect((await one<{ a: string[] }>(w.outsider,
      'select my_report_audiences($1) as a', [w.project])).a).toEqual([])
    expect(await denied(w.outsider, 'select report_scope($1,$2)', [w.project, 'client']))
      .toMatch(/Not permitted/)
  })

  test('an unknown audience is refused rather than defaulted', async () => {
    expect(await denied(w.admin, 'select report_scope($1,$2)', [w.project, 'everyone']))
      .toMatch(/Unknown report audience/)
  })
})

/* --------------------------------------------- the client exclusions */

describe('what the client report does not say', () => {
  test('no fee or cashflow figure appears anywhere in it', async () => {
    const internal = await metricsText(w.admin, 'internal')
    // The internal report does carry the fee position, so the absence below is
    // a gate rather than an empty project.
    expect(internal).toMatch(/Approved fees/)
    expect(internal).toMatch(/430,000/)

    const client = await metricsText(w.admin, 'client')
    expect(client).not.toMatch(/fee/i)
    expect(client).not.toMatch(/£/)
    expect(client).not.toMatch(/430,000|250,000|180,000/)

    const activity = await rows(w.admin,
      `select * from report_activity($1,'client')`, [w.project])
    expect(activity.map((a) => a.section)).not.toContain('Commercial')
    expect(JSON.stringify(activity)).not.toMatch(/invoice/i)
  })

  test('no risk register, and no expected value', async () => {
    expect(await metricsText(w.admin, 'internal')).toMatch(/Expected risk value/)
    const client = await metricsText(w.admin, 'client')
    expect(client).not.toMatch(/risk/i)
    expect(client).not.toMatch(/200,000|150,000/)
  })

  test('no consultant health — it never leaves the contractor’s own staff', async () => {
    expect((await rows(w.admin, `select * from report_health($1,'internal')`, [w.project]))
      .length).toBeGreaterThan(0)
    expect(await rows(w.admin, `select * from report_health($1,'client')`, [w.project]))
      .toEqual([])
    expect(await rows(w.admin, `select * from report_health($1,'consultant',$2)`,
      [w.project, w.bel])).toEqual([])
  })

  test('no gone-quiet: a stall is a tone judgement, not an automated assertion', async () => {
    expect(await rows(w.admin, `select * from report_gone_quiet($1,'client')`, [w.project]))
      .toEqual([])
  })

  test('no change-control classification detail', async () => {
    // Internal is told which change nobody has classified.
    //
    // Scoped by project, because a reference is unique PER PROJECT and not
    // globally -- an unscoped update here reached into another suite's CHG-001
    // and turned its stop-work off, which surfaced as a sorting failure two
    // phases away.
    await asSuperuser((c) => c.query(
      `update change_requests set bsa_controlled = true
        where project_id = $1 and reference = 'CHG-001'`, [w.project]))
    const internal = await rows(w.admin,
      `select * from report_attention($1,'internal')`, [w.project])
    expect(internal.map((r) => r.kind)).toContain('Change awaiting classification')

    const client = await rows(w.admin,
      `select * from report_attention($1,'client')`, [w.project])
    expect(client.map((r) => r.kind)).not.toContain('Change awaiting classification')
    expect(JSON.stringify(client)).not.toMatch(/classif/i)
    await asSuperuser((c) => c.query(
      `update change_requests set bsa_controlled = false
        where project_id = $1 and reference = 'CHG-001'`, [w.project]))
  })

  test('the pre-construction pre-assessment is excluded from the breakdown', async () => {
    const internal = await rows(w.admin,
      `select * from report_compliance_rows($1,'internal')`, [w.project])
    expect(internal.map((r) => r.kind)).toContain('checklist:precon')

    const client = await rows(w.admin,
      `select * from report_compliance_rows($1,'client')`, [w.project])
    expect(client.map((r) => r.kind)).not.toContain('checklist:precon')
    // And the scope of service, which is an appointment's own working document.
    expect(client.map((r) => r.kind)).not.toContain('scope')
    // What it does carry.
    expect(client.map((r) => r.kind)).toEqual(
      expect.arrayContaining(['planning', 'bc', 'checklist:client']))
  })

  test('the omissions are stated on the document itself', async () => {
    // An omission a reader cannot see stated is indistinguishable from an
    // oversight, and on a report that leaves out the fee position that is the
    // whole difference.
    const x = await one<{ report_exclusions: string }>(w.admin,
      `select report_exclusions('client') as report_exclusions`)
    expect(x.report_exclusions).toMatch(/fees and cashflow/)
    expect(x.report_exclusions).toMatch(/risk and opportunity register/)
    expect(x.report_exclusions).toMatch(/individual consultant performance/)

    const h = await one<{ report_header: Record<string, unknown> }>(w.admin,
      `select report_header($1,'client') as report_header`, [w.project])
    expect(String(h.report_header.exclusions)).toMatch(/Not shown/)
    expect(h.report_header.title).toBe('Client report')
  })
})

/* ---------------------------------------------- the consultant scoping */

describe('a consultant report never reveals another company’s figures', () => {
  test('the fee figure is that company’s own, not the project’s', async () => {
    const mine = await metricsText(w.admin, 'consultant', w.bel)
    expect(mine).toMatch(/250,000/)
    expect(mine).not.toMatch(/180,000/)   // Northgate's
    expect(mine).not.toMatch(/430,000/)   // the project total

    const theirs = await metricsText(w.admin, 'consultant', w.ngt)
    expect(theirs).toMatch(/180,000/)
    expect(theirs).not.toMatch(/250,000/)
  })

  test('the same report generated by the consultant themselves agrees', async () => {
    const byAdmin = await metricsText(w.admin, 'consultant', w.bel)
    const byCara = await metricsText(w.cara, 'consultant', w.bel)
    expect(byCara).toBe(byAdmin)
  })

  test('a type the company holds nothing on produces no row', async () => {
    const belRows = await rows(w.admin,
      `select * from report_compliance_rows($1,'consultant',$2)`, [w.project, w.bel])
    // Bellweather holds planning, bc and scope items.
    expect(belRows.map((r) => r.kind).sort()).toEqual(['bc', 'planning', 'scope'])
    // An empty row for a type they have nothing on would be noise, not a
    // finding — the client requirements checklist is nobody's here.
    expect(belRows.map((r) => r.kind)).not.toContain('checklist:client')

    const ngtRows = await rows(w.admin,
      `select * from report_compliance_rows($1,'consultant',$2)`, [w.project, w.ngt])
    expect(ngtRows).toEqual([])
  })

  test('gone quiet is scoped to their own items, never a rival’s', async () => {
    const all = await rows(w.admin, `select * from report_gone_quiet($1,'internal')`,
      [w.project])
    const mine = await rows(w.admin, `select * from report_gone_quiet($1,'consultant',$2)`,
      [w.project, w.bel])
    // Reads as self-accountability rather than as a callout of somebody else.
    expect(mine.length).toBeLessThanOrEqual(all.length)
    for (const q of mine) expect(all.map((a) => a.reference)).toContain(q.reference)
  })
})

/* ------------------------------------------- audience, not the reader */

describe('page two asks what is waiting on this audience', () => {
  test('the client sees only what is waiting on the client', async () => {
    const client = await rows(w.admin, `select * from report_attention($1,'client')`,
      [w.project])
    // CHG-001 is addressed to the client's own company; CHG-002 is not.
    expect(client.map((r) => r.reference)).toEqual(['CHG-001'])
    expect(client.map((r) => r.kind)).toEqual(['Awaiting your decision'])
  })

  test('internal sees every open decision project-wide', async () => {
    const internal = await rows(w.admin, `select * from report_attention($1,'internal')`,
      [w.project])
    const refs = internal.map((r) => r.reference)
    expect(refs).toContain('CHG-001')
    expect(refs).toContain('CHG-002')
    expect(refs).toContain('PS-BEL-1')     // instalment awaiting agreement
    expect(refs).toContain('INV-BEL-1')    // invoice awaiting certification
  })

  test('a consultant sees what is waiting on them', async () => {
    const ngt = await rows(w.admin, `select * from report_attention($1,'consultant',$2)`,
      [w.project, w.ngt])
    expect(ngt.map((r) => r.reference)).toEqual(['CHG-002'])
    const bel = await rows(w.admin, `select * from report_attention($1,'consultant',$2)`,
      [w.project, w.bel])
    // Bellweather raised CHG-001, it is not waiting on them — but their
    // un-agreed instalment is.
    expect(bel.map((r) => r.reference)).toContain('PS-BEL-1')
    expect(bel.map((r) => r.reference)).not.toContain('CHG-001')
  })

  test('it never references whoever generated it', async () => {
    // The live dashboard's decision_queue() is keyed on auth.uid(). If this
    // reused it with the filter bypassed, two people running the same audience
    // report would get different documents — and the client's copy would
    // silently be about whoever pressed the button.
    const byAdmin = await rows(w.admin, `select * from report_attention($1,'internal')`,
      [w.project])
    const byInternal = await rows(w.internal, `select * from report_attention($1,'internal')`,
      [w.project])
    expect(byInternal).toEqual(byAdmin)

    const src = await one<{ prosrc: string }>(w.admin,
      `select prosrc from pg_proc where proname = 'report_attention'`)
    expect(src.prosrc).not.toMatch(/auth\.uid\(\)/)
  })
})

/* ------------------------------------------------------- shared sections */

describe('what every audience gets the same', () => {
  test('coming up is identical for all three — a date is not sensitive', async () => {
    const internal = await rows(w.admin,
      `select * from report_coming_up($1,'internal',null,'month','2026-11-30')`, [w.project])
    const client = await rows(w.admin,
      `select * from report_coming_up($1,'client',null,'month','2026-11-30')`, [w.project])
    const consultant = await rows(w.admin,
      `select * from report_coming_up($1,'consultant',$2,'month','2026-11-30')`,
      [w.project, w.bel])
    expect(client).toEqual(internal)
    expect(consultant).toEqual(internal)
    // The practical completion milestone falls inside a month of 30 November.
    expect(internal.map((r) => r.task_uid)).toContain('1300')
    expect(internal.find((r) => r.task_uid === '1300')!.is_milestone).toBe(true)
  })

  test('one programme_timeline(), called from the dashboard and from here', async () => {
    // Two functions drawing the same bar would eventually draw different
    // pictures, so there is exactly one and the report reads it.
    const n = await one<{ n: string }>(w.admin, `
      select count(*) as n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname like '%timeline%'`)
    expect(Number(n.n)).toBe(1)
    const src = await one<{ prosrc: string }>(w.admin,
      `select prosrc from pg_proc where proname = 'report_metrics'`)
    expect(src.prosrc).toMatch(/programme_timeline/)
  })

  test('the discussion line is present even at zero', async () => {
    // A section that vanishes when empty hides the finding that nothing was
    // said this period.
    const a = await rows(w.admin,
      `select * from report_activity($1,'client','','week','2020-01-01'::date)`
        .replace(",''", ',null'), [w.project])
    expect(a.map((x) => x.section)).toContain('Discussion')
    expect(String(a.find((x) => x.section === 'Discussion')!.headline)).toMatch(/^0 items/)
  })
})

/* ------------------------------------------------- the itemised breakdown */

describe('every tracked-item type gets its own row', () => {
  test('never a merged total', async () => {
    // The first cut folded planning, building control and six checklists into
    // one tile, and it was wrong: "which one is behind?" is the first question
    // anybody reading a compliance section asks, and a rollup cannot answer it.
    const r = await rows(w.admin, `select * from report_compliance_rows($1,'internal')`,
      [w.project])
    expect(r.length).toBeGreaterThan(2)
    const planning = r.find((x) => x.kind === 'planning')!
    expect([planning.total, planning.done]).toEqual([2, 1])
    const bc = r.find((x) => x.kind === 'bc')!
    expect([bc.total, bc.done]).toEqual([1, 1])
    // Each carries its own label, so the page needs no lookup of its own.
    expect(planning.label).toBe('Planning conditions')
    expect(bc.label).toBe('Building control')
  })

  test('BREEAM is not in the breakdown — it has its own tile and its own page',
    async () => {
      const r = await rows(w.admin, `select * from report_compliance_rows($1,'internal')`,
        [w.project])
      expect(r.map((x) => x.kind)).not.toContain('breeam')
    })
})

/* ----------------------------------------------------------- the header */

describe('the header', () => {
  test('names the audience, the company and who generated it', async () => {
    const h = await one<{ report_header: Record<string, unknown> }>(w.cara,
      `select report_header($1,'consultant',$2) as report_header`, [w.project, w.bel])
    expect(h.report_header.title).toBe('Bellweather — activity report')
    expect(h.report_header.company_name).toBe('Bellweather')
    expect(h.report_header.generated_by).toBe('Cara Consultant')
    expect(h.report_header.project_code).toBe('BRK13')
  })

  test('and refuses one the caller may not generate', async () => {
    expect(await denied(w.cara, `select report_header($1,'internal')`, [w.project]))
      .toMatch(/Not permitted/)
  })
})
