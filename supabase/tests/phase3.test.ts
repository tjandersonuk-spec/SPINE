/**
 * Phase 3 — the design responsibility matrix.
 *
 * The assertions TASKS.md names: reassigning a lead updates the live lookup
 * immediately; an item whose lead discipline nobody holds is a gap; and the
 * dashboard gap count equals the matrix gap count. Plus the two failures that
 * wear the same colour, which the report has to tell apart.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import type { Client } from 'pg'
import { asSuperuser, asUser, makePerson, refused } from './db'

type World = {
  admin: string; consultant: string; outsider: string; stranger: string
  org: string; project: string
}
let w: World

beforeAll(async () => {
  w = await asSuperuser(async (c: Client) => {
    const admin = await makePerson(c, 'Ada Admin', 'p3-ada@hbc.example')
    const consultant = await makePerson(c, 'Cara Consultant', 'p3-cara@bel.example')
    const outsider = await makePerson(c, 'Otto Outsider', 'p3-otto@nowhere.example')
    const stranger = await makePerson(c, 'Stan Stranger', 'p3-stan@rival.example')

    const org = (await c.query(
      `insert into organisations (name, slug, status) values ('HBC3','hbc3','active')
       returning id`)).rows[0].id
    const rival = (await c.query(
      `insert into organisations (name, slug, status) values ('Rival3','rival3','active')
       returning id`)).rows[0].id
    for (const [o, p, role] of [
      [org, admin, 'admin'], [org, consultant, 'consultant'], [rival, stranger, 'admin'],
    ] as const) {
      await c.query(
        'insert into organisation_members (organisation_id, profile_id, role) values ($1,$2,$3)',
        [o, p, role])
    }
    const project = (await c.query(
      `insert into projects (organisation_id, name, code) values ($1,'Kingsmead','KMW3')
       returning id`, [org])).rows[0].id
    await c.query(
      `insert into project_members (project_id, profile_id, project_role)
       values ($1,$2,'member')`, [project, consultant])
    return { admin, consultant, outsider, stranger, org, project }
  })
})

describe('the published library', () => {
  test('is the prototype\'s hundred items across nine categories', async () => {
    await asUser(w.admin, async (c) => {
      const { rows } = await c.query('select * from account_drm_library($1)', [w.org])
      expect(rows).toHaveLength(100)
      expect(new Set(rows.map((r) => r.category_code)).size).toBe(9)
      expect(rows.every((r) => r.category_name)).toBe(true)
    })
  })

  test('three interface items ship with no default lead, on purpose', async () => {
    await asUser(w.admin, async (c) => {
      const { rows } = await c.query(
        'select ref, guidance_note from account_drm_library($1) where default_lead_discipline is null',
        [w.org])
      expect(rows.map((r) => r.ref)).toEqual(['09.010', '09.020', '09.050'])
      // the note says why, because a blank that looks like an oversight is one
      expect(rows.every((r) => /deliberately/i.test(r.guidance_note))).toBe(true)
    })
  })

  test('the CDP flag survived the import', async () => {
    await asUser(w.admin, async (c) => {
      const { rows } = await c.query(
        'select count(*) from account_drm_library($1) where cdp_likely', [w.org])
      expect(Number(rows[0].count)).toBe(44)
    })
  })

  test('another account cannot read this one\'s library', async () => {
    await asUser(w.stranger, async (c) => {
      expect((await c.query('select * from account_drm_library($1)', [w.org])).rows)
        .toHaveLength(0)
    })
  })
})

describe('loading a matrix into a project', () => {
  test('a project admin can load it, and it is a snapshot', async () => {
    await asUser(w.admin, async (c) => {
      const msg = (await c.query('select load_drm_into_project($1) as m', [w.project])).rows[0].m
      expect(msg).toMatch(/Loaded 100 items/)
      const version = (await c.query('select drm_library_version from projects where id = $1',
        [w.project])).rows[0].drm_library_version
      expect(version).toBe('published-1')
    })
  })

  test('editing the library afterwards does not touch the project', async () => {
    await asUser(w.admin, async (c) => {
      await c.query('select fork_drm_library($1)', [w.org])
      await c.query(
        `update drm_library_items set item = 'Renamed in the library'
         where organisation_id = $1 and ref = '01.010'`, [w.org])
      const { rows } = await c.query(
        `select item from drm_items where project_id = $1 and ref = '01.010'`, [w.project])
      expect(rows[0].item).toBe('Topographical and measured building survey')
    })
  })

  test('it refuses to load twice', async () => {
    await asUser(w.admin, async (c) => {
      const msg = await refused(() => c.query('select load_drm_into_project($1)', [w.project]))
      expect(msg).toMatch(/already has a matrix/)
    })
  })

  test('a consultant on the project cannot load or edit it', async () => {
    const other = await asSuperuser(async (c) =>
      (await c.query(
        `insert into projects (organisation_id, name, code) values ($1,'Second','SEC3')
         returning id`, [w.org])).rows[0].id)
    await asUser(w.consultant, async (c) => {
      const msg = await refused(() => c.query('select load_drm_into_project($1)', [other]))
      expect(msg).toMatch(/not permitted/)
    })
  })
})

describe('the matrix names a discipline, never a company', () => {
  beforeAll(async () => {
    // appoint an architect and a structural engineer
    await asUser(w.admin, async (c) => {
      for (const [name, code, disc] of [
        ['Bellhouse Architects', 'BEL', 'A'],
        ['Craven Wells Consulting', 'CWC', 'S'],
      ] as const) {
        const cat = (await c.query(
          `insert into catalogue_companies (organisation_id, name) values ($1,$2) returning id`,
          [w.org, name])).rows[0].id
        await c.query(
          `select add_company_to_project($1,$2,$3,'consultant', array[$4])`,
          [w.project, cat, code, disc])
      }
    })
  })

  test('reassigning a lead updates the live lookup immediately', async () => {
    await asUser(w.admin, async (c) => {
      const item = (await c.query(
        `select id from drm_items where project_id = $1 and ref = '02.010'`, [w.project]
      )).rows[0].id   // foundation design, led by S

      const before = (await c.query(
        `select company_name from drm_leads($1) where drm_item_id = $2`, [w.project, item])).rows
      expect(before.map((r) => r.company_name)).toEqual(['Craven Wells Consulting'])

      // one write, to the matrix item — nothing else is touched
      await c.query(`select set_drm_lead($1,'A')`, [item])

      const after = (await c.query(
        `select company_name from drm_leads($1) where drm_item_id = $2`, [w.project, item])).rows
      expect(after.map((r) => r.company_name)).toEqual(['Bellhouse Architects'])
    })
  })

  test('novating a discipline moves every item that leads on it, with no write to the matrix', async () => {
    await asUser(w.admin, async (c) => {
      const led = async () =>
        (await c.query(
          `select count(*) from drm_leads($1) where lead_discipline = 'A'
             and company_name = 'Bellhouse Architects'`, [w.project])).rows[0].count

      const beforeCount = Number(await led())
      expect(beforeCount).toBeGreaterThan(5)

      // the architect is novated: a new firm picks up discipline A
      const newco = (await c.query(
        `insert into catalogue_companies (organisation_id, name) values ($1,'Studio Marn')
         returning id`, [w.org])).rows[0].id
      const bel = (await c.query(
        `select id from companies where project_id = $1 and originator_code = 'BEL'`,
        [w.project])).rows[0].id
      await c.query(`delete from company_disciplines where company_id = $1 and discipline_code = 'A'`,
        [bel])
      await c.query(`select add_company_to_project($1,$2,'SMA','consultant', array['A'])`,
        [w.project, newco])

      // every one of those items now leads to the new firm, and the matrix was
      // never written to
      const nowLed = Number((await c.query(
        `select count(*) from drm_leads($1) where lead_discipline = 'A'
           and company_name = 'Studio Marn'`, [w.project])).rows[0].count)
      expect(nowLed).toBe(beforeCount)
      expect(Number(await led())).toBe(0)
    })
  })
})

describe('the gap report — two failures, one colour', () => {
  test('an item with no lead at all is a gap, and says so', async () => {
    await asUser(w.admin, async (c) => {
      const { rows } = await c.query(
        `select ref, gap_reason from drm_gaps($1) where ref in ('09.010','09.020','09.050')`,
        [w.project])
      expect(rows).toHaveLength(3)
      expect(rows.every((r) => r.gap_reason === 'No lead discipline assigned')).toBe(true)
    })
  })

  test('an item whose lead discipline nobody holds is a different gap', async () => {
    await asUser(w.admin, async (c) => {
      const { rows } = await c.query(
        `select gap_reason from drm_gaps($1) where lead_discipline = 'FS' limit 1`, [w.project])
      expect(rows[0].gap_reason)
        .toBe('Discipline FS is not held by any appointed company')
    })
  })

  test('appointing the discipline closes every gap that named it, at once', async () => {
    await asUser(w.admin, async (c) => {
      const before = Number((await c.query(
        `select count(*) from drm_gaps($1) where lead_discipline = 'FS'`, [w.project]))
        .rows[0].count)
      expect(before).toBeGreaterThan(0)

      const cat = (await c.query(
        `insert into catalogue_companies (organisation_id, name) values ($1,'Ridley Fire')
         returning id`, [w.org])).rows[0].id
      await c.query(`select add_company_to_project($1,$2,'RFC','consultant', array['FS'])`,
        [w.project, cat])

      expect(Number((await c.query(
        `select count(*) from drm_gaps($1) where lead_discipline = 'FS'`, [w.project]))
        .rows[0].count)).toBe(0)
    })
  })

  test('an item marked not applicable is not a gap', async () => {
    await asUser(w.admin, async (c) => {
      const before = (await c.query('select drm_gap_count($1) as n', [w.project])).rows[0].n
      const victim = (await c.query(
        `select drm_item_id from drm_gaps($1) limit 1`, [w.project])).rows[0].drm_item_id
      await c.query('update drm_items set applicable = false where id = $1', [victim])
      expect((await c.query('select drm_gap_count($1) as n', [w.project])).rows[0].n)
        .toBe(before - 1)
      await c.query('update drm_items set applicable = true where id = $1', [victim])
    })
  })

  test('a discipline struck out for this job cannot be a gap', async () => {
    await asUser(w.admin, async (c) => {
      const before = Number((await c.query(
        `select count(*) from drm_gaps($1) where lead_discipline = 'VT'`, [w.project]))
        .rows[0].count)
      expect(before).toBeGreaterThan(0)
      await c.query(
        `insert into project_disciplines (project_id, discipline_code, required)
         values ($1,'VT',false)
         on conflict (project_id, discipline_code) do update set required = false`, [w.project])
      expect(Number((await c.query(
        `select count(*) from drm_gaps($1) where lead_discipline = 'VT'`, [w.project]))
        .rows[0].count)).toBe(0)
    })
  })

  test('the dashboard count equals the matrix count, because it is the same query', async () => {
    await asUser(w.admin, async (c) => {
      const listed = Number((await c.query(
        'select count(*) from drm_gaps($1)', [w.project])).rows[0].count)
      const counted = (await c.query('select drm_gap_count($1) as n', [w.project])).rows[0].n
      expect(counted).toBe(listed)
    })
  })
})

describe('who may read and change the matrix', () => {
  test('a consultant on the project reads it and its gaps', async () => {
    await asUser(w.consultant, async (c) => {
      expect((await c.query('select count(*) from drm_items where project_id = $1', [w.project]))
        .rows[0].count).toBe('100')
      expect(Number((await c.query('select drm_gap_count($1) as n', [w.project])).rows[0].n))
        .toBeGreaterThan(0)
    })
  })

  test('a consultant cannot change a lead', async () => {
    await asUser(w.consultant, async (c) => {
      const item = (await c.query(
        `select id from drm_items where project_id = $1 limit 1`, [w.project])).rows[0].id
      const msg = await refused(() => c.query(`select set_drm_lead($1,'A')`, [item]))
      expect(msg).toMatch(/not permitted/)
      const direct = await c.query(
        `update drm_items set lead_discipline = 'A' where id = $1`, [item])
      expect(direct.rowCount).toBe(0)
    })
  })

  test('nobody outside the project sees the matrix at all', async () => {
    for (const who of [w.stranger, w.outsider]) {
      await asUser(who, async (c) => {
        expect((await c.query('select id from drm_items where project_id = $1', [w.project])).rows)
          .toHaveLength(0)
        expect((await c.query('select * from drm_gaps($1)', [w.project])).rows).toHaveLength(0)
        expect((await c.query('select drm_gap_count($1) as n', [w.project])).rows[0].n).toBe(0)
      })
    }
  })

  test('clearing a lead is allowed, because saying nobody owns it is the point', async () => {
    await asUser(w.admin, async (c) => {
      const item = (await c.query(
        `select id from drm_items where project_id = $1 and ref = '02.010'`, [w.project]
      )).rows[0].id
      await c.query('select set_drm_lead($1, null)', [item])
      const { rows } = await c.query(
        `select gap_reason from drm_gaps($1) where drm_item_id = $2`, [w.project, item])
      expect(rows[0].gap_reason).toBe('No lead discipline assigned')
    })
  })
})

describe('drm_leads is scoped to its own project', () => {
  test('another project holding the same discipline does not leak in', async () => {
    // The bug this guards: joining company_disciplines on the code alone
    // matches every project, and an unrelated job's architect appears beside
    // this one's — or as a null row next to it.
    const other = await asSuperuser(async (c) => {
      const other = (await c.query(
        `insert into projects (organisation_id, name, code) values ($1,'Elsewhere','ELS3')
         returning id`, [w.org])).rows[0].id
      const cat = (await c.query(
        `insert into catalogue_companies (organisation_id, name) values ($1,'Other Architects')
         returning id`, [w.org])).rows[0].id
      const co = (await c.query(
        `insert into companies (project_id, catalogue_company_id, name, originator_code,
                                company_type)
         values ($1,$2,'Other Architects','OTH','consultant') returning id`, [other, cat])).rows[0].id
      await c.query(
        `insert into company_disciplines (company_id, discipline_code) values ($1,'A')`, [co])
      return other
    })
    void other

    await asUser(w.admin, async (c) => {
      const { rows } = await c.query(
        `select company_name from drm_leads($1) where lead_discipline = 'A'`, [w.project])
      expect(rows.map((r) => r.company_name)).not.toContain('Other Architects')
      expect(rows.every((r) => r.company_name !== null)).toBe(true)
    })
  })

  test('an item whose discipline nobody holds returns one null holder, not none', async () => {
    await asUser(w.admin, async (c) => {
      const { rows } = await c.query(
        `select company_id, company_name from drm_leads($1) where lead_discipline = 'EC'`,
        [w.project])
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((r) => r.company_id === null)).toBe(true)
    })
  })
})

describe('the disciplines beside the lead', () => {
  test('a discipline holds one role on an item, never two', async () => {
    const item = (await asUser(w.admin, (c) =>
      c.query('select id from drm_items where project_id = $1 limit 1', [w.project]))).rows[0].id

    await asUser(w.admin, (c) => c.query(
      `insert into drm_roles (drm_item_id, discipline_code, role_code) values ($1,'S','R')`,
      [item]))

    // The primary key is (item, discipline): setting a second role replaces the
    // first rather than adding one. A discipline that both reviews and approves
    // is exactly the ambiguity the codes exist to prevent.
    await asUser(w.admin, (c) => c.query(
      `insert into drm_roles (drm_item_id, discipline_code, role_code) values ($1,'S','A')
       on conflict (drm_item_id, discipline_code) do update set role_code = excluded.role_code`,
      [item]))

    const r = await asUser(w.admin, (c) =>
      c.query(`select role_code from drm_roles where drm_item_id = $1 and discipline_code = 'S'`,
        [item]))
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].role_code).toBe('A')
  })

  test('only the five ISO roles are accepted', async () => {
    const item = (await asUser(w.admin, (c) =>
      c.query('select id from drm_items where project_id = $1 limit 1', [w.project]))).rows[0].id
    expect(await refused(() => asUser(w.admin, (c) => c.query(
      `insert into drm_roles (drm_item_id, discipline_code, role_code) values ($1,'M','Z')`,
      [item])))).toMatch(/role_code/)
  })

  test('a consultant reads the roles but cannot set them', async () => {
    const seen = await asUser(w.consultant, (c) =>
      c.query(`select count(*)::int as n from drm_roles r
               join drm_items i on i.id = r.drm_item_id where i.project_id = $1`, [w.project]))
    expect(seen.rows[0].n).toBeGreaterThan(0)

    const item = (await asUser(w.admin, (c) =>
      c.query('select id from drm_items where project_id = $1 limit 1', [w.project]))).rows[0].id
    expect(await refused(() => asUser(w.consultant, (c) => c.query(
      `insert into drm_roles (drm_item_id, discipline_code, role_code) values ($1,'E','I')`,
      [item])))).toMatch(/row-level security/)
  })

  test('the three transfer fields are stored and readable', async () => {
    const item = (await asUser(w.admin, (c) =>
      c.query('select id from drm_items where project_id = $1 limit 1', [w.project]))).rows[0].id
    await asUser(w.admin, (c) => c.query(
      `update drm_items set transfers_at_stage='4', cdp_package='Curtain walling',
              level_of_information='LOD 350' where id = $1`, [item]))
    const r = await asUser(w.consultant, (c) =>
      c.query(`select transfers_at_stage, cdp_package, level_of_information
               from drm_items where id = $1`, [item]))
    expect(r.rows[0]).toEqual({
      transfers_at_stage: '4', cdp_package: 'Curtain walling', level_of_information: 'LOD 350',
    })
  })
})

describe('editing a template never rewrites a project', () => {
  test('a forked library is the account’s own, and the published one is untouchable', async () => {
    // The published library belongs to everyone; only a fork is editable.
    const published = await asUser(w.admin, (c) =>
      c.query(`select id, item from drm_library_items where organisation_id is null limit 1`))
    await asUser(w.admin, (c) =>
      c.query(`update drm_library_items set item = 'Tampered' where id = $1`,
        [published.rows[0].id]))
    const after = await asUser(w.admin, (c) =>
      c.query('select item from drm_library_items where id = $1', [published.rows[0].id]))
    expect(after.rows[0].item).toBe(published.rows[0].item)
  })

  test('editing the fork leaves a project that already loaded it alone', async () => {
    await asUser(w.admin, (c) => c.query('select fork_drm_library($1)', [w.org]))

    const before = await asUser(w.admin, (c) =>
      c.query('select id, item from drm_items where project_id = $1 order by ref limit 1',
        [w.project]))
    const projectItem = before.rows[0]

    // Change the same item in the account's library.
    await asUser(w.admin, (c) => c.query(
      `update drm_library_items set item = 'Reworded in the template'
       where organisation_id = $1 and item = $2`, [w.org, projectItem.item]))

    const after = await asUser(w.admin, (c) =>
      c.query('select item from drm_items where id = $1', [projectItem.id]))
    expect(after.rows[0].item).toBe(projectItem.item)
  })

  test('a bespoke item can be added to a project without touching the library', async () => {
    const libBefore = await asUser(w.admin, (c) =>
      c.query('select count(*)::int as n from drm_library_items where organisation_id = $1',
        [w.org]))

    await asUser(w.admin, (c) => c.query(
      `insert into drm_items (project_id, ref, category_code, item, lead_discipline, applicable)
       values ($1,'09.900','09','Bespoke interface on this job only','A',true)`, [w.project]))

    const seen = await asUser(w.consultant, (c) =>
      c.query(`select item from drm_items where project_id = $1 and ref = '09.900'`, [w.project]))
    expect(seen.rows).toHaveLength(1)

    const libAfter = await asUser(w.admin, (c) =>
      c.query('select count(*)::int as n from drm_library_items where organisation_id = $1',
        [w.org]))
    expect(libAfter.rows[0].n).toBe(libBefore.rows[0].n)
  })
})
