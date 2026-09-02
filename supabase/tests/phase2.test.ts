/**
 * Phase 2 — the directory, the master catalogue, and the first spine.
 *
 * The assertions TASKS.md names for this phase, plus the audit-proven
 * behaviours CLAUDE.md says are easy to lose in a rebuild.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import type { Client } from 'pg'
import { asSuperuser, asUser, makePerson, refused } from './db'

type World = {
  admin: string
  internal: string
  consultant: string   // on the project, not an admin
  outsider: string
  stranger: string     // admin of another account
  org: string
  project: string
  bellhouse: string    // catalogue firm: architect
  ashworth: string     // catalogue firm: also holds architecture
  mercia: string       // catalogue firm: MEP
}
let w: World

beforeAll(async () => {
  w = await asSuperuser(async (c: Client) => {
    const admin = await makePerson(c, 'Ada Admin', 'p2-ada@hbc.example')
    const internal = await makePerson(c, 'Ian Internal', 'p2-ian@hbc.example')
    const consultant = await makePerson(c, 'Cara Consultant', 'p2-cara@bellhouse.example')
    const outsider = await makePerson(c, 'Otto Outsider', 'p2-otto@nowhere.example')
    const stranger = await makePerson(c, 'Stan Stranger', 'p2-stan@rival.example')

    const org = (await c.query(
      `insert into organisations (name, slug, status) values ('HBC','hbc','active') returning id`
    )).rows[0].id
    const rival = (await c.query(
      `insert into organisations (name, slug, status) values ('Rival','rival','active') returning id`
    )).rows[0].id

    for (const [o, p, role] of [
      [org, admin, 'admin'], [org, internal, 'internal'], [org, consultant, 'consultant'],
      [rival, stranger, 'admin'],
    ] as const) {
      await c.query(
        'insert into organisation_members (organisation_id, profile_id, role) values ($1,$2,$3)',
        [o, p, role]
      )
    }

    const project = (await c.query(
      `insert into projects (organisation_id, name, code, created_by)
       values ($1,'Riverside Phase 2','RIV',$2) returning id`,
      [org, admin]
    )).rows[0].id
    await c.query(
      `insert into project_members (project_id, profile_id, project_role)
       values ($1,$2,'member')`,
      [project, consultant]
    )

    const firm = async (name: string, address: string) =>
      (await c.query(
        `insert into catalogue_companies (organisation_id, name, address, company_type)
         values ($1,$2,$3,'consultant') returning id`,
        [org, name, address]
      )).rows[0].id

    return {
      admin, internal, consultant, outsider, stranger, org, project,
      bellhouse: await firm('Bellhouse Architects', '1 Drawing Office Way'),
      ashworth: await firm('Ashworth Design', '2 Studio Lane'),
      mercia: await firm('Mercia Building Engineering', '3 Plant Room Road'),
    }
  })
})

describe('spine 1 — companies hold disciplines, nothing is assigned to a company', () => {
  beforeAll(async () => {
    await asUser(w.admin, async (c) => {
      await c.query(`select add_company_to_project($1,$2,'BEL','consultant', array['A'])`,
        [w.project, w.bellhouse])
      await c.query(`select add_company_to_project($1,$2,'MER','consultant', array['MEP','C'])`,
        [w.project, w.mercia])
    })
  })

  test('a discipline held by two companies returns both', async () => {
    await asUser(w.admin, async (c) => {
      await c.query(`select add_company_to_project($1,$2,'ASH','consultant', array['A'])`,
        [w.project, w.ashworth])
      const { rows } = await c.query(`select name from companies_for_discipline($1,'A')`, [w.project])
      expect(rows.map((r) => r.name)).toEqual(['Ashworth Design', 'Bellhouse Architects'])
    })
  })

  test('a discipline held by none returns none, and shows as a gap', async () => {
    await asUser(w.admin, async (c) => {
      // nobody holds fire safety
      expect((await c.query(`select * from companies_for_discipline($1,'FS')`, [w.project])).rows)
        .toHaveLength(0)
      const gaps = (await c.query(`select code from project_discipline_gaps($1)`, [w.project]))
        .rows.map((r) => r.code)
      expect(gaps).toContain('FS')
      expect(gaps).not.toContain('A')     // held by two
      expect(gaps).not.toContain('MEP')   // held by one
    })
  })

  test('reassigning a discipline changes the answer immediately, with no other write', async () => {
    await asUser(w.admin, async (c) => {
      const mercia = (await c.query(
        `select id from companies where project_id = $1 and originator_code = 'MER'`, [w.project]
      )).rows[0].id

      // Mercia picks up fire safety. Nothing else is touched.
      await c.query(
        `insert into company_disciplines (company_id, discipline_code) values ($1,'FS')`, [mercia])

      const holders = (await c.query(`select name from companies_for_discipline($1,'FS')`,
        [w.project])).rows.map((r) => r.name)
      expect(holders).toEqual(['Mercia Building Engineering'])
      expect((await c.query(`select code from project_discipline_gaps($1)`, [w.project]))
        .rows.map((r) => r.code)).not.toContain('FS')
    })
  })

  test('striking a discipline out for one job drops it from the gap report', async () => {
    await asUser(w.admin, async (c) => {
      expect((await c.query(`select code from project_discipline_gaps($1)`, [w.project]))
        .rows.map((r) => r.code)).toContain('AC')
      await c.query(
        `insert into project_disciplines (project_id, discipline_code, required)
         values ($1,'AC',false)`, [w.project])
      expect((await c.query(`select code from project_discipline_gaps($1)`, [w.project]))
        .rows.map((r) => r.code)).not.toContain('AC')
      // and it is struck out, not deleted: still in the list
      expect((await c.query(`select code from project_disciplines_in_use($1)`, [w.project]))
        .rows.map((r) => r.code)).toContain('AC')
    })
  })

  test('the lookup is scoped to its project and to who may see it', async () => {
    await asUser(w.stranger, async (c) => {
      expect((await c.query(`select * from companies_for_discipline($1,'A')`, [w.project])).rows)
        .toHaveLength(0)
    })
    await asUser(w.outsider, async (c) => {
      expect((await c.query(`select * from companies_for_discipline($1,'A')`, [w.project])).rows)
        .toHaveLength(0)
    })
  })
})

describe('the project directory is a copy, not a join', () => {
  test('editing the catalogue does not change a project that already took a copy', async () => {
    const before = await asUser(w.admin, async (c) =>
      (await c.query(
        `select name, address from companies where project_id = $1 and originator_code = 'BEL'`,
        [w.project]
      )).rows[0]
    )
    expect(before.name).toBe('Bellhouse Architects')

    // a tidy-up in the catalogue two years later
    await asUser(w.admin, (c) =>
      c.query(
        `update catalogue_companies set name = 'Bellhouse Architects LLP', address = 'New Road'
         where id = $1`, [w.bellhouse])
    )

    const after = await asUser(w.admin, async (c) =>
      (await c.query(
        `select name, address from companies where project_id = $1 and originator_code = 'BEL'`,
        [w.project]
      )).rows[0]
    )
    expect(after).toEqual(before)   // the project record is history, not a view
  })

  test('a project can push a correction back, but only when asked', async () => {
    const company = await asUser(w.admin, async (c) =>
      (await c.query(
        `select id from companies where project_id = $1 and originator_code = 'MER'`, [w.project]
      )).rows[0].id
    )
    await asUser(w.admin, async (c) => {
      await c.query(`update companies set address = '4 Corrected Street' where id = $1`, [company])
      // the catalogue is untouched until the push
      expect((await c.query('select address from catalogue_companies where id = $1', [w.mercia]))
        .rows[0].address).toBe('3 Plant Room Road')
      await c.query('select push_company_correction_to_catalogue($1)', [company])
      expect((await c.query('select address from catalogue_companies where id = $1', [w.mercia]))
        .rows[0].address).toBe('4 Corrected Street')
    })
  })

  test('a firm cannot be added to the same project twice', async () => {
    await asUser(w.admin, async (c) => {
      const msg = await refused(() =>
        c.query(`select add_company_to_project($1,$2,'BEL2','consultant')`, [w.project, w.bellhouse])
      )
      expect(msg).toMatch(/already on this project/)
    })
  })

  test('an empty originator code is refused rather than creating a blank row', async () => {
    await asUser(w.admin, async (c) => {
      const msg = await refused(() =>
        c.query(`select add_company_to_project($1,$2,'   ','consultant')`, [w.project, w.ashworth])
      )
      expect(msg).toMatch(/originator code is required/)
    })
  })

  test("a firm from another account's catalogue cannot be added", async () => {
    const theirs = await asSuperuser(async (c) => {
      const rival = (await c.query(`select id from organisations where slug = 'rival'`)).rows[0].id
      return (await c.query(
        `insert into catalogue_companies (organisation_id, name) values ($1,'Rival Consulting')
         returning id`, [rival]
      )).rows[0].id
    })
    await asUser(w.admin, async (c) => {
      const msg = await refused(() =>
        c.query(`select add_company_to_project($1,$2,'RIV2','consultant')`, [w.project, theirs])
      )
      expect(msg).toMatch(/not in this account/)
    })
  })
})

describe('people on a project', () => {
  let contact: string
  let company: string

  beforeAll(async () => {
    ;({ contact, company } = await asSuperuser(async (c) => {
      const contact = (await c.query(
        `insert into contacts (catalogue_company_id, name, job_role, email, phone)
         values ($1,'Ben Bellhouse','Project architect','p2-ben@bellhouse.example','01234 567890')
         returning id`, [w.bellhouse]
      )).rows[0].id
      const company = (await c.query(
        `select id from companies where project_id = $1 and originator_code = 'BEL'`, [w.project]
      )).rows[0].id
      return { contact, company }
    }))
  })

  test('adding a person copies their details onto the project', async () => {
    await asUser(w.admin, async (c) => {
      await c.query('select add_person_to_project($1,$2,true)', [company, contact])
      const { rows } = await c.query(
        `select name, job_role, email, is_primary from project_people where contact_id = $1`,
        [contact]
      )
      expect(rows[0]).toEqual({
        name: 'Ben Bellhouse', job_role: 'Project architect',
        email: 'p2-ben@bellhouse.example', is_primary: true,
      })
    })
  })

  test('editing the catalogue contact does not change the project copy', async () => {
    await asUser(w.admin, (c) =>
      c.query(`update contacts set job_role = 'Director' where id = $1`, [contact])
    )
    await asUser(w.admin, async (c) => {
      const { rows } = await c.query(
        'select job_role from project_people where contact_id = $1', [contact])
      expect(rows[0].job_role).toBe('Project architect')
    })
  })

  test('a duplicate add is refused, not silently duplicated', async () => {
    await asUser(w.admin, async (c) => {
      const msg = await refused(() =>
        c.query('select add_person_to_project($1,$2)', [company, contact])
      )
      expect(msg).toMatch(/already on this project/)
    })
  })

  test('only one primary contact per company', async () => {
    const second = await asSuperuser(async (c) =>
      (await c.query(
        `insert into contacts (catalogue_company_id, name, email)
         values ($1,'Bess Bellhouse','p2-bess@bellhouse.example') returning id`, [w.bellhouse]
      )).rows[0].id
    )
    await asUser(w.admin, async (c) => {
      await c.query('select add_person_to_project($1,$2,true)', [company, second])
      const { rows } = await c.query(
        'select name from project_people where company_id = $1 and is_primary', [company])
      expect(rows).toEqual([{ name: 'Bess Bellhouse' }])
    })
  })

  test('a person who holds a login cannot be removed from the directory', async () => {
    const person = await asSuperuser(async (c) => {
      const p = await makePerson(c, 'Logged In', 'p2-loggedin@bellhouse.example')
      await c.query(
        `insert into organisation_members (organisation_id, profile_id, role)
         values ($1,$2,'consultant')`, [w.org, p])
      const ct = (await c.query(
        `insert into contacts (catalogue_company_id, name, email)
         values ($1,'Logged In','p2-loggedin@bellhouse.example') returning id`, [w.bellhouse]
      )).rows[0].id
      return { p, ct }
    })
    await asUser(w.admin, async (c) => {
      await c.query('select add_person_to_project($1,$2)', [company, person.ct])
      const msg = await refused(() =>
        c.query('delete from project_people where contact_id = $1', [person.ct])
      )
      expect(msg).toMatch(/holds a login/)
    })
  })

  test('someone without a login can be removed', async () => {
    const ct = await asSuperuser(async (c) =>
      (await c.query(
        `insert into contacts (catalogue_company_id, name, email)
         values ($1,'Temp Person','p2-temp@bellhouse.example') returning id`, [w.bellhouse]
      )).rows[0].id
    )
    await asUser(w.admin, async (c) => {
      await c.query('select add_person_to_project($1,$2)', [company, ct])
      const res = await c.query('delete from project_people where contact_id = $1', [ct])
      expect(res.rowCount).toBe(1)
    })
  })

  test('the delete guard cannot be sidestepped by clearing profile_id first', async () => {
    await asUser(w.admin, async (c) => {
      const msg = await refused(() =>
        c.query('update project_people set profile_id = null where company_id = $1', [company])
      )
      expect(msg).toMatch(/permission denied|column/i)
    })
  })
})

describe('disciplines are forked, not shared', () => {
  test('an account reads the published list until it forks', async () => {
    await asUser(w.admin, async (c) => {
      const { rows } = await c.query('select code, forked from account_disciplines($1)', [w.org])
      expect(rows.length).toBeGreaterThan(5)
      expect(rows.every((r) => r.forked === false)).toBe(true)
    })
  })

  test('forking gives the account its own copy, and editing it leaves the default alone', async () => {
    await asUser(w.admin, async (c) => {
      const copied = (await c.query('select fork_disciplines($1) as n', [w.org])).rows[0].n
      expect(copied).toBeGreaterThan(5)

      await c.query(
        `update disciplines set name = 'Architecture (HBC)' where organisation_id = $1 and code = 'A'`,
        [w.org])
      const { rows } = await c.query(
        `select name, forked from account_disciplines($1) where code = 'A'`, [w.org])
      expect(rows[0]).toEqual({ name: 'Architecture (HBC)', forked: true })
    })
    const published = await asSuperuser(async (c) =>
      (await c.query(`select name from disciplines where organisation_id is null and code = 'A'`))
        .rows[0].name
    )
    expect(published).toBe('Architecture')
  })

  test('forking twice does not duplicate', async () => {
    await asUser(w.admin, async (c) => {
      expect((await c.query('select fork_disciplines($1) as n', [w.org])).rows[0].n).toBe(0)
    })
  })

  test('another account cannot fork or read this one', async () => {
    await asUser(w.stranger, async (c) => {
      const msg = await refused(() => c.query('select fork_disciplines($1)', [w.org]))
      expect(msg).toMatch(/not permitted/)
      expect((await c.query('select * from account_disciplines($1)', [w.org])).rows).toHaveLength(0)
    })
  })
})

describe('who may maintain the directory', () => {
  test('a consultant on the project cannot add a company', async () => {
    await asUser(w.consultant, async (c) => {
      const msg = await refused(() =>
        c.query(`select add_company_to_project($1,$2,'NOPE','consultant')`, [w.project, w.ashworth])
      )
      expect(msg).toMatch(/not permitted/)
    })
  })

  test('a consultant on the project can read it', async () => {
    await asUser(w.consultant, async (c) => {
      expect((await c.query('select id from companies where project_id = $1', [w.project])).rows
        .length).toBeGreaterThan(0)
      expect((await c.query(`select * from companies_for_discipline($1,'A')`, [w.project])).rows
        .length).toBe(2)
    })
  })

  test('a project admin may maintain it without being an account admin', async () => {
    const pa = await asSuperuser(async (c) => {
      const p = await makePerson(c, 'Pat ProjAdmin', 'p2-pat@hbc.example')
      await c.query(
        `insert into organisation_members (organisation_id, profile_id, role)
         values ($1,$2,'consultant')`, [w.org, p])
      await c.query(
        `insert into project_members (project_id, profile_id, project_role)
         values ($1,$2,'project_admin')`, [w.project, p])
      return p
    })
    // The catalogue is the account admin's to maintain...
    const vale = await asUser(w.admin, async (c) =>
      (await c.query(
        `insert into catalogue_companies (organisation_id, name) values ($1,'Vale Landscape')
         returning id`, [w.org])).rows[0].id
    )
    // ...but putting an existing firm onto a project is the project admin's.
    await asUser(pa, async (c) => {
      const id = (await c.query(
        `select add_company_to_project($1,$2,'VAL','subcontractor', array['L']) as id`,
        [w.project, vale]
      )).rows[0].id
      expect(id).toBeTruthy()
    })
  })

  test('a project admin cannot add a firm to the account catalogue', async () => {
    const pa = await asSuperuser(async (c) => {
      const p = await makePerson(c, 'Pip ProjAdmin', 'p2-pip@hbc.example')
      await c.query(
        `insert into organisation_members (organisation_id, profile_id, role)
         values ($1,$2,'consultant')`, [w.org, p])
      await c.query(
        `insert into project_members (project_id, profile_id, project_role)
         values ($1,$2,'project_admin')`, [w.project, p])
      return p
    })
    await asUser(pa, async (c) => {
      const msg = await refused(() =>
        c.query(`insert into catalogue_companies (organisation_id, name) values ($1,'Sneaky Ltd')`,
          [w.org])
      )
      expect(msg).toMatch(/row-level security/i)
    })
  })

  test('nobody outside the project sees its directory', async () => {
    for (const who of [w.stranger, w.outsider]) {
      await asUser(who, async (c) => {
        expect((await c.query('select id from companies where project_id = $1', [w.project])).rows)
          .toHaveLength(0)
        expect((await c.query('select id from project_people where project_id = $1', [w.project]))
          .rows).toHaveLength(0)
      })
    }
  })

  test("a consultant cannot read another account's catalogue", async () => {
    await asUser(w.stranger, async (c) => {
      expect((await c.query('select id from catalogue_companies where organisation_id = $1',
        [w.org])).rows).toHaveLength(0)
    })
  })
})

describe('appointment documents', () => {
  test('every slot reports as missing before anything is uploaded', async () => {
    const company = await asUser(w.admin, async (c) =>
      (await c.query(
        `select id from companies where project_id = $1 and originator_code = 'ASH'`, [w.project]
      )).rows[0].id
    )
    await asUser(w.admin, async (c) => {
      const { rows } = await c.query('select slot, state from company_appointment_status($1)',
        [company])
      expect(rows).toHaveLength(4)
      expect(rows.every((r) => r.state === 'missing')).toBe(true)
    })
  })

  test('status is derived from the row, not stored', async () => {
    const company = await asUser(w.admin, async (c) =>
      (await c.query(
        `select id from companies where project_id = $1 and originator_code = 'ASH'`, [w.project]
      )).rows[0].id
    )
    await asUser(w.admin, async (c) => {
      await c.query(
        `insert into appointment_documents (company_id, slot, storage_path, filename)
         values ($1,'appointment','p/1.pdf','appointment.pdf')`, [company])
      const state = async () =>
        (await c.query(
          `select state from company_appointment_status($1) where slot = 'appointment'`, [company]
        )).rows[0].state

      expect(await state()).toBe('awaiting approval')
      await c.query(
        `update appointment_documents set approved = true, approved_by = $2, approved_at = now()
         where company_id = $1 and slot = 'appointment'`, [company, w.admin])
      expect(await state()).toBe('approved')
    })
  })

  test('a consultant on the project can see the status but cannot approve', async () => {
    const company = await asUser(w.admin, async (c) =>
      (await c.query(
        `select id from companies where project_id = $1 and originator_code = 'ASH'`, [w.project]
      )).rows[0].id
    )
    await asUser(w.consultant, async (c) => {
      expect((await c.query('select * from company_appointment_status($1)', [company])).rows)
        .toHaveLength(4)
      const res = await c.query(
        `update appointment_documents set approved = false where company_id = $1`, [company])
      expect(res.rowCount).toBe(0)
    })
  })
})
