/**
 * Phase 8 — the consultant front and the project dashboard.
 *
 * The assertions TASKS.md names: a consultant's front lists only their own
 * company's documents; the decision queue differs per person; a client is never
 * asked to agree instalments. Plus the rule the notes are firmest about —
 * consultant health never leaves the contractor's own staff.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import type { Client } from 'pg'
import { asSuperuser, asUser, makePerson } from './db'

type World = {
  admin: string; cara: string; owen: string; client: string
  org: string; project: string
  bel: string; belSub: string; cwc: string
  caraPerson: string; owenPerson: string
}
let w: World

beforeAll(async () => {
  w = await asSuperuser(async (c: Client) => {
    const admin = await makePerson(c, 'Ada Admin', 'p8-ada@hbc.example')
    const cara = await makePerson(c, 'Cara Consultant', 'p8-cara@bel.example')
    const owen = await makePerson(c, 'Owen Other', 'p8-owen@cwc.example')
    const client = await makePerson(c, 'Clive Client', 'p8-clive@client.example')

    const org = (await c.query(
      `insert into organisations (name, slug, status) values ('HBC8','hbc8','active')
       returning id`)).rows[0].id
    for (const [p, role] of [
      [admin, 'admin'], [cara, 'consultant'], [owen, 'consultant'], [client, 'client'],
    ] as const) {
      await c.query(
        'insert into organisation_members (organisation_id, profile_id, role) values ($1,$2,$3)',
        [org, p, role])
    }
    const project = (await c.query(
      `insert into projects (organisation_id, name, code) values ($1,'Kingsmead','KMW8')
       returning id`, [org])).rows[0].id
    for (const p of [cara, owen, client]) {
      await c.query(
        `insert into project_members (project_id, profile_id, project_role)
         values ($1,$2,'member')`, [project, p])
    }

    // Two rival consultants on one project, and a sub-consultant under one of
    // them — the case the company tree exists for.
    const catBel = (await c.query(
      `insert into catalogue_companies (organisation_id, name, company_type)
       values ($1,'Bellweather','consultant') returning id`, [org])).rows[0].id
    const catSub = (await c.query(
      `insert into catalogue_companies (organisation_id, name, company_type)
       values ($1,'Bellweather Facades','consultant') returning id`, [org])).rows[0].id
    const catCwc = (await c.query(
      `insert into catalogue_companies (organisation_id, name, company_type)
       values ($1,'Corewell','consultant') returning id`, [org])).rows[0].id

    const bel = (await c.query(
      `insert into companies (project_id, name, originator_code, company_type,
                              catalogue_company_id)
       values ($1,'Bellweather','BEL','consultant',$2) returning id`,
      [project, catBel])).rows[0].id
    const belSub = (await c.query(
      `insert into companies (project_id, name, originator_code, company_type,
                              catalogue_company_id, parent_id)
       values ($1,'Bellweather Facades','BFA','consultant',$2,$3) returning id`,
      [project, catSub, bel])).rows[0].id
    const cwc = (await c.query(
      `insert into companies (project_id, name, originator_code, company_type,
                              catalogue_company_id)
       values ($1,'Corewell','CWC','consultant',$2) returning id`,
      [project, catCwc])).rows[0].id

    // Memberships carry the catalogue company, which is how my_company_tree
    // finds the caller's own firm.
    await c.query(
      `update organisation_members set company_id = $1
       where organisation_id = $2 and profile_id = $3`, [catBel, org, cara])
    await c.query(
      `update organisation_members set company_id = $1
       where organisation_id = $2 and profile_id = $3`, [catCwc, org, owen])

    const caraPerson = (await c.query(
      `insert into project_people (project_id, company_id, name, profile_id)
       values ($1,$2,'Cara Consultant',$3) returning id`,
      [project, bel, cara])).rows[0].id
    const owenPerson = (await c.query(
      `insert into project_people (project_id, company_id, name, profile_id)
       values ($1,$2,'Owen Other',$3) returning id`,
      [project, cwc, owen])).rows[0].id

    return { admin, cara, owen, client, org, project, bel, belSub, cwc, caraPerson, owenPerson }
  })

  await asUser(w.admin, (c) => c.query('select import_programme($1,$2,$3)', [
    w.project, 'Rev 1', JSON.stringify([
      { task_uid: '1000', description: 'Kingsmead', start_date: '2026-01-05',
        finish_date: '2028-02-25', percent_complete: 34, level: 1, task_type: 'Summary' },
      { task_uid: '1121', description: 'Architectural package', start_date: '2026-06-01',
        finish_date: '2026-10-30', percent_complete: 50, level: 2, parent_uid: '1000',
        task_type: 'Task' },
      { task_uid: '1481', description: 'Practical Completion', start_date: '2028-02-25',
        finish_date: '2028-02-25', percent_complete: 0, level: 2, parent_uid: '1000',
        task_type: 'Milestone' },
    ])]))

  // One awaited drawing per firm, plus one under Cara's sub-consultant.
  await asUser(w.admin, (c) => c.query(
    `insert into drawing_register (project_id, document_number, title,
       programme_task_uid, offset_days, anchor)
     values ($1,'KMW-BEL-BC-ZZ-DR-A-0400','Bellweather plans','1121',-30,'finish'),
            ($1,'KMW-BFA-BC-ZZ-DR-A-3000','Facade details','1121',-14,'finish'),
            ($1,'KMW-CWC-BC-ZZ-DR-S-1100','Corewell frame','1121',0,'finish')`,
    [w.project]))
})

describe('a consultant front shows their own work and nobody else’s', () => {
  test('due from us covers their firm and anyone they appointed, and no rival', async () => {
    const f = (await asUser(w.cara, (c) =>
      c.query('select my_front($1) as f', [w.project]))).rows[0].f

    const numbers = f.due_from_us.map((d: { number: string }) => d.number)
    expect(numbers).toEqual(expect.arrayContaining([
      'KMW-BEL-BC-ZZ-DR-A-0400',   // her own
      'KMW-BFA-BC-ZZ-DR-A-3000',   // her sub-consultant's
    ]))
    // The rival on the same project is absent, not merely unhighlighted.
    expect(numbers).not.toContain('KMW-CWC-BC-ZZ-DR-S-1100')
  })

  test('and the rival sees exactly the mirror image', async () => {
    const f = (await asUser(w.owen, (c) =>
      c.query('select my_front($1) as f', [w.project]))).rows[0].f
    const numbers = f.due_from_us.map((d: { number: string }) => d.number)
    expect(numbers).toEqual(['KMW-CWC-BC-ZZ-DR-S-1100'])
  })

  test('the company tree reaches a sub-consultant, not just the firm itself', async () => {
    const t = await asUser(w.cara, (c) =>
      c.query('select company_id from my_company_tree($1) order by 1', [w.project]))
    expect(new Set(t.rows.map((r) => r.company_id))).toEqual(new Set([w.bel, w.belSub]))
  })

  test('asked of us is what our people carry, not the whole project', async () => {
    await asUser(w.admin, (c) => c.query(
      `select raise_issue($1,'Bellweather to confirm the riser','irs',null,$2)`,
      [w.project, w.caraPerson]))
    await asUser(w.admin, (c) => c.query(
      `select raise_issue($1,'Corewell to confirm the frame','irs',null,$2)`,
      [w.project, w.owenPerson]))

    const cara = (await asUser(w.cara, (c) =>
      c.query('select my_front($1) as f', [w.project]))).rows[0].f
    const owen = (await asUser(w.owen, (c) =>
      c.query('select my_front($1) as f', [w.project]))).rows[0].f

    expect(cara.asked_of_us.map((i: { title: string }) => i.title))
      .toEqual(['Bellweather to confirm the riser'])
    expect(owen.asked_of_us.map((i: { title: string }) => i.title))
      .toEqual(['Corewell to confirm the frame'])
  })

  test('tracked lines are the person’s own, not their firm’s', async () => {
    await asUser(w.cara, (c) => c.query('select watch_programme_line($1,$2)', [w.project, '1121']))

    const cara = (await asUser(w.cara, (c) =>
      c.query('select my_front($1) as f', [w.project]))).rows[0].f
    const owen = (await asUser(w.owen, (c) =>
      c.query('select my_front($1) as f', [w.project]))).rows[0].f

    expect(cara.tracked_lines.map((t: { uid: string }) => t.uid)).toEqual(['1121'])
    expect(owen.tracked_lines).toEqual([])
  })
})

describe('the decision queue is personal', () => {
  test('it differs per person, and is not the same list for everyone', async () => {
    const forCara = await asUser(w.cara, (c) =>
      c.query('select title from decision_queue($1)', [w.project]))
    const forOwen = await asUser(w.owen, (c) =>
      c.query('select title from decision_queue($1)', [w.project]))

    expect(forCara.rows.map((r) => r.title)).toEqual(['Bellweather to confirm the riser'])
    expect(forOwen.rows.map((r) => r.title)).toEqual(['Corewell to confirm the frame'])
  })

  test('an RFI to answer reaches the contractor, not the person who asked it', async () => {
    await asUser(w.cara, (c) => c.query(
      `select raise_issue($1,'Riser clash','rfi',null,null,null,0,'finish',50,
         'Which duct takes priority at grid E?')`, [w.project]))

    const admin = await asUser(w.admin, (c) =>
      c.query(`select kind from decision_queue($1) where kind = 'RFI to answer'`, [w.project]))
    expect(admin.rows).toHaveLength(1)

    const cara = await asUser(w.cara, (c) =>
      c.query(`select kind from decision_queue($1) where kind = 'RFI to answer'`, [w.project]))
    expect(cara.rows).toHaveLength(0)
  })
})

describe('consultant health never leaves the contractor’s own staff', () => {
  test('the contractor sees a row per firm, worst first', async () => {
    const h = await asUser(w.admin, (c) =>
      c.query('select company_name, concern_score from consultant_health($1)', [w.project]))
    expect(h.rows.length).toBe(3)
    // Worst first is the whole point: the order is the judgement.
    const scores = h.rows.map((r) => r.concern_score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  test('a consultant sees nothing at all — not even their own row', async () => {
    // It names firms and ranks them. A consultant reading their own position
    // against a rival's is not what it is for.
    for (const who of [w.cara, w.owen, w.client]) {
      const h = await asUser(who, (c) =>
        c.query('select count(*)::int as n from consultant_health($1)', [w.project]))
      expect(h.rows[0].n).toBe(0)
    }
  })

  test('the score counts lateness and silence, never busyness', async () => {
    const h = await asUser(w.admin, (c) =>
      c.query(`select appointment_gaps, overdue_drawings, quiet_issues, open_issues,
                      concern_score
               from consultant_health($1) where company_name = 'Corewell'`, [w.project]))
    const r = h.rows[0]
    // A firm carrying open work is not a worrying firm; a late or silent one is.
    expect(r.concern_score).toBe(r.appointment_gaps + r.overdue_drawings + r.quiet_issues)
    expect(r.open_issues).toBeGreaterThan(0)
  })
})

describe('gone quiet is about silence, not age', () => {
  test('a freshly raised item is not quiet', async () => {
    const q = await asUser(w.admin, (c) =>
      c.query('select count(*)::int as n from gone_quiet($1)', [w.project]))
    expect(q.rows[0].n).toBe(0)
  })

  test('an old item with no discussion is', async () => {
    const id = (await asUser(w.admin, (c) => c.query(
      `select (raise_issue($1,'Nobody has mentioned this since March','irs')->>'id')::uuid as id`,
      [w.project]))).rows[0].id
    // Backdate the trail as well as the row. A genuinely old item has old log
    // entries; backdating raised_at alone leaves today's insert row behind and
    // the item is correctly reported as touched today -- which is the function
    // working, not failing.
    await asSuperuser(async (c: Client) => {
      await c.query(`update issues set raised_at = now() - interval '10 weeks' where id = $1`,
        [id])
      await c.query(
        `update change_log set created_at = now() - interval '10 weeks' where entity_id = $1`,
        [id])
    })

    const q = await asUser(w.admin, (c) =>
      c.query('select reference, days_quiet from gone_quiet($1)', [w.project]))
    expect(q.rows).toHaveLength(1)
    expect(q.rows[0].days_quiet).toBeGreaterThan(60)
  })

  test('and a comment on it makes it loud again, with no write to the issue', async () => {
    const id = (await asUser(w.admin, (c) => c.query(
      `select id from issues where title = 'Nobody has mentioned this since March'`)))
      .rows[0].id
    await asUser(w.admin, (c) => c.query(
      `insert into comments (project_id, entity_type, entity_id, author_id, body)
       values ($1,'issue',$2,$3,'Chased today.')`, [w.project, id, w.admin]))

    const q = await asUser(w.admin, (c) =>
      c.query('select count(*)::int as n from gone_quiet($1)', [w.project]))
    expect(q.rows[0].n).toBe(0)

    // The issue itself was not touched: quiet is derived from what was said
    // about it, not from a column somebody has to remember to bump.
    const raised = await asUser(w.admin, (c) =>
      c.query('select raised_at from issues where id = $1', [id]))
    expect(new Date(raised.rows[0].raised_at).getTime())
      .toBeLessThan(Date.now() - 60 * 86400e3)
  })
})

describe('the programme timeline is one function, drawn once', () => {
  test('it reports the span, where today sits in it, and the milestones', async () => {
    const t = (await asUser(w.cara, (c) =>
      c.query('select programme_timeline($1) as t', [w.project]))).rows[0].t
    // The imported summary claims the project starts on 2026-01-05, but no leaf
    // under it starts before June. The rollup wins, here as everywhere: a
    // summary cannot assert a span its own children do not support, and the
    // timeline is the first place that would otherwise show a comforting date
    // nothing is actually working towards.
    expect(t.start).toBe('2026-06-01')
    expect(t.finish).toBe('2028-02-25')
    expect(t.milestones).toHaveLength(1)
    expect(t.milestones[0]).toMatchObject({ uid: '1481', complete: false })
    expect(t.percent_elapsed).toBeGreaterThan(0)
  })

  test('a removed line is not drawn', async () => {
    await asUser(w.admin, (c) => c.query('select import_programme($1,$2,$3)', [
      w.project, 'Rev 2', JSON.stringify([
        { task_uid: '1000', description: 'Kingsmead', start_date: '2026-01-05',
          finish_date: '2028-02-25', percent_complete: 34, level: 1, task_type: 'Summary' },
        { task_uid: '1121', description: 'Architectural package', start_date: '2026-06-01',
          finish_date: '2026-10-30', percent_complete: 50, level: 2, parent_uid: '1000',
          task_type: 'Task' },
      ])]))
    const t = (await asUser(w.cara, (c) =>
      c.query('select programme_timeline($1) as t', [w.project]))).rows[0].t
    expect(t.milestones).toEqual([])
  })
})
