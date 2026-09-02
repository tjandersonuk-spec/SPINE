/**
 * Phase 1 — the assertion list at the end of handover §1b, proved against a real
 * PostgreSQL. Every negative case is exercised from the wrong side: not "can the
 * right person do this" but "is the wrong person actually refused".
 */
import { beforeAll, describe, expect, test } from 'vitest'
import type { Client } from 'pg'
import { asSuperuser, asUser, makePerson, refused } from './db'

/** One account, its people, and a project — the fixture most tests need. */
type World = {
  owner: string          // platform owner
  admin: string          // account admin at Ashgrove
  internal: string       // account internal staff at Ashgrove
  consultant: string     // consultant, member of Ashgrove, on the project
  outsider: string       // confirmed login, no memberships anywhere
  stranger: string       // admin of a different account (Bellhouse)
  ashgrove: string
  bellhouse: string
  project: string
}
let w: World

beforeAll(async () => {
  w = await asSuperuser(async (c: Client) => {
    const owner = await makePerson(c, 'Platform Owner', 'owner@spine.example')
    await c.query('insert into platform_owners (profile_id) values ($1)', [owner])

    const admin = await makePerson(c, 'Ada Admin', 'ada@ashgrove.example')
    const internal = await makePerson(c, 'Ian Internal', 'ian@ashgrove.example')
    const consultant = await makePerson(c, 'Cara Consultant', 'cara@bellhouse-arch.example')
    const outsider = await makePerson(c, 'Otto Outsider', 'otto@nowhere.example')
    const stranger = await makePerson(c, 'Stan Stranger', 'stan@bellhouse.example')

    const ashgrove = (
      await c.query(
        `insert into organisations (name, slug, status) values ('Ashgrove','ashgrove','active')
         returning id`
      )
    ).rows[0].id
    const bellhouse = (
      await c.query(
        `insert into organisations (name, slug, status) values ('Bellhouse','bellhouse','active')
         returning id`
      )
    ).rows[0].id

    for (const [org, p, role] of [
      [ashgrove, admin, 'admin'],
      [ashgrove, internal, 'internal'],
      [ashgrove, consultant, 'consultant'],
      [bellhouse, stranger, 'admin'],
    ] as const) {
      await c.query(
        'insert into organisation_members (organisation_id, profile_id, role) values ($1,$2,$3)',
        [org, p, role]
      )
    }

    const project = (
      await c.query(
        `insert into projects (organisation_id, name, code, created_by)
         values ($1,'Riverside Phase 2','RIV', $2) returning id`,
        [ashgrove, admin]
      )
    ).rows[0].id
    await c.query(
      `insert into project_members (project_id, profile_id, project_role)
       values ($1,$2,'member')`,
      [project, consultant]
    )

    return { owner, admin, internal, consultant, outsider, stranger, ashgrove, bellhouse, project }
  })
})

describe('a login on its own grants nothing', () => {
  test('signing up creates no account, no membership and no request', async () => {
    const counts = await asSuperuser(async (c) => {
      const q = async (sql: string) =>
        Number((await c.query(sql, [w.outsider])).rows[0].count)
      return {
        memberships: await q('select count(*) from organisation_members where profile_id = $1'),
        projects: await q('select count(*) from project_members where profile_id = $1'),
        requests: await q('select count(*) from account_requests where requested_by = $1'),
      }
    })
    expect(counts).toEqual({ memberships: 0, projects: 0, requests: 0 })
  })

  test('a zero-membership login gets the empty set, not an error', async () => {
    await asUser(w.outsider, async (c) => {
      // These are exactly the queries the personal landing page issues.
      for (const sql of [
        'select * from organisations',
        'select * from projects',
        'select * from my_projects()',
        'select * from organisation_members',
        'select * from account_requests',
        'select * from invitations',
      ]) {
        const { rows } = await c.query(sql)
        expect(rows, `${sql} should be empty, not an error`).toHaveLength(0)
      }
    })
  })

  test('a zero-membership login can still read its own profile', async () => {
    await asUser(w.outsider, async (c) => {
      const { rows } = await c.query('select id from profiles')
      expect(rows.map((r) => r.id)).toEqual([w.outsider])
    })
  })
})

describe('account requests', () => {
  test('a request is visible to its requester and the platform owner, and nobody else', async () => {
    const id = await asUser(w.outsider, async (c) =>
      (await c.query(`select request_account('Otto Ltd', null, null, 'core', 'please') as id`))
        .rows[0].id
    )
    const seenBy = async (who: string) =>
      asUser(who, async (c) =>
        (await c.query('select id from account_requests where id = $1', [id])).rows.length
      )
    expect(await seenBy(w.outsider)).toBe(1)
    expect(await seenBy(w.owner)).toBe(1)
    expect(await seenBy(w.admin)).toBe(0)
    expect(await seenBy(w.stranger)).toBe(0)
  })

  test('an Add refuses empty input rather than creating a blank row', async () => {
    await asUser(w.outsider, async (c) => {
      const msg = await refused(() => c.query(`select request_account('   ')`))
      expect(msg).toMatch(/company name is required/)
    })
  })

  test('approval creates an active account and exactly one admin membership', async () => {
    const person = await asSuperuser((c) => makePerson(c, 'Ravi', 'ravi@riverside.example'))
    const req = await asUser(person, async (c) =>
      (await c.query(`select request_account('Riverside Construction') as id`)).rows[0].id
    )
    const org = await asUser(w.owner, async (c) =>
      (
        await c.query(
          `select approve_account_request($1,'Riverside Construction Ltd','riverside','core','{}') as id`,
          [req]
        )
      ).rows[0].id
    )
    const { status, members } = await asSuperuser(async (c) => ({
      status: (await c.query('select status from organisations where id = $1', [org])).rows[0]
        .status,
      members: (
        await c.query('select profile_id, role from organisation_members where organisation_id = $1', [org])
      ).rows,
    }))
    expect(status).toBe('active')
    expect(members).toEqual([{ profile_id: person, role: 'admin' }])
  })

  test('approval takes the reviewed values, not a blind copy of the request', async () => {
    const person = await asSuperuser((c) => makePerson(c, 'Tess', 'tess@typo.example'))
    const req = await asUser(person, async (c) =>
      (await c.query(`select request_account('Tyop Construcshun') as id`)).rows[0].id
    )
    const org = await asUser(w.owner, async (c) =>
      (
        await c.query(
          `select approve_account_request($1,'Typo Construction','typo','complete','{"commercial":true}') as id`,
          [req]
        )
      ).rows[0].id
    )
    const row = await asSuperuser(
      async (c) =>
        (await c.query('select name, subscription_tier, modules from organisations where id = $1', [org]))
          .rows[0]
    )
    expect(row.name).toBe('Typo Construction')
    expect(row.subscription_tier).toBe('complete')
    expect(row.modules).toEqual({ commercial: true })
  })

  test('a rejected request keeps its row and its reason', async () => {
    const person = await asSuperuser((c) => makePerson(c, 'Nora', 'nora@nope.example'))
    const req = await asUser(person, async (c) =>
      (await c.query(`select request_account('Nope Ltd') as id`)).rows[0].id
    )
    await asUser(w.owner, (c) =>
      c.query(`select reject_account_request($1, 'Company number does not resolve')`, [req])
    )
    await asUser(person, async (c) => {
      const { rows } = await c.query('select status, review_note from account_requests where id = $1', [req])
      expect(rows[0].status).toBe('rejected')
      expect(rows[0].review_note).toMatch(/does not resolve/)
    })
  })

  test('an ordinary person cannot approve their own request', async () => {
    const person = await asSuperuser((c) => makePerson(c, 'Sly', 'sly@self.example'))
    const req = await asUser(person, async (c) =>
      (await c.query(`select request_account('Self Approved Ltd') as id`)).rows[0].id
    )
    await asUser(person, async (c) => {
      const msg = await refused(() =>
        c.query(`select approve_account_request($1,'Self Approved Ltd','self','core','{}')`, [req])
      )
      expect(msg).toMatch(/not permitted/)
    })
  })
})

describe('account isolation', () => {
  test('an account admin cannot list other accounts; the platform owner can', async () => {
    const mine = await asUser(w.admin, async (c) =>
      (await c.query('select name from organisations')).rows.map((r) => r.name)
    )
    expect(mine).toEqual(['Ashgrove'])

    const all = await asUser(w.owner, async (c) =>
      (await c.query('select name from organisations')).rows.map((r) => r.name)
    )
    expect(all).toEqual(expect.arrayContaining(['Ashgrove', 'Bellhouse']))
  })

  test('a person in two accounts sees both, and neither can see the other from inside', async () => {
    const both = await asSuperuser(async (c) => {
      const p = await makePerson(c, 'Dual Member', 'dual@two.example')
      for (const [org, role] of [
        [w.ashgrove, 'consultant'],
        [w.bellhouse, 'consultant'],
      ] as const) {
        await c.query(
          'insert into organisation_members (organisation_id, profile_id, role) values ($1,$2,$3)',
          [org, p, role]
        )
      }
      return p
    })
    const names = await asUser(both, async (c) =>
      (await c.query('select name from organisations order by name')).rows.map((r) => r.name)
    )
    expect(names).toEqual(['Ashgrove', 'Bellhouse'])

    // and the single-account admin still sees only their own
    const stranger = await asUser(w.stranger, async (c) =>
      (await c.query('select name from organisations')).rows.map((r) => r.name)
    )
    expect(stranger).toEqual(['Bellhouse'])
  })

  test("a stranger cannot see another account's project", async () => {
    await asUser(w.stranger, async (c) => {
      const { rows } = await c.query('select id from projects where id = $1', [w.project])
      expect(rows).toHaveLength(0)
    })
  })
})

describe('only an account admin may create a project', () => {
  const insert = (c: Client, org: string, code: string) =>
    c.query(`insert into projects (organisation_id, name, code) values ($1,'Attempt',$2)`, [org, code])

  test('an account admin can', async () => {
    await asUser(w.admin, async (c) => {
      await insert(c, w.ashgrove, 'OK1')
      const { rows } = await c.query(`select id from projects where code = 'OK1'`)
      expect(rows).toHaveLength(1)
    })
  })

  test('internal cannot — refused by the policy on a direct insert', async () => {
    await asUser(w.internal, async (c) => {
      const msg = await refused(() => insert(c, w.ashgrove, 'NO1'))
      expect(msg).toMatch(/row-level security/i)
    })
  })

  test('a consultant cannot', async () => {
    await asUser(w.consultant, async (c) => {
      const msg = await refused(() => insert(c, w.ashgrove, 'NO2'))
      expect(msg).toMatch(/row-level security/i)
    })
  })

  test('a project admin cannot create a new project', async () => {
    const pa = await asSuperuser(async (c) => {
      const p = await makePerson(c, 'Pat ProjAdmin', 'pat@ashgrove.example')
      await c.query(
        `insert into organisation_members (organisation_id, profile_id, role)
         values ($1,$2,'consultant')`,
        [w.ashgrove, p]
      )
      await c.query(
        `insert into project_members (project_id, profile_id, project_role)
         values ($1,$2,'project_admin')`,
        [w.project, p]
      )
      return p
    })
    await asUser(pa, async (c) => {
      const msg = await refused(() => insert(c, w.ashgrove, 'NO3'))
      expect(msg).toMatch(/row-level security/i)
    })
  })

  test('an admin of another account cannot create a project in this one', async () => {
    await asUser(w.stranger, async (c) => {
      const msg = await refused(() => insert(c, w.ashgrove, 'NO4'))
      expect(msg).toMatch(/row-level security/i)
    })
  })

  test('create_project() refuses a non-admin too, not only the policy', async () => {
    await asUser(w.internal, async (c) => {
      const msg = await refused(() =>
        c.query(`select create_project($1,'Attempt','NO5')`, [w.ashgrove])
      )
      expect(msg).toMatch(/not permitted/)
    })
  })
})

describe('invitations', () => {
  test('an unaccepted invitation grants no access and no membership', async () => {
    const invitee = await asSuperuser((c) => makePerson(c, 'Ivy Invitee', 'ivy@elsewhere.example'))
    await asUser(w.admin, (c) =>
      c.query(`select invite_to_account($1,'ivy@elsewhere.example','consultant')`, [w.ashgrove])
    )
    await asUser(invitee, async (c) => {
      expect((await c.query('select id from organisations')).rows).toHaveLength(0)
      expect((await c.query('select * from my_projects()')).rows).toHaveLength(0)
    })
    const members = await asSuperuser(
      async (c) =>
        (await c.query('select count(*) from organisation_members where profile_id = $1', [invitee]))
          .rows[0].count
    )
    expect(Number(members)).toBe(0)
  })

  test('accepting is what creates the membership', async () => {
    const invitee = await asSuperuser((c) => makePerson(c, 'Amos', 'amos@elsewhere.example'))
    const token = await asUser(w.admin, async (c) => {
      const id = (
        await c.query(`select invite_to_account($1,'amos@elsewhere.example','consultant') as id`, [
          w.ashgrove,
        ])
      ).rows[0].id
      return (await c.query('select token from invitations where id = $1', [id])).rows[0].token
    })
    await asUser(invitee, (c) => c.query('select accept_invitation($1)', [token]))
    const role = await asSuperuser(
      async (c) =>
        (
          await c.query(
            'select role from organisation_members where profile_id = $1 and organisation_id = $2',
            [invitee, w.ashgrove]
          )
        ).rows[0]?.role
    )
    expect(role).toBe('consultant')
  })

  test('an invitation cannot be accepted by a different address', async () => {
    const token = await asUser(w.admin, async (c) => {
      const id = (
        await c.query(`select invite_to_account($1,'someone@else.example','consultant') as id`, [
          w.ashgrove,
        ])
      ).rows[0].id
      return (await c.query('select token from invitations where id = $1', [id])).rows[0].token
    })
    await asUser(w.outsider, async (c) => {
      const msg = await refused(() => c.query('select accept_invitation($1)', [token]))
      expect(msg).toMatch(/issued to a different address/)
    })
  })

  test('a project admin can invite an existing account member to their project', async () => {
    const { pa, member } = await asSuperuser(async (c) => {
      const pa = await makePerson(c, 'Percy PA', 'percy@ashgrove.example')
      const member = await makePerson(c, 'Mo Member', 'mo@ashgrove.example')
      for (const p of [pa, member]) {
        await c.query(
          `insert into organisation_members (organisation_id, profile_id, role)
           values ($1,$2,'consultant')`,
          [w.ashgrove, p]
        )
      }
      await c.query(
        `insert into project_members (project_id, profile_id, project_role)
         values ($1,$2,'project_admin')`,
        [w.project, pa]
      )
      return { pa, member }
    })
    const token = await asUser(pa, async (c) => {
      const id = (
        await c.query(`select invite_to_project($1,'mo@ashgrove.example','member') as id`, [w.project])
      ).rows[0].id
      return (await c.query('select token from invitations where id = $1', [id])).rows[0].token
    })
    await asUser(member, (c) => c.query('select accept_invitation($1)', [token]))
    const rows = await asSuperuser(
      async (c) =>
        (await c.query('select project_role from project_members where project_id = $1 and profile_id = $2', [
          w.project,
          member,
        ])).rows
    )
    expect(rows).toEqual([{ project_role: 'member' }])
  })

  test('a project admin cannot invite someone who is not in the account — refused at issue', async () => {
    const pa = await asSuperuser(async (c) => {
      const p = await makePerson(c, 'Priya PA', 'priya@ashgrove.example')
      await c.query(
        `insert into organisation_members (organisation_id, profile_id, role)
         values ($1,$2,'consultant')`,
        [w.ashgrove, p]
      )
      await c.query(
        `insert into project_members (project_id, profile_id, project_role)
         values ($1,$2,'project_admin')`,
        [w.project, p]
      )
      return p
    })
    await asUser(pa, async (c) => {
      const msg = await refused(() =>
        c.query(`select invite_to_project($1,'otto@nowhere.example','member')`, [w.project])
      )
      expect(msg).toMatch(/not a member of this account/)
    })
  })

  test('an invitation whose target left the account is refused at accept', async () => {
    const leaver = await asSuperuser(async (c) => {
      const p = await makePerson(c, 'Lena Leaver', 'lena@ashgrove.example')
      await c.query(
        `insert into organisation_members (organisation_id, profile_id, role)
         values ($1,$2,'consultant')`,
        [w.ashgrove, p]
      )
      return p
    })
    const token = await asUser(w.admin, async (c) => {
      const id = (
        await c.query(`select invite_to_project($1,'lena@ashgrove.example','member') as id`, [w.project])
      ).rows[0].id
      return (await c.query('select token from invitations where id = $1', [id])).rows[0].token
    })
    // membership revoked while the token is still live
    await asUser(w.admin, (c) =>
      c.query('delete from organisation_members where organisation_id = $1 and profile_id = $2', [
        w.ashgrove,
        leaver,
      ])
    )
    await asUser(leaver, async (c) => {
      const msg = await refused(() => c.query('select accept_invitation($1)', [token]))
      expect(msg).toMatch(/no longer a member of this account/)
    })
  })

  test('an expired invitation is refused', async () => {
    const person = await asSuperuser((c) => makePerson(c, 'Ed Expired', 'ed@late.example'))
    const token = await asSuperuser(async (c) => {
      const { rows } = await c.query(
        `insert into invitations (scope, organisation_id, email, role, token, invited_by, expires_at)
         values ('organisation',$1,'ed@late.example','consultant','tok-expired',$2, now() - interval '1 day')
         returning token`,
        [w.ashgrove, w.admin]
      )
      return rows[0].token
    })
    await asUser(person, async (c) => {
      const msg = await refused(() => c.query('select accept_invitation($1)', [token]))
      expect(msg).toMatch(/expired/)
    })
  })

  test('an invitation is not visible to the rest of the account', async () => {
    await asUser(w.admin, (c) =>
      c.query(`select invite_to_account($1,'quiet@elsewhere.example','consultant')`, [w.ashgrove])
    )
    await asUser(w.consultant, async (c) => {
      const { rows } = await c.query(
        `select id from invitations where email = 'quiet@elsewhere.example'`
      )
      expect(rows).toHaveLength(0)
    })
  })
})

describe('project membership', () => {
  test('removing someone from a project leaves their account membership and other projects', async () => {
    const { person, other } = await asSuperuser(async (c) => {
      const person = await makePerson(c, 'Remy Removed', 'remy@ashgrove.example')
      await c.query(
        `insert into organisation_members (organisation_id, profile_id, role)
         values ($1,$2,'consultant')`,
        [w.ashgrove, person]
      )
      const other = (
        await c.query(
          `insert into projects (organisation_id, name, code) values ($1,'Second','SEC') returning id`,
          [w.ashgrove]
        )
      ).rows[0].id
      for (const proj of [w.project, other]) {
        await c.query('insert into project_members (project_id, profile_id) values ($1,$2)', [
          proj,
          person,
        ])
      }
      return { person, other }
    })

    await asUser(w.admin, (c) =>
      c.query('delete from project_members where project_id = $1 and profile_id = $2', [
        w.project,
        person,
      ])
    )

    const after = await asSuperuser(async (c) => ({
      account: Number(
        (await c.query('select count(*) from organisation_members where profile_id = $1', [person]))
          .rows[0].count
      ),
      projects: (
        await c.query('select project_id from project_members where profile_id = $1', [person])
      ).rows.map((r) => r.project_id),
    }))
    expect(after.account).toBe(1)
    expect(after.projects).toEqual([other])
  })

  test('account staff see every project without a project_members row', async () => {
    const seen = await asUser(w.internal, async (c) =>
      (await c.query('select id from my_projects() where id = $1', [w.project])).rows.length
    )
    expect(seen).toBe(1)
  })
})

describe('the account lifecycle', () => {
  test('a suspended account stops an in-flight session, not just sign-in', async () => {
    const { org, person, project } = await asSuperuser(async (c) => {
      const org = (
        await c.query(
          `insert into organisations (name, slug, status) values ('Suspendo','suspendo','active') returning id`
        )
      ).rows[0].id
      const person = await makePerson(c, 'Sam Suspended', 'sam@suspendo.example')
      await c.query(
        `insert into organisation_members (organisation_id, profile_id, role) values ($1,$2,'admin')`,
        [org, person]
      )
      const project = (
        await c.query(
          `insert into projects (organisation_id, name, code) values ($1,'Job','JOB') returning id`,
          [org]
        )
      ).rows[0].id
      return { org, person, project }
    })

    // reads fine while active
    expect(
      await asUser(person, async (c) => (await c.query('select * from my_projects()')).rows.length)
    ).toBe(1)

    await asUser(w.owner, (c) => c.query(`select set_account_status($1,'suspended','non-payment')`, [org]))

    await asUser(person, async (c) => {
      expect((await c.query('select * from my_projects()')).rows).toHaveLength(0)
      expect((await c.query('select id from projects where id = $1', [project])).rows).toHaveLength(0)
      const msg = await refused(() =>
        c.query(`insert into projects (organisation_id, name, code) values ($1,'New','NEW')`, [org])
      )
      expect(msg).toMatch(/row-level security/i)
    })
  })

  test('an archived account is readable by its members and writable by nobody', async () => {
    const { org, person, project } = await asSuperuser(async (c) => {
      const org = (
        await c.query(
          `insert into organisations (name, slug, status) values ('Archivo','archivo','active') returning id`
        )
      ).rows[0].id
      const person = await makePerson(c, 'Arch Member', 'arch@archivo.example')
      await c.query(
        `insert into organisation_members (organisation_id, profile_id, role) values ($1,$2,'admin')`,
        [org, person]
      )
      const project = (
        await c.query(
          `insert into projects (organisation_id, name, code) values ($1,'Old Job','OLD') returning id`,
          [org]
        )
      ).rows[0].id
      return { org, person, project }
    })

    await asUser(w.owner, (c) => c.query(`select set_account_status($1,'archived')`, [org]))

    await asUser(person, async (c) => {
      // still readable
      expect((await c.query('select id from projects where id = $1', [project])).rows).toHaveLength(1)
      expect((await c.query('select * from my_projects()')).rows).toHaveLength(1)

      // Not writable — but note the shape of the refusal. An UPDATE whose USING
      // clause matches no row is a silent no-op, not an error, so the UI must
      // never read "no error" as success. An INSERT does raise, because a
      // WITH CHECK violation is an error.
      const update = await c.query(`update projects set name = 'Renamed' where id = $1`, [project])
      expect(update.rowCount).toBe(0)

      const msg = await refused(() =>
        c.query(`insert into projects (organisation_id, name, code) values ($1,'New','NEW2')`, [org])
      )
      expect(msg).toMatch(/row-level security/i)
    })

    const unchanged = await asSuperuser(
      async (c) => (await c.query('select name from projects where id = $1', [project])).rows[0].name
    )
    expect(unchanged).toBe('Old Job')
  })

  test('an account cannot be deleted unless archived', async () => {
    await asUser(w.owner, async (c) => {
      const msg = await refused(() => c.query('select delete_account($1,$2)', [w.bellhouse, 'Bellhouse']))
      expect(msg).toMatch(/must be archived/)
    })
  })

  test('deletion requires the name typed back', async () => {
    const org = await asSuperuser(
      async (c) =>
        (
          await c.query(
            `insert into organisations (name, slug, status) values ('Doomed','doomed','archived') returning id`
          )
        ).rows[0].id
    )
    await asUser(w.owner, async (c) => {
      const msg = await refused(() => c.query('select delete_account($1,$2)', [org, 'Wrong Name']))
      expect(msg).toMatch(/confirmation name does not match/)
    })
  })

  test('the audit row survives the account it describes', async () => {
    const org = await asSuperuser(async (c) => {
      const id = (
        await c.query(
          `insert into organisations (name, slug, status) values ('Gonzo','gonzo','archived') returning id`
        )
      ).rows[0].id
      await c.query(`insert into projects (organisation_id, name, code) values ($1,'P','P1')`, [id])
      return id
    })
    await asUser(w.owner, (c) => c.query('select delete_account($1,$2)', [org, 'Gonzo']))

    const gone = await asSuperuser(
      async (c) => (await c.query('select id from organisations where id = $1', [org])).rows.length
    )
    expect(gone).toBe(0)

    await asUser(w.owner, async (c) => {
      const { rows } = await c.query(
        `select detail from platform_audit where action = 'delete_account'
         and detail->>'organisation_id' = $1`,
        [org]
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].detail.name).toBe('Gonzo')
      expect(rows[0].detail.projects).toBe(1)
    })
  })

  test('an account admin cannot change their own account status', async () => {
    await asUser(w.admin, async (c) => {
      const msg = await refused(() => c.query(`select set_account_status($1,'active')`, [w.ashgrove]))
      expect(msg).toMatch(/not permitted/)
    })
  })

  test('an account admin cannot un-suspend by updating the row directly', async () => {
    const org = await asSuperuser(async (c) => {
      const id = (
        await c.query(
          `insert into organisations (name, slug, status) values ('Sneaky','sneaky','suspended') returning id`
        )
      ).rows[0].id
      const p = await makePerson(c, 'Sneak', 'sneak@sneaky.example')
      await c.query(
        `insert into organisation_members (organisation_id, profile_id, role) values ($1,$2,'admin')`,
        [id, p]
      )
      return { id, p }
    })
    await asUser(org.p, async (c) => {
      const res = await c.query(`update organisations set status = 'active' where id = $1`, [org.id])
      expect(res.rowCount).toBe(0) // the using clause matches no row
    })
    const status = await asSuperuser(
      async (c) => (await c.query('select status from organisations where id = $1', [org.id])).rows[0].status
    )
    expect(status).toBe('suspended')
  })
})

describe('the platform owner', () => {
  test('can list every login, including logins with zero memberships', async () => {
    const emails = await asUser(w.owner, async (c) =>
      (await c.query('select email from profiles')).rows.map((r) => r.email)
    )
    expect(emails).toContain('otto@nowhere.example') // no memberships anywhere
    expect(emails).toContain('ada@ashgrove.example')
    expect(emails).toContain('stan@bellhouse.example')
  })

  test('an account admin sees only people they share an account with', async () => {
    const emails = await asUser(w.admin, async (c) =>
      (await c.query('select email from profiles')).rows.map((r) => r.email)
    )
    expect(emails).toContain('ada@ashgrove.example')
    expect(emails).toContain('cara@bellhouse-arch.example') // shares Ashgrove
    expect(emails).not.toContain('stan@bellhouse.example')
    expect(emails).not.toContain('otto@nowhere.example')
  })

  test('the platform-owner layer is not discoverable by an account admin', async () => {
    await asUser(w.admin, async (c) => {
      const { rows } = await c.query('select * from platform_owners')
      expect(rows).toHaveLength(0)
      expect(await c.query('select is_platform_owner() as v')).toMatchObject({
        rows: [{ v: false }],
      })
    })
  })

  test('the audit trail cannot be edited by its own subject', async () => {
    await asUser(w.owner, async (c) => {
      const update = await c.query(`update platform_audit set action = 'tampered'`)
      expect(update.rowCount).toBe(0)
      const del = await c.query('delete from platform_audit')
      expect(del.rowCount).toBe(0)
      const insert = await refused(() =>
        c.query(`insert into platform_audit (owner_id, action) values ($1,'forged')`, [w.owner])
      )
      expect(insert).toMatch(/row-level security/i)
    })
  })

  test('the audit trail is invisible to an account admin', async () => {
    await asUser(w.admin, async (c) => {
      expect((await c.query('select * from platform_audit')).rows).toHaveLength(0)
    })
  })
})

describe('module entitlements', () => {
  test('the per-project override wins over the account map', async () => {
    const { project } = await asSuperuser(async (c) => {
      const org = (
        await c.query(
          `insert into organisations (name, slug, status, modules)
           values ('Modo','modo','active','{"compliance":false,"commercial":true}') returning id`
        )
      ).rows[0].id
      const project = (
        await c.query(
          `insert into projects (organisation_id, name, code, modules_override)
           values ($1,'Pilot','PIL','{"compliance":true}') returning id`,
          [org]
        )
      ).rows[0].id
      return { project }
    })
    const on = await asSuperuser(async (c) => ({
      compliance: (await c.query(`select module_on($1,'compliance') as v`, [project])).rows[0].v,
      commercial: (await c.query(`select module_on($1,'commercial') as v`, [project])).rows[0].v,
      unknown: (await c.query(`select module_on($1,'energy') as v`, [project])).rows[0].v,
    }))
    expect(on).toEqual({ compliance: true, commercial: true, unknown: false })
  })
})
