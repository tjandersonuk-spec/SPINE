/**
 * Phase 11 — BREEAM.
 *
 * The assertions TASKS.md names, ported from the prototype's `breeam.js`
 * hand-worked arithmetic: a scheme that reaches 100%, an issue blocked by an
 * unmet prerequisite, that prerequisite released, the capping case, and
 * building-type switching. Plus the two rules the module exists to enforce —
 * section credits summed from the rows rather than stated, and a framework
 * only a project's own staff may load.
 *
 * The scheme below is invented for the test and carries no BREEAM content:
 * three sections, four issues, and codes chosen to be obviously not BRE's.
 */
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { Client } from 'pg'
import { asSuperuser, asUser, makePerson, refused } from './db'

type World = {
  admin: string; cara: string; outsider: string
  org: string; project: string; scheme: string
  arch: string
  issues: Record<string, string>
  credits: Record<string, string>
}
let w: World

const denied = (who: string, sql: string, params: unknown[] = []) =>
  refused(() => asUser(who, (c) => c.query(sql, params)))

const num = (v: unknown) => Number(v)

const totals = async (scheme?: string) =>
  (await asUser(w.admin, (c) =>
    c.query('select * from breeam_totals($1,$2)', [w.project, scheme ?? w.scheme]))).rows[0]

/** Set a credit's status, target and achievement in one go. */
async function credit(
  key: string, status: string, targeted?: number, achieved?: number
) {
  await asSuperuser(async (c: Client) => {
    await c.query('update tracked_items set status = $2 where id = $1', [w.credits[key], status])
    if (targeted !== undefined) {
      await c.query(
        `update tracked_items
            set ext = ext || jsonb_build_object('credits_targeted', $2::numeric,
                                                'credits_achieved', $3::numeric)
          where id = $1`, [w.credits[key], targeted, achieved ?? targeted])
    }
  })
}

/** Everything verified and fully achieved — the 100% baseline. */
async function fullHouse() {
  await credit('brief', 'Verified', 2, 2)
  await credit('commissioning', 'Verified')
  await credit('handover', 'Verified', 2, 2)
  await credit('energy', 'Verified', 5, 5)
  await credit('water', 'Verified', 3, 3)
  await asSuperuser((c) =>
    c.query(`update breeam_issues set min_standards = '{}'::jsonb where scheme_id = $1`,
      [w.scheme]))
  await asSuperuser((c) =>
    c.query(`update breeam_schemes set building_type = 'Fully fitted' where id = $1`,
      [w.scheme]))
}

beforeAll(async () => {
  w = await asSuperuser(async (c: Client) => {
    const admin = await makePerson(c, 'Ada Admin', 'p11-ada@hbc.example')
    const cara = await makePerson(c, 'Cara Consultant', 'p11-cara@bel.example')
    const outsider = await makePerson(c, 'Otto Outside', 'p11-otto@elsewhere.example')

    const org = (await c.query(
      `insert into organisations (name, slug, status) values ('HBC11','hbc11','active')
       returning id`)).rows[0].id
    for (const [p, role] of [[admin, 'admin'], [cara, 'consultant']] as const) {
      await c.query(
        'insert into organisation_members (organisation_id, profile_id, role) values ($1,$2,$3)',
        [org, p, role])
    }
    const project = (await c.query(
      `insert into projects (organisation_id, name, code) values ($1,'Brackenfield','BRK11')
       returning id`, [org])).rows[0].id
    await c.query(
      `insert into project_members (project_id, profile_id, project_role)
       values ($1,$2,'member')`, [project, cara])

    const arch = (await c.query(
      `insert into companies (project_id, name, originator_code, company_type)
       values ($1,'Bellweather','BEL','consultant') returning id`, [project])).rows[0].id
    await c.query(
      `insert into company_disciplines (company_id, discipline_code) values ($1,'A')`, [arch])

    // Two weighting sets over the same three sections, so switching the type
    // has something to switch to. Each set sums to 1.
    const scheme = (await c.query(
      `insert into breeam_schemes
         (project_id, version, name, building_type, building_types, sections,
          weightings, ratings)
       values ($1, 'TESTSCHEME 1.0', 'Invented for the test', 'Fully fitted',
               array['Fully fitted','Shell and core'],
               $2::jsonb, $3::jsonb, $4::jsonb)
       returning id`,
      [project,
       // MAN's stated total is deliberately 3 where its rows sum to 4: the
       // cross-check has to notice.
       JSON.stringify([{ code: 'AAA', name: 'Section one', stated: 3 },
                       { code: 'BBB', name: 'Section two' },
                       { code: 'CCC', name: 'Section three' }]),
       JSON.stringify({
         'Fully fitted':   { AAA: 0.20, BBB: 0.50, CCC: 0.30 },
         'Shell and core': { AAA: 0.20, BBB: 0.30, CCC: 0.50 } }),
       JSON.stringify([{ name: 'Pass', min: 0.30 }, { name: 'Good', min: 0.45 },
                       { name: 'Very good', min: 0.55 }, { name: 'Excellent', min: 0.70 },
                       { name: 'Outstanding', min: 0.85 }])])).rows[0].id
    await c.query('update projects set breeam_scheme_id = $2 where id = $1', [project, scheme])

    const issues: Record<string, string> = {}
    for (const [key, code, section] of [
      ['a1', 'AAA 01', 'AAA'], ['a2', 'AAA 02', 'AAA'],
      ['b1', 'BBB 01', 'BBB'], ['c1', 'CCC 01', 'CCC'],
    ] as const) {
      issues[key] = (await c.query(
        `insert into breeam_issues (project_id, scheme_id, code, title, section)
         values ($1,$2,$3,$4,$5) returning id`,
        [project, scheme, code, 'Issue ' + code, section])).rows[0].id
    }

    const credits: Record<string, string> = {}
    const mk = async (
      key: string, issue: string, ref: string, title: string,
      available: number, pre = false
    ) => {
      credits[key] = (await c.query(
        `insert into tracked_items
           (project_id, kind, reference, heading, title, breeam_issue_id, company_id, ext)
         values ($1,'breeam',$2,$3,$4,$5,$6,$7::jsonb) returning id`,
        [project, ref, ref.split('.')[0], title, issue, arch,
         JSON.stringify({ is_prerequisite: pre, credits_available: available,
                          credits_targeted: 0, credits_achieved: 0 })])).rows[0].id
    }
    await mk('brief', issues.a1, 'AAA 01.1', 'The brief', 2)
    await mk('commissioning', issues.a2, 'AAA 02.1', 'Commissioning', 0, true)
    await mk('handover', issues.a2, 'AAA 02.2', 'Handover', 2)
    await mk('energy', issues.b1, 'BBB 01.1', 'Energy use', 5)
    await mk('water', issues.c1, 'CCC 01.1', 'Water use', 3)

    return { admin, cara, outsider, org, project, scheme, arch, issues, credits }
  })
})

beforeEach(fullHouse)

describe('the scheme framework', () => {
  test('ships empty', async () => {
    // Nothing in the repository may seed BREEAM content. If a migration ever
    // does, this is where it shows up.
    const scratch = await asSuperuser((c) => c.query(
      `select count(*)::int as n from breeam_schemes where project_id <> $1`, [w.project]))
    expect(scratch.rows[0].n).toBe(0)
  })

  test('a project holds several schemes and names the live one', async () => {
    const second = await asSuperuser((c) => c.query(
      `insert into breeam_schemes (project_id, version) values ($1,'TESTSCHEME 2.0')
       returning id`, [w.project]))
    expect(await asUser(w.admin, (c) =>
      c.query('select breeam_active_scheme($1) as s', [w.project])
        .then((r) => r.rows[0].s))).toBe(w.scheme)

    await asSuperuser((c) => c.query(
      'update projects set breeam_scheme_id = $2 where id = $1', [w.project, second.rows[0].id]))
    expect(await asUser(w.admin, (c) =>
      c.query('select breeam_active_scheme($1) as s', [w.project])
        .then((r) => r.rows[0].s))).toBe(second.rows[0].id)

    // Switching the whole framework switches the score with it: the new
    // version has no sections, so it scores nothing rather than borrowing the
    // old one's figures.
    const t = await totals(second.rows[0].id)
    expect(num(t.available)).toBe(0)
    expect(num(t.score_achieved)).toBe(0)

    await asSuperuser((c) => c.query(
      'update projects set breeam_scheme_id = $2 where id = $1', [w.project, w.scheme]))
    await asSuperuser((c) => c.query('delete from breeam_schemes where id = $1',
      [second.rows[0].id]))
  })

  test('an active building type the scheme does not hold is refused', async () => {
    const why = await refused(() => asSuperuser((c) => c.query(
      `update breeam_schemes set building_type = 'Retail' where id = $1`, [w.scheme])))
    expect(why).toMatch(/breeam_schemes_type_is_held/)
  })

  test('a weighting held as a string is refused', async () => {
    const why = await refused(() => asSuperuser((c) => c.query(
      `update breeam_schemes set weightings = '{"Fully fitted":{"AAA":"0.2"}}'::jsonb
        where id = $1`, [w.scheme])))
    expect(why).toMatch(/weightings_shape/)
  })

  test('an issue cannot point at another project’s scheme', async () => {
    const other = await asSuperuser(async (c: Client) => {
      const p = (await c.query(
        `insert into projects (organisation_id, name, code) values ($1,'Other','OTH11')
         returning id`, [w.org])).rows[0].id
      return p as string
    })
    const why = await refused(() => asSuperuser((c) => c.query(
      `insert into breeam_issues (project_id, scheme_id, code) values ($1,$2,'XXX 01')`,
      [other, w.scheme])))
    expect(why).toMatch(/scheme_matches_project/)
  })
})

describe('section credits are summed, never stated', () => {
  test('available comes from the credit rows', async () => {
    const rows = await asUser(w.admin, (c) => c.query(
      `select code, available, stated, stated_gap from v_breeam_sections
        where scheme_id = $1 order by code`, [w.scheme]).then((r) => r.rows))
    expect(rows.map((r) => [r.code, num(r.available)]))
      .toEqual([['AAA', 4], ['BBB', 5], ['CCC', 3]])
  })

  test('a stated total that disagrees is reported, not used', async () => {
    const rows = await asUser(w.admin, (c) => c.query(
      `select code, stated, stated_gap, score_achieved from v_breeam_sections
        where scheme_id = $1 order by code`, [w.scheme]).then((r) => r.rows))
    const aaa = rows.find((r) => r.code === 'AAA')!
    expect(num(aaa.stated)).toBe(3)
    // The rows say four; the tracker says three. The gap is reported...
    expect(num(aaa.stated_gap)).toBe(1)
    // ...and the score is computed against the rows, so a fully achieved
    // section scores its whole weighting rather than 4/3 of it.
    expect(num(aaa.score_achieved)).toBeCloseTo(0.2, 10)
    // A section with no stated figure has no gap, which is not the same as
    // agreeing.
    expect(rows.find((r) => r.code === 'BBB')!.stated_gap).toBeNull()
  })
})

describe('the hand-worked arithmetic', () => {
  test('everything verified scores 100%', async () => {
    const t = await totals()
    expect(num(t.available)).toBe(12)
    expect(num(t.achieved)).toBe(12)
    expect(num(t.score_achieved)).toBeCloseTo(1, 10)
    expect(num(t.score_targeted)).toBeCloseTo(1, 10)
    expect(t.rating_achieved).toBe('Outstanding')
    expect(t.rating_achieved_on_score).toBe('Outstanding')
    expect(t.capped_achieved).toBe(false)
    expect(num(t.weighting_total)).toBeCloseTo(1, 10)
  })

  test('an unmet prerequisite blocks every credit under its issue', async () => {
    await credit('commissioning', 'Evidence submitted')

    // Evidence the assessor has not accepted is not a credit: the prerequisite
    // is still outstanding, so AAA 02 awards nothing.
    const a2 = await asUser(w.admin, (c) => c.query(
      'select * from v_breeam_issues where id = $1', [w.issues.a2]).then((r) => r.rows[0]))
    expect(num(a2.raw_achieved)).toBe(2)
    expect(num(a2.achieved)).toBe(0)
    expect(num(a2.at_risk)).toBe(2)
    expect(a2.blocked_by).toEqual(['Commissioning'])

    // AAA keeps AAA 01's two of four, so the section scores half its weighting.
    const aaa = await asUser(w.admin, (c) => c.query(
      `select * from v_breeam_sections where scheme_id = $1 and code = 'AAA'`, [w.scheme])
      .then((r) => r.rows[0]))
    expect(num(aaa.achieved)).toBe(2)
    expect(num(aaa.score_achieved)).toBeCloseTo(0.1, 10)

    // 0.10 + 0.50 + 0.30
    const t = await totals()
    expect(num(t.score_achieved)).toBeCloseTo(0.9, 10)
    expect(num(t.at_risk)).toBe(2)
    expect(t.rating_achieved).toBe('Outstanding')
  })

  test('releasing the prerequisite restores the credits', async () => {
    await credit('commissioning', 'Evidence submitted')
    expect(num((await totals()).score_achieved)).toBeCloseTo(0.9, 10)

    await credit('commissioning', 'Verified')
    const t = await totals()
    expect(num(t.score_achieved)).toBeCloseTo(1, 10)
    expect(num(t.at_risk)).toBe(0)
    const a2 = await asUser(w.admin, (c) => c.query(
      'select * from v_breeam_issues where id = $1', [w.issues.a2]).then((r) => r.rows[0]))
    expect(num(a2.blocking)).toBe(0)
    expect(a2.blocked_by).toEqual([])
  })

  test('a minimum standard caps a rating the score alone would clear', async () => {
    // Four of five on BBB 01: 0.20 + 0.40 + 0.30 = 0.90, which clears
    // Outstanding at 0.85.
    await credit('energy', 'Verified', 5, 4)
    expect(num((await totals()).score_achieved)).toBeCloseTo(0.9, 10)
    expect((await totals()).rating_achieved).toBe('Outstanding')

    // Outstanding needs all five credits on this issue.
    await asSuperuser((c) => c.query(
      `update breeam_issues
          set min_standards = '{"Outstanding":{"credits":5,"note":"All five."}}'::jsonb
        where id = $1`, [w.issues.b1]))

    const t = await totals()
    // The score has not moved...
    expect(num(t.score_achieved)).toBeCloseTo(0.9, 10)
    expect(t.rating_achieved_on_score).toBe('Outstanding')
    // ...but the rating has, and the report can say so.
    expect(t.rating_achieved).toBe('Excellent')
    expect(t.capped_achieved).toBe(true)

    const fails = await asUser(w.admin, (c) => c.query(
      `select * from breeam_min_standard_fails($1,'Outstanding','achieved')`, [w.scheme])
      .then((r) => r.rows))
    expect(fails).toHaveLength(1)
    expect(fails[0].code).toBe('BBB 01')
    expect(num(fails[0].needed)).toBe(5)
    expect(num(fails[0].have)).toBe(4)
    expect(fails[0].note).toBe('All five.')

    // Targeted is five, so the TARGET rating is not capped. Both sides of that
    // are the point of reporting them separately: the team is on course for
    // Outstanding and has not got there yet.
    expect(t.rating_targeted).toBe('Outstanding')
    expect(t.capped_targeted).toBe(false)
  })

  test('a zero-credit minimum standard caps only when a prerequisite blocks', async () => {
    // The prototype failed this row unconditionally -- it tested a flag
    // nothing ever set -- which made the achieved rating unreachable on any
    // scheme carrying one. Here it is a criterion: it fails when the issue is
    // blocked, and is otherwise advisory.
    await asSuperuser((c) => c.query(
      `update breeam_issues
          set min_standards = '{"Outstanding":{"credits":0,"note":"A criterion."}}'::jsonb
        where id = $1`, [w.issues.a2]))

    let t = await totals()
    expect(t.rating_achieved).toBe('Outstanding')
    expect(t.capped_achieved).toBe(false)
    const advisory = await asUser(w.admin, (c) => c.query(
      `select * from breeam_advisory_standards($1,'Outstanding')`, [w.scheme])
      .then((r) => r.rows))
    expect(advisory.map((r) => r.code)).toEqual(['AAA 02'])

    await credit('commissioning', 'In progress')
    t = await totals()
    expect(t.capped_achieved).toBe(true)
    const fails = await asUser(w.admin, (c) => c.query(
      `select * from breeam_min_standard_fails($1,'Outstanding','achieved')`, [w.scheme])
      .then((r) => r.rows))
    expect(fails.map((r) => r.code)).toEqual(['AAA 02'])
  })

  test('switching the building type rescores the same credits', async () => {
    await credit('energy', 'Verified', 5, 4)
    // Fully fitted: 0.20 + (4/5 * 0.50) + 0.30 = 0.90
    expect(num((await totals()).score_achieved)).toBeCloseTo(0.9, 10)

    await asSuperuser((c) => c.query(
      `update breeam_schemes set building_type = 'Shell and core' where id = $1`, [w.scheme]))
    // Shell and core: 0.20 + (4/5 * 0.30) + 0.50 = 0.94
    const t = await totals()
    expect(t.building_type).toBe('Shell and core')
    expect(num(t.score_achieved)).toBeCloseTo(0.94, 10)
    expect(num(t.achieved)).toBe(11)   // the credits themselves have not moved
  })

  test('a scheme with no weighting set scores nothing rather than guessing', async () => {
    await asSuperuser((c) => c.query(
      `update breeam_schemes set building_type = null, building_types = '{}' where id = $1`,
      [w.scheme]))
    const t = await totals()
    expect(t.building_type).toBeNull()
    expect(num(t.achieved)).toBe(12)          // the credits are still there
    expect(num(t.score_achieved)).toBe(0)      // but nothing weights them
    expect(t.rating_achieved).toBeNull()
    await asSuperuser((c) => c.query(
      `update breeam_schemes
          set building_types = array['Fully fitted','Shell and core'],
              building_type = 'Fully fitted'
        where id = $1`, [w.scheme]))
  })
})

describe('credit rows', () => {
  test('a prerequisite carries no credits whatever the data says', async () => {
    await asSuperuser((c) => c.query(
      `update tracked_items
          set ext = ext || '{"credits_available":3,"credits_targeted":3,"credits_achieved":3}'
        where id = $1`, [w.credits.commissioning]))
    const row = await asUser(w.admin, (c) => c.query(
      'select * from v_breeam_credits where id = $1', [w.credits.commissioning])
      .then((r) => r.rows[0]))
    expect(row.is_prerequisite).toBe(true)
    expect(num(row.available)).toBe(0)
    expect(num(row.targeted)).toBe(0)
    expect(num(row.achieved)).toBe(0)
    await asSuperuser((c) => c.query(
      `update tracked_items
          set ext = ext || '{"credits_available":0,"credits_targeted":0,"credits_achieved":0}'
        where id = $1`, [w.credits.commissioning]))
  })

  test('an unassigned credit is a gap, and reads as one', async () => {
    await asSuperuser((c) => c.query(
      `update tracked_items set company_id = null, person_id = null, status = 'Not started'
        where id = $1`, [w.credits.water]))
    const s = await asUser(w.admin, (c) => c.query(
      `select st.* from v_breeam_credits c,
        lateral breeam_credit_state(c.status, c.is_prerequisite, c.met, c.company_id,
                                    c.person_id, c.due) st
        where c.id = $1`, [w.credits.water]).then((r) => r.rows[0]))
    expect(s.state).toBe('Unassigned')
    expect(s.kind).toBe('gap')
    await asSuperuser((c) => c.query(
      'update tracked_items set company_id = $2 where id = $1', [w.credits.water, w.arch]))
  })

  test('Verified is done and Not targeted is never overdue', async () => {
    await asSuperuser((c) => c.query(
      `update tracked_items set status = 'Not targeted', due_date_override = '2020-01-01'
        where id = $1`, [w.credits.water]))
    const rows = await asUser(w.admin, (c) => c.query(
      `select id, status, is_done, overdue from v_tracked_items
        where breeam_issue_id is not null and project_id = $1`, [w.project])
      .then((r) => r.rows))
    const water = rows.find((r) => r.id === w.credits.water)!
    expect(water.is_done).toBe(false)
    // Nobody is going for it, so it is not late. A permanent red row for a
    // credit the team has correctly skipped is how a tracker stops being read.
    expect(water.overdue).toBe(false)
    expect(rows.find((r) => r.id === w.credits.brief)!.is_done).toBe(true)
    await asSuperuser((c) => c.query(
      `update tracked_items set due_date_override = null where id = $1`, [w.credits.water]))
  })

  test('a credit cannot claim more than the issue offers', async () => {
    const why = await refused(() => asSuperuser((c) => c.query(
      `update tracked_items set ext = ext || '{"credits_achieved":9}' where id = $1`,
      [w.credits.brief])))
    expect(why).toMatch(/tracked_items_breeam_ext/)
  })

  test('a credit with no issue, and a non-credit with one, are both refused', async () => {
    expect(await refused(() => asSuperuser((c) => c.query(
      `insert into tracked_items (project_id, kind, reference, title)
       values ($1,'breeam','X.1','Orphan')`, [w.project]))))
      .toMatch(/breeam_has_issue/)
    expect(await refused(() => asSuperuser((c) => c.query(
      `insert into tracked_items (project_id, kind, reference, title, breeam_issue_id)
       values ($1,'planning','PC-99','Not a credit',$2)`, [w.project, w.issues.a1]))))
      .toMatch(/breeam_has_issue/)
  })
})

describe('set_breeam_credit', () => {
  test('moves the numbers and refuses the impossible ones', async () => {
    await asUser(w.cara, (c) => c.query('select set_breeam_credit($1,1,1)', [w.credits.brief]))
    expect(num(await asUser(w.admin, (c) => c.query(
      'select targeted from v_breeam_credits where id = $1', [w.credits.brief])
      .then((r) => r.rows[0].targeted)))).toBe(1)

    expect(await denied(w.cara, 'select set_breeam_credit($1,3,0)', [w.credits.brief]))
      .toMatch(/offers 2 credit/)
    expect(await denied(w.cara, 'select set_breeam_credit($1,-1,0)', [w.credits.brief]))
      .toMatch(/negative/)
    // Pass or fail. A prerequisite with a credit count is a category error.
    expect(await denied(w.cara, 'select set_breeam_credit($1,1,1)',
      [w.credits.commissioning])).toMatch(/pass or fail/)
    // A definer function is not a way round the audience.
    expect(await denied(w.outsider, 'select set_breeam_credit($1,1,1)', [w.credits.brief]))
      .toMatch(/No such credit/)
  })
})

describe('the imports', () => {
  const sectionRow = (o: Record<string, string>) => ({
    section_code: '', section_name: '', building_type: '',
    weighting_percent: '', stated_credits_available: '', ...o,
  })
  const creditRow = (o: Record<string, string>) => ({
    section_code: '', issue_code: '', issue_title: '', requirement: '', advisory_note: '',
    type: '', credits_available: '', programme_task_id: '', offset_days: '', ...o,
  })

  /** A scheme of its own, so an import cannot disturb the arithmetic above. */
  let scratch: string
  beforeEach(async () => {
    scratch = await asSuperuser((c) => c.query(
      `insert into breeam_schemes (project_id, version) values ($1,$2) returning id`,
      [w.project, 'SCRATCH ' + Math.random().toString(36).slice(2, 8)])
      .then((r) => r.rows[0].id))
  })

  const apply = (kind: string, rows: unknown[], who = w.admin) =>
    asUser(who, (c) => c.query('select * from breeam_import_apply($1,$2,$3::jsonb)',
      [scratch, kind, JSON.stringify(rows)]).then((r) => r.rows[0]))

  test('a missing column rejects the whole file', async () => {
    const why = await denied(w.admin,
      'select * from breeam_import_validate($1,$2,$3::jsonb)',
      [scratch, 'sections', JSON.stringify([{ section_code: 'AAA' }])])
    expect(why).toMatch(/Missing column\(s\)/)
    expect(why).toMatch(/weighting_percent/)
    // And nothing was written.
    expect(await asUser(w.admin, (c) => c.query(
      'select sections from breeam_schemes where id = $1', [scratch])
      .then((r) => r.rows[0].sections))).toEqual([])
  })

  test('an empty file is refused rather than applied as a no-op', async () => {
    expect(await denied(w.admin, 'select * from breeam_import_apply($1,$2,$3::jsonb)',
      [scratch, 'sections', '[]'])).toMatch(/empty/)
  })

  test('a bad number is one rejected row, not a rejected file', async () => {
    const rows = [
      sectionRow({ section_code: 'AAA', section_name: 'One', weighting_percent: '12' }),
      sectionRow({ section_code: 'BBB', section_name: 'Two', weighting_percent: 'twelve' }),
      sectionRow({ section_code: '', section_name: 'Nameless' }),
    ]
    const v = await asUser(w.admin, (c) => c.query(
      'select * from breeam_import_validate($1,$2,$3::jsonb) order by line',
      [scratch, 'sections', JSON.stringify(rows)]).then((r) => r.rows))
    expect(v.map((r) => [r.line, r.accepted])).toEqual([[2, true], [3, false], [4, false]])
    expect(v[1].why).toMatch(/Weighting Percent is not a number/)
    expect(v[2].why).toMatch(/Section Code is blank/)

    const pv = await asUser(w.admin, (c) => c.query(
      'select * from breeam_import_preview($1,$2,$3::jsonb)',
      [scratch, 'sections', JSON.stringify(rows)]).then((r) => r.rows[0]))
    expect([pv.creating, pv.updating, pv.rejected]).toEqual([1, 0, 2])

    const r = await apply('sections', rows)
    expect([r.created, r.updated, r.rejected]).toEqual([1, 0, 2])
  })

  test('a percentage becomes a fraction', async () => {
    await apply('sections', [sectionRow({
      section_code: 'AAA', section_name: 'One', building_type: 'Fully fitted',
      weighting_percent: '12' })])
    expect(num(await asUser(w.admin, (c) => c.query(
      `select breeam_weighting($1,'AAA') as w`, [scratch]).then((r) => r.rows[0].w))))
      .toBeCloseTo(0.12, 10)
  })

  test('a later blank does not erase what an earlier row supplied', async () => {
    // The trap: a weighting file carries one row per section PER BUILDING
    // TYPE, so the same section repeats and only the first row states its
    // name and its stated total.
    await apply('sections', [
      sectionRow({ section_code: 'AAA', section_name: 'Section one',
                   building_type: 'Fully fitted', weighting_percent: '12',
                   stated_credits_available: '21' }),
      sectionRow({ section_code: 'AAA', building_type: 'Shell and core',
                   weighting_percent: '15' }),
    ])
    const s = await asUser(w.admin, (c) => c.query(
      'select sections, weightings, building_types, building_type from breeam_schemes where id = $1',
      [scratch]).then((r) => r.rows[0]))
    expect(s.sections).toEqual([{ code: 'AAA', name: 'Section one', stated: 21 }])
    expect(s.weightings).toEqual({
      'Fully fitted': { AAA: 0.12 }, 'Shell and core': { AAA: 0.15 } })
    expect(s.building_types).toEqual(['Fully fitted', 'Shell and core'])
    // The first type loaded becomes the active one, so the import is visible
    // rather than scoring zero and reading as broken.
    expect(s.building_type).toBe('Fully fitted')
  })

  test('credits create their issue, and a prerequisite carries none', async () => {
    const r = await apply('credits', [
      creditRow({ section_code: 'AAA', issue_code: 'AAA 01', issue_title: 'Issue one',
                  requirement: 'First requirement', type: 'Credit',
                  credits_available: '2', programme_task_id: '1230', offset_days: '-5' }),
      creditRow({ section_code: 'AAA', issue_code: 'AAA 01',
                  requirement: 'A gate', advisory_note: 'Blocks the issue.',
                  type: 'Prerequisite', credits_available: '3' }),
    ])
    expect(r.created).toBe(3)   // the issue plus two credits

    const rows = await asUser(w.admin, (c) => c.query(
      `select reference, title, is_prerequisite, available, programme_task_uid, offset_days
         from v_breeam_credits where scheme_id = $1 order by reference`, [scratch])
      .then((r2) => r2.rows))
    // The fixture scheme on this project already holds AAA 01.1, so the ordinal
    // continues from there rather than colliding with it: tracked_items is
    // unique on (project, kind, reference) and a project holds several schemes.
    expect(rows.map((x) => [x.reference, x.title, x.is_prerequisite, num(x.available)]))
      .toEqual([
        ['AAA 01.2', 'First requirement', false, 2],
        // "Prerequisite" wins over the 3 the file claimed: pass or fail.
        ['AAA 01.3', 'A gate', true, 0]])
    expect(rows[0].programme_task_uid).toBe('1230')
    expect(rows[0].offset_days).toBe(-5)
  })

  test('a reference not yet used on the project starts at .1', async () => {
    await apply('credits', [creditRow({ section_code: 'ZZZ', issue_code: 'ZZZ 01',
      requirement: 'Only requirement', type: 'Credit', credits_available: '1' })])
    expect(await asUser(w.admin, (c) => c.query(
      'select reference from v_breeam_credits where scheme_id = $1', [scratch])
      .then((r) => r.rows[0].reference))).toBe('ZZZ 01.1')
  })

  test('re-importing updates the credit rather than adding a second', async () => {
    const row = creditRow({ section_code: 'AAA', issue_code: 'AAA 01',
      issue_title: 'Issue one', requirement: 'First requirement', type: 'Credit',
      credits_available: '4' })
    await apply('credits', [row])
    const id = await asUser(w.admin, (c) => c.query(
      'select id from v_breeam_credits where scheme_id = $1', [scratch])
      .then((r) => r.rows[0].id))
    await asUser(w.admin, (c) => c.query('select set_breeam_credit($1,4,4)', [id]))

    // The scheme is authoritative about how many credits exist, so a reduced
    // total clamps what the team had claimed instead of refusing the row.
    const r = await apply('credits', [{ ...row, credits_available: '2' }])
    expect([r.created, r.updated]).toEqual([0, 1])
    const rows = await asUser(w.admin, (c) => c.query(
      'select available, targeted, achieved from v_breeam_credits where scheme_id = $1',
      [scratch]).then((r2) => r2.rows))
    expect(rows).toHaveLength(1)
    expect([num(rows[0].available), num(rows[0].targeted), num(rows[0].achieved)])
      .toEqual([2, 2, 2])
  })

  test('a minimum standard for an unknown issue is an orphan, not a write', async () => {
    const v = await asUser(w.admin, (c) => c.query(
      'select * from breeam_import_validate($1,$2,$3::jsonb)',
      [scratch, 'minstd', JSON.stringify([
        { issue_code: 'ZZZ 99', rating: 'Excellent', credits_required: '4', note: '' }])])
      .then((r) => r.rows))
    expect(v[0].accepted).toBe(false)
    expect(v[0].why).toMatch(/No issue ZZZ 99/)
  })

  test('minimum standards load onto their issue', async () => {
    await apply('credits', [creditRow({
      section_code: 'AAA', issue_code: 'AAA 01', requirement: 'First requirement',
      type: 'Credit', credits_available: '4' })])
    const r = await apply('minstd', [
      { issue_code: 'AAA 01', rating: 'Excellent', credits_required: '4', note: 'All four.' }])
    expect(r.updated).toBe(1)
    expect(await asUser(w.admin, (c) => c.query(
      'select min_standards from breeam_issues where scheme_id = $1', [scratch])
      .then((x) => x.rows[0].min_standards)))
      .toEqual({ Excellent: { credits: 4, note: 'All four.' } })
  })

  test('a consultant cannot load a framework', async () => {
    expect(await denied(w.cara, 'select * from breeam_import_apply($1,$2,$3::jsonb)',
      [scratch, 'sections', JSON.stringify([sectionRow({ section_code: 'AAA' })])]))
      .toMatch(/Not permitted/)
  })
})

describe('who may do what', () => {
  test('a project member reads the framework; an outsider sees nothing', async () => {
    expect((await asUser(w.cara, (c) => c.query(
      'select id from breeam_schemes where project_id = $1', [w.project]))).rowCount)
      .toBeGreaterThan(0)
    expect((await asUser(w.outsider, (c) => c.query(
      'select id from breeam_schemes where project_id = $1', [w.project]))).rowCount).toBe(0)
    expect((await asUser(w.outsider, (c) => c.query(
      'select id from v_breeam_credits where project_id = $1', [w.project]))).rowCount).toBe(0)
  })

  test('the scoring basis is outside the update grant', async () => {
    // A member who could rewrite the weightings could change every figure in
    // the report without a single credit moving.
    for (const col of ['weightings', 'sections', 'ratings']) {
      expect(await denied(w.cara,
        `update breeam_schemes set ${col} = '{}'::jsonb where id = $1`, [w.scheme]))
        .toMatch(/permission denied/i)
    }
    expect(await denied(w.cara,
      `update breeam_issues set min_standards = '{}'::jsonb where id = $1`, [w.issues.b1]))
      .toMatch(/permission denied/i)
    // ext is the score. set_breeam_credit() is the only way in.
    expect(await denied(w.cara,
      `update tracked_items set ext = '{}'::jsonb where id = $1`, [w.credits.brief]))
      .toMatch(/permission denied/i)
    // Moving a credit to another issue moves it between sections, and so
    // between weightings: that is a reassignment of the scheme, not an edit.
    expect(await denied(w.cara,
      'update tracked_items set breeam_issue_id = $2 where id = $1',
      [w.credits.brief, w.issues.b1])).toMatch(/permission denied/i)
  })

  test('a consultant may still work their own credit', async () => {
    await asUser(w.cara, (c) => c.query(
      `update tracked_items set status = 'In progress' where id = $1`, [w.credits.brief]))
    expect(await asUser(w.admin, (c) => c.query(
      'select status from tracked_items where id = $1', [w.credits.brief])
      .then((r) => r.rows[0].status))).toBe('In progress')
  })
})
