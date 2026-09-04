/**
 * Phase 16 — email and notifications.
 *
 * One rule governs the phase: nothing may appear in an email that its
 * recipient could not see in the application. The usual way to break it is a
 * job with full database access that assembles a message and is careful about
 * what it includes, because careful is a promise and one forgotten join later
 * it is a consultant reading a rival's overdue drawings in their inbox.
 *
 * So the assertions below are not about templates. They are that the digest is
 * built by the recipient's own query path, that the function which does it is
 * owned by a role row level security actually applies to, and that a message is
 * composed exactly once however many times the job runs.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import type { Client } from 'pg'
import { asSuperuser, asUser, makePerson, refused } from './db'

type World = {
  boss: string; cara: string; rhys: string
  org: string; project: string
  caraPerson: string
}
let w: World

const rows = <T = Record<string, unknown>>(who: string, sql: string, params: unknown[] = []) =>
  asUser(who, (c) => c.query(sql, params)).then((r) => r.rows as T[])
const one = async <T = Record<string, unknown>>(
  who: string, sql: string, params: unknown[] = [],
) => (await rows<T>(who, sql, params))[0]
const sup = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  asSuperuser((c) => c.query(sql, params)).then((r) => r.rows as T[])

beforeAll(async () => {
  w = await asSuperuser(async (c: Client) => {
    const boss = await makePerson(c, 'Bea Boss', 'p16-bea@hbc.example')
    const cara = await makePerson(c, 'Cara Consultant', 'p16-cara@bel.example')
    const rhys = await makePerson(c, 'Rhys Rival', 'p16-rhys@ngt.example')
    const org = (await c.query(
      `insert into organisations (name, slug, status)
       values ('HBC','p16-hbc','active') returning id`)).rows[0].id
    await c.query(
      `insert into organisation_members (organisation_id, profile_id, role)
       values ($1,$2,'admin'), ($1,$3,'consultant'), ($1,$4,'consultant')`,
      [org, boss, cara, rhys])

    const project = (await asUser(boss, (u) =>
      u.query(`select create_project($1,'Kingsmead Wharf Block C','P16') as id`, [org])
    )).rows[0].id
    await asUser(boss, (u) => u.query('select seed_sample_data($1)', [project]))
    await c.query(
      `insert into project_members (project_id, profile_id, project_role)
       values ($1,$2,'member'), ($1,$3,'member')`, [project, cara, rhys])

    // Give one directory person a login, so there is somebody an assignment
    // can actually be emailed to. The seeded directory people have none, which
    // is the normal case for a consultant's staff.
    const caraPerson = (await c.query(
      `update project_people set profile_id = $2
        where project_id = $1 and name = 'Andrew Ridley' returning id`,
      [project, cara])).rows[0].id

    return { boss, cara, rhys, org, project, caraPerson }
  })
}, 120_000)

describe('an email is the recipient’s own query, not a careful copy of it', () => {
  test('the impersonated digest is identical to what that person loads', async () => {
    // The whole guarantee in one assertion. build_digest() sets the claim and
    // runs my_week(); my_week() is what the signed-in person calls. If these
    // ever differ, something in the email path is seeing more than the page.
    const built = await sup<{ d: Record<string, unknown> }>(
      'select build_digest($1) as d', [w.boss])
    const own = await one<{ d: Record<string, unknown> }>(w.boss, 'select my_week() as d')
    // Everything but the clock: the two are separate calls milliseconds apart,
    // and it is the content that has to match.
    const content = ({ generated_at: _, ...rest }: Record<string, unknown>) => rest
    expect(JSON.stringify(content(built[0].d))).toBe(JSON.stringify(content(own.d)))
  })

  test('the function that builds it is owned by a role RLS applies to', async () => {
    // This is the mechanism, and it is easy to undo by accident: a later
    // migration that recreates build_digest() without the owner line makes it
    // run as the superuser, every policy is bypassed, and the assertion above
    // still passes because both sides would be over-broad.
    const r = await sup<{ owner: string; bypass: boolean; definer: boolean }>(`
      select pg_get_userbyid(p.proowner) as owner, r.rolbypassrls as bypass,
             p.prosecdef as definer
      from pg_proc p join pg_roles r on r.rolname = pg_get_userbyid(p.proowner)
      where p.proname = 'build_digest'`)
    expect(r[0].owner).toBe('notifier')
    expect(r[0].bypass, 'the digest owner must not bypass row level security').toBe(false)
    expect(r[0].definer).toBe(true)
  })

  test('my_week() is invoker, so it is the caller’s view and nobody else’s', async () => {
    const r = await sup<{ definer: boolean }>(
      `select prosecdef as definer from pg_proc where proname = 'my_week'`)
    expect(r[0].definer, 'my_week must not be a definer, or RLS stops applying').toBe(false)
  })

  test('a consultant’s digest carries nothing belonging to a rival', async () => {
    const cara = await sup<{ d: { waiting: unknown[] } }>(
      'select build_digest($1) as d', [w.cara])
    const rhys = await sup<{ d: { waiting: unknown[] } }>(
      'select build_digest($1) as d', [w.rhys])
    // Andrew Ridley's work is Cara's; Rhys holds nothing on this project.
    expect(cara[0].d.waiting.length).toBeGreaterThan(0)
    expect(rhys[0].d.waiting.length).toBe(0)
  })

  test('nobody can build somebody else’s digest', async () => {
    const msg = await refused(() => asUser(w.cara, (c) =>
      c.query('select build_digest($1)', [w.boss])))
    expect(msg).toMatch(/permission denied/i)
  })
})

describe('a message is composed once, however often the job runs', () => {
  test('queueing twice adds nothing the second time', async () => {
    const first = await sup<{ q: Record<string, number> }>('select queue_notifications() as q')
    const total = Object.values(first[0].q).reduce((a, b) => a + Number(b), 0)
    expect(total).toBeGreaterThan(0)

    // Scoped to this suite's own project rather than counting what the second
    // call returns: the queue is global and the test files share one database,
    // so a global count answers for whatever another suite wrote in between.
    const mine = () => sup<{ dedupe_key: string }>(
      'select dedupe_key from notifications where project_id = $1 order by dedupe_key',
      [w.project])
    const before = await mine()
    expect(before.length).toBeGreaterThan(0)
    await sup('select queue_notifications()')
    expect(await mine()).toEqual(before)
  })

  test('an overdue message carries its due date, so a moved date is a new message', async () => {
    const r = await sup<{ dedupe_key: string }>(
      `select dedupe_key from notifications where kind = 'overdue' limit 1`)
    // project:record:person:date — the date is what makes a missed new deadline
    // a fresh message rather than a silence.
    expect(r[0]?.dedupe_key.split(':')).toHaveLength(4)
  })
})

describe('preferences are obeyed, and one of them does not exist', () => {
  test('switching a kind off stops it being queued', async () => {
    await asUser(w.cara, (c) => c.query(
      'select set_notification_preferences($1,$2,$3,$4,$5)',
      [false, false, false, false, false]))
    expect(await one<{ w: boolean }>(w.cara,
      `select wants_notification($1,'assignment') as w`, [w.cara])).toEqual({ w: false })
  })

  test('pausing wins over the four switches', async () => {
    await asUser(w.cara, (c) => c.query(
      'select set_notification_preferences($1,$2,$3,$4,$5)',
      [true, true, true, true, true]))
    for (const kind of ['assignment', 'overdue', 'digest', 'mention']) {
      const r = await one<{ w: boolean }>(w.cara,
        'select wants_notification($1,$2) as w', [w.cara, kind])
      expect(r.w, `${kind} should be paused`).toBe(false)
    }
  })

  test('an invitation cannot be switched off, even paused', async () => {
    // It is how somebody consents to join an account. One that could be muted
    // is a consent they have silently lost the ability to give.
    const r = await one<{ w: boolean }>(w.cara,
      `select wants_notification($1,'invitation') as w`, [w.cara])
    expect(r.w).toBe(true)
  })

  test('no row is not a decision to be left out', async () => {
    const r = await one<{ w: boolean }>(w.boss,
      `select wants_notification($1,'digest') as w`, [w.boss])
    expect(r.w).toBe(true)
  })

  test('preferences are private, and not an administrator’s business', async () => {
    // Whether somebody wants an email is not project data. The account admin
    // has no read here.
    const seen = await rows(w.boss,
      'select * from notification_preferences where profile_id = $1', [w.cara])
    expect(seen).toHaveLength(0)
  })
})

describe('the ledger is a record, not a draft', () => {
  test('a person reads what was sent to them and nothing else', async () => {
    const mine = await rows(w.cara, 'select * from notifications')
    const theirs = await rows(w.cara,
      'select * from notifications where profile_id = $1', [w.boss])
    expect(mine.length).toBeGreaterThan(0)
    expect(theirs).toHaveLength(0)
  })

  test('nobody can write it, mark their own sent, or delete one', async () => {
    const id = (await sup<{ id: string }>('select id from notifications limit 1'))[0].id
    for (const sql of [
      `insert into notifications (email, kind, subject, body, dedupe_key)
       values ('x@y.z','digest','x','x','x')`,
      `update notifications set sent_at = now() where id = '${id}'`,
      `delete from notifications where id = '${id}'`,
    ]) {
      const msg = await refused(() => asUser(w.cara, (c) => c.query(sql)))
      expect(msg).toMatch(/permission denied|violates row-level security/i)
    }
  })

  test('the sender can call what it needs, and only what it needs', async () => {
    // Revoking the default PUBLIC execute takes it from every role, service_role
    // included. Without granting it back the scheduled job is refused by its own
    // database -- and nothing says so until it runs against a real project,
    // which is exactly how this was found.
    await asSuperuser(async (c) => {
      // `set role`, not `set local role`: outside a transaction the local form
      // silently does nothing, and the whole test then runs as the superuser
      // and proves nothing at all.
      await c.query('set role service_role')
      try {
        const r = await c.query('select queue_notifications() as q')
        expect(r.rows[0].q).toBeTruthy()
        await c.query('select pending_notifications(10)')
        // The four queue_* underneath are reached only through the definer
        // above, which runs as its owner, so they stay closed even to the
        // sender.
        await expect(c.query('select queue_digests(null)'))
          .rejects.toThrow(/permission denied/i)
      } finally {
        await c.query('reset role')
      }
    })
  })

  test('the sender’s own functions are closed to everybody else', async () => {
    for (const call of [
      'select queue_notifications()',
      'select pending_notifications(10)',
      `select resolve_notification('00000000-0000-0000-0000-000000000000', null)`,
    ]) {
      const msg = await refused(() => asUser(w.boss, (c) => c.query(call)))
      expect(msg, call).toMatch(/permission denied/i)
    }
  })
})

/**
 * The seam between the two halves of the phase.
 *
 * The database decides what a message contains and writes it as JSON; the Edge
 * Function only lays that out as text. Nothing type checks across that line —
 * the body is a `text` column on one side and `JSON.parse` on the other — so a
 * key renamed in SQL, or read under a name it never had, produces an email
 * saying "has invited you to undefined" and no error anywhere. That is exactly
 * what `data.account` did against a body whose key is `organisation`.
 */
describe('the sender reads the keys the queue actually writes', () => {
  test('every field the layout reads exists in a queued body', async () => {
    // An invitation to somebody with no login at all, which is the normal case
    // for the first person at a consultant and the one body the other tests
    // never queue.
    await asSuperuser((c) => c.query(
      `insert into invitations (scope, organisation_id, email, role, token, invited_by)
       values ('organisation', $1, 'p16-nobody@bel.example', 'consultant',
               'p16-token-' || gen_random_uuid(), $2)`, [w.org, w.boss]))
    // Phase 17 gave the seam a fifth kind. A mention is the only body carrying
    // `room`, `author` and `said`, so without one here the check below would
    // pass over three of the fields the layout reads.
    await asSuperuser(async (c) => {
      const room = (await c.query(
        `insert into chat_rooms (project_id, name, created_by)
         values ($1, 'p16-seam', $2) returning id`, [w.project, w.boss])).rows[0].id
      await c.query(
        `insert into comments (project_id, entity_type, entity_id, author_id, body, mentions)
         values ($1, 'room', $2, $3, 'Have a look at this', array[$4::uuid])`,
        // Rhys, not Cara: the preference tests above leave Cara paused, and a
        // paused person is queued nothing.
        [w.project, room, w.boss, w.rhys])
    })
    await sup('select queue_notifications()')

    const bodies = await sup<{ body: string }>('select body from notifications')
    const known = new Set<string>()
    for (const b of bodies) {
      try { Object.keys(JSON.parse(b.body)).forEach((k) => known.add(k)) } catch { /* text */ }
    }
    // If this is empty the assertion below would pass by vacuum.
    expect(known.size).toBeGreaterThan(4)

    const src = await import('node:fs/promises')
      .then((fs) => fs.readFile('supabase/functions/send-notifications/index.ts', 'utf8'))
    const render = src.slice(src.indexOf('function render('))
    const read = [...render.matchAll(/\bdata\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1])
    expect(read.length).toBeGreaterThan(6)
    for (const key of new Set(read)) expect(known, `data.${key}`).toContain(key)
  })
})
