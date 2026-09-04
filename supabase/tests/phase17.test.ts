/**
 * Phase 17 — project rooms.
 *
 * The module exists because the conversations that have not found a record yet
 * are happening on WhatsApp, where the golden thread cannot see them. Two
 * things have to be true for moving them here to be an improvement rather than
 * a liability, and both are asserted below.
 *
 * The first is that a room's audience actually governs its messages. A message
 * defaults to `{"mode":"project"}` like every comment, so a `named` room whose
 * messages carried their own visibility would be a room that means nothing.
 *
 * The second is that nothing said in one can be made to disappear. There is no
 * delete for a room message at all — not hidden behind a role, refused by the
 * policy — and a withdrawal marks the row rather than removing it.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import type { Client } from 'pg'
import { asSuperuser, asUser, makePerson, refused } from './db'

type World = {
  boss: string; cara: string; rhys: string; clive: string
  org: string; project: string
  open: string; named: string
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
    const boss = await makePerson(c, 'Bea Boss', 'p17-bea@hbc.example')
    const cara = await makePerson(c, 'Cara Consultant', 'p17-cara@bel.example')
    const rhys = await makePerson(c, 'Rhys Rival', 'p17-rhys@ngt.example')
    const clive = await makePerson(c, 'Clive Client', 'p17-clive@dev.example')
    const org = (await c.query(
      `insert into organisations (name, slug, status)
       values ('HBC','p17-hbc','active') returning id`)).rows[0].id
    await c.query(
      `insert into organisation_members (organisation_id, profile_id, role)
       values ($1,$2,'admin'), ($1,$3,'consultant'), ($1,$4,'consultant'), ($1,$5,'client')`,
      [org, boss, cara, rhys, clive])

    const project = (await asUser(boss, (u) =>
      u.query(`select create_project($1,'Kingsmead Wharf Block C','P17') as id`, [org])
    )).rows[0].id
    await c.query(
      `insert into project_members (project_id, profile_id, project_role)
       values ($1,$2,'member'), ($1,$3,'member'), ($1,$4,'member')`,
      [project, cara, rhys, clive])

    // Two rooms: one the whole project can read, and one naming Cara alone.
    const open = (await c.query(
      `insert into chat_rooms (project_id, name, purpose, created_by)
       values ($1,'Facade','Cladding coordination',$2) returning id`,
      [project, boss])).rows[0].id
    const named = (await c.query(
      `insert into chat_rooms (project_id, name, visibility, created_by)
       values ($1,'Facade commercial', jsonb_build_object('mode','named','people',
               jsonb_build_array($2::text)), $3) returning id`,
      [project, cara, boss])).rows[0].id

    return { boss, cara, rhys, clive, org, project, open, named }
  })
})

describe('the room decides who reads its messages, not the message', () => {
  test('a message in a named room is invisible to the rest of the project', async () => {
    await asUser(w.cara, (c) => c.query('select post_message($1,$2)',
      [w.named, 'Their claim is not going to stand up']))

    // The message carries the default {"mode":"project"} of every comment. If
    // the policy read the message's own visibility rather than the room's, the
    // whole project would have it.
    const mode = await sup<{ visibility: { mode: string } }>(
      `select visibility from comments where entity_type='room' and entity_id=$1`, [w.named])
    expect(mode[0].visibility.mode).toBe('project')

    expect(await rows(w.cara, 'select * from room_messages($1)', [w.named])).toHaveLength(1)
    expect(await rows(w.rhys, 'select * from room_messages($1)', [w.named])).toHaveLength(0)
    expect(await rows(w.clive, 'select * from room_messages($1)', [w.named])).toHaveLength(0)
  })

  test('an admin reads every room, which is why these are rooms and not messages', async () => {
    // Not an oversight to be fixed. A channel in a Building Safety Act tool
    // where two people can agree something and leave no trace is the thing
    // the module is meant to replace.
    expect(await rows(w.boss, 'select * from room_messages($1)', [w.named])).toHaveLength(1)
  })

  test('somebody outside the room cannot post into it', async () => {
    const msg = await refused(() => asUser(w.rhys, (c) =>
      c.query('select post_message($1,$2)', [w.named, 'Let me in'])))
    expect(msg).toMatch(/not found/i)
  })

  test('a direct insert past the function is refused too', async () => {
    // The guard is the policy, not the function: a row sent straight through
    // PostgREST must be refused by the database.
    const msg = await refused(() => asUser(w.rhys, (c) => c.query(
      `insert into comments (project_id, entity_type, entity_id, author_id, body)
       values ($1,'room',$2,$3,'Let me in')`, [w.project, w.named, w.rhys])))
    expect(msg).toMatch(/policy/i)
  })

  test('the room states its audience rather than listing everybody', async () => {
    const a = await one<{ room_audience: Record<string, unknown> }>(
      w.cara, 'select room_audience($1)', [w.named])
    expect(a.room_audience.mode).toBe('named')
    expect(a.room_audience.people).toEqual(['Cara Consultant'])
    expect(a.room_audience.opened_by).toBe('Bea Boss')
  })

  test('a room nobody may read reports no audience at all', async () => {
    const a = await one<{ room_audience: unknown }>(
      w.rhys, 'select room_audience($1)', [w.named])
    expect(a.room_audience).toBeNull()
  })
})

describe('nothing said in a room can be made to disappear', () => {
  let id: string

  beforeAll(async () => {
    id = (await one<{ post_message: string }>(w.cara,
      'select post_message($1,$2)', [w.open, 'I think that detail is wrong'])).post_message
  })

  test('there is no delete for a room message, for anybody', async () => {
    // A delete the policy refuses removes nothing and raises nothing — which
    // is why this asserts the row survives rather than expecting an error.
    for (const who of [w.cara, w.boss]) {
      const r = await asUser(who, (c) =>
        c.query('delete from comments where id = $1', [id]))
      expect(r.rowCount, 'a room message must not be deletable').toBe(0)
    }
    const still = await sup<{ n: string }>(
      'select count(*) as n from comments where id = $1', [id])
    expect(still[0].n).toBe('1')
  })

  test('a withdrawal marks the row and leaves it there', async () => {
    await asUser(w.cara, (c) => c.query('select withdraw_message($1)', [id]))
    const m = await one<{ deleted_at: string | null; deleted_by: string; body: string }>(
      w.cara, 'select * from room_messages($1)', [w.open])
    expect(m.deleted_at).not.toBeNull()
    expect(m.deleted_by).toBe('Cara Consultant')
    // The text stays. A withdrawal says to disregard it; it does not rewrite
    // what the conversation contained, and the people who can still read it
    // are exactly the people who had already read it.
    expect(m.body).toBe('I think that detail is wrong')
  })

  test('withdrawing twice is a no-op rather than an error', async () => {
    await asUser(w.cara, (c) => c.query('select withdraw_message($1)', [id]))
  })

  test('a withdrawn message can no longer be edited', async () => {
    const r = await asUser(w.cara, (c) =>
      c.query('update comments set body = $2 where id = $1', [id, 'Actually it is fine']))
    expect(r.rowCount).toBe(0)
    const m = await sup<{ body: string }>('select body from comments where id = $1', [id])
    expect(m[0].body).toBe('I think that detail is wrong')
  })

  test('somebody else’s message is not theirs to withdraw', async () => {
    const other = (await one<{ post_message: string }>(w.rhys,
      'select post_message($1,$2)', [w.open, 'Mine'])).post_message
    const msg = await refused(() => asUser(w.cara, (c) =>
      c.query('select withdraw_message($1)', [other])))
    expect(msg).toMatch(/not yours/i)
  })

  test('an ordinary comment is still deleted, not withdrawn', async () => {
    // The change is scoped to rooms. Everything else keeps the behaviour it
    // had, or this migration is a change to eleven other pages.
    const issue = (await one<{ raise_issue: { id: string } }>(w.boss,
      'select raise_issue($1,$2)', [w.project, 'Something to comment on'])).raise_issue
    const c1 = (await sup<{ id: string }>(
      `insert into comments (project_id, entity_type, entity_id, author_id, body)
       values ($1,'issue',$2,$3,'A plain comment') returning id`,
      [w.project, issue.id, w.cara]))[0].id

    const msg = await refused(() => asUser(w.cara, (c) =>
      c.query('select withdraw_message($1)', [c1])))
    expect(msg).toMatch(/not found/i)

    // And it is still deletable, exactly as it was before this phase.
    const r = await asUser(w.cara, (c) => c.query('delete from comments where id = $1', [c1]))
    expect(r.rowCount).toBe(1)
  })
})

describe('an exchange becomes a task', () => {
  test('the selection is quoted into it and the room says where it went', async () => {
    const a = (await one<{ post_message: string }>(w.cara,
      'select post_message($1,$2)', [w.open, 'The parapet detail does not close'])).post_message
    const b = (await one<{ post_message: string }>(w.boss,
      'select post_message($1,$2)', [w.open, 'Agreed — we need a revised section'])).post_message

    const r = await one<{ raise_from_room: { ok: boolean; id: string; reference: string } }>(
      w.boss, 'select raise_from_room($1,$2,$3)',
      [w.open, [a, b], 'Revised parapet section'])
    const out = r.raise_from_room
    expect(out.ok).toBe(true)
    expect(out.reference).toMatch(/^TSK-/)

    const issue = await one<{ description: string; source_kind: string; origin_comment_id: string }>(
      w.boss, 'select description, source_kind, origin_comment_id from issues where id = $1',
      [out.id])
    expect(issue.source_kind).toBe('chat')
    expect(issue.description).toContain('The parapet detail does not close')
    expect(issue.description).toContain('Agreed — we need a revised section')
    // The exchange started at the first message, not the lowest id.
    expect(issue.origin_comment_id).toBe(a)

    // And the room is told, or the conversation carries on underneath a task
    // nobody in it knows exists.
    const last = await rows<{ body: string }>(w.boss,
      `select body from room_messages($1) order by created_at desc limit 1`, [w.open])
    expect(last[0].body).toContain(out.reference)
  })

  test('a selection from a room you cannot read is refused', async () => {
    const mine = (await one<{ post_message: string }>(w.cara,
      'select post_message($1,$2)', [w.named, 'Commercially sensitive'])).post_message
    const msg = await refused(() => asUser(w.rhys, (c) =>
      c.query('select raise_from_room($1,$2,$3)', [w.named, [mine], 'Give me that'])))
    expect(msg).toMatch(/not found/i)
  })

  test('an empty selection is refused rather than raising an empty task', async () => {
    const msg = await refused(() => asUser(w.boss, (c) =>
      c.query('select raise_from_room($1,$2,$3)', [w.open, [], 'Nothing in particular'])))
    expect(msg).toMatch(/choose the messages/i)
  })

  test('messages from another room cannot be quoted into it', async () => {
    const elsewhere = (await one<{ post_message: string }>(w.cara,
      'select post_message($1,$2)', [w.named, 'Different room'])).post_message
    const msg = await refused(() => asUser(w.boss, (c) =>
      c.query('select raise_from_room($1,$2,$3)',
        [w.open, [elsewhere], 'Quote from somewhere else'])))
    expect(msg).toMatch(/not in this room/i)
  })
})

describe('chatter does not make a stalled item look alive', () => {
  test('gone_quiet counts a comment on the record, never a room message', async () => {
    // A room full of banter must not stop a stalled issue being found, or the
    // finding stops being a finding.
    const src = await sup<{ src: string }>(
      `select prosrc as src from pg_proc where proname = 'gone_quiet'`)
    expect(src[0].src).toContain("entity_type = 'issue'")
    expect(src[0].src).not.toContain("'room'")
  })

  test('a room message writes nothing to the change log', async () => {
    // Chat volume would drown a log whose whole value is that it is readable.
    const before = await sup<{ n: string }>(
      'select count(*) as n from change_log where project_id = $1', [w.project])
    await asUser(w.cara, (c) => c.query('select post_message($1,$2)',
      [w.open, 'Nothing to see here']))
    const after = await sup<{ n: string }>(
      'select count(*) as n from change_log where project_id = $1', [w.project])
    expect(after[0].n).toBe(before[0].n)
  })
})

describe('being named reaches the person named', () => {
  test('a mention is queued, once, and only for somebody who can read the room', async () => {
    await asUser(w.cara, (c) => c.query(
      'select post_message($1,$2,$3,$4)',
      [w.open, 'Bea, can you confirm?', null, [w.boss, w.rhys]]))
    await sup('select queue_notifications()')

    const n = await sup<{ profile_id: string }>(
      `select profile_id from notifications where kind = 'mention'
       and project_id = $1`, [w.project])
    expect(n.map((x) => x.profile_id).sort()).toEqual([w.boss, w.rhys].sort())

    // Scoped to this project: the queue is global and suites share a database.
    await sup('select queue_notifications()')
    const after = await sup<{ profile_id: string }>(
      `select profile_id from notifications where kind = 'mention' and project_id = $1`,
      [w.project])
    expect(after).toHaveLength(n.length)
  })

  test('naming somebody who cannot read the room does not name them', async () => {
    // The mention would be a notification about something they then could not
    // open, which is worse than not being told.
    const id = (await one<{ post_message: string }>(w.cara,
      'select post_message($1,$2,$3,$4)',
      [w.named, 'Rhys should see this', null, [w.rhys]])).post_message
    const m = await sup<{ mentions: string[] }>(
      'select mentions from comments where id = $1', [id])
    expect(m[0].mentions).toEqual([])
  })
})

describe('a room is finished, never removed', () => {
  test('no role holds delete on chat_rooms', async () => {
    const p = await sup<{ n: string }>(
      `select count(*) as n from pg_policies
       where tablename = 'chat_rooms' and cmd = 'DELETE'`)
    expect(p[0].n).toBe('0')
  })

  test('an archived room still reads, and refuses new messages', async () => {
    await asUser(w.boss, (c) => c.query(
      'update chat_rooms set archived_at = now() where id = $1', [w.open]))
    expect((await rows(w.boss, 'select * from room_messages($1)', [w.open])).length)
      .toBeGreaterThan(0)
    const msg = await refused(() => asUser(w.boss, (c) =>
      c.query('select post_message($1,$2)', [w.open, 'One more thing'])))
    expect(msg).toMatch(/archived/i)
    await asUser(w.boss, (c) => c.query(
      'update chat_rooms set archived_at = null where id = $1', [w.open]))
  })

  test('a room cannot be moved into another project by editing it', async () => {
    // The row policy checks the row being written rather than the one it
    // started from, so this is a column grant question, not a policy one.
    const msg = await refused(() => asUser(w.boss, (c) =>
      c.query('update chat_rooms set project_id = $1 where id = $2',
        [w.project, w.open])))
    expect(msg).toMatch(/permission denied/i)
  })
})

describe('a report is not changed by what happens in a room', () => {
  test('the discussion figure still counts correspondence against records', async () => {
    // Before rooms this counted comments on issues, drawings and duties, which
    // is what the sentence claims. Room messages are the same table, so
    // without the exclusion a busy week in one room reads as a productive
    // month across the project -- in a document sent to a client.
    const discussion = async () => {
      const r = await rows<{ headline: string }>(w.boss,
        `select headline from report_activity($1,'client',null,'month') where section = 'Discussion'`,
        [w.project])
      return r[0].headline
    }
    const before = await discussion()
    for (let i = 0; i < 5; i += 1) {
      await asUser(w.cara, (c) => c.query('select post_message($1,$2)',
        [w.open, `Chatter ${i}`]))
    }
    expect(await discussion()).toBe(before)
  })

  test('a client is told nothing about rooms at all', async () => {
    const r = await rows<{ section: string }>(w.boss,
      `select section from report_activity($1,'client',null,'month')`, [w.project])
    expect(r.map((x) => x.section)).not.toContain('Rooms')
  })

  test('the contractor’s own staff do get the figure', async () => {
    const r = await rows<{ section: string; headline: string }>(w.boss,
      `select section, headline from report_activity($1,'internal',null,'month')`,
      [w.project])
    const rooms = r.find((x) => x.section === 'Rooms')
    expect(rooms?.headline).toMatch(/message/)
  })

  test('no export offers a room', async () => {
    // Exports go out of the building. A room does not.
    const src = await import('node:fs/promises')
      .then((fs) => fs.readFile('src/lib/exports.ts', 'utf8'))
    expect(src).not.toMatch(/\brooms?\b/i)
  })
})

describe('the sample project opens its rooms and stops there', () => {
  test('two rooms, with audiences, and no invented conversation', async () => {
    // A room message needs an author, and an author is a login. The sample
    // directory has none, so the only voice available is whoever ran the seed
    // -- and a coordination thread where one person says nine things to
    // themselves teaches the reader that this is what the module looks like in
    // use. The rooms are real; the conversation is left to be real too.
    const project = await asSuperuser(async (c) => {
      const boss = await makePerson(c, 'Sam Seeder', 'p17-seed@hbc.example')
      const org = (await c.query(
        `insert into organisations (name, slug, status)
         values ('Seedco','p17-seed','active') returning id`)).rows[0].id
      await c.query(
        `insert into organisation_members (organisation_id, profile_id, role)
         values ($1,$2,'admin')`, [org, boss])
      const p = (await asUser(boss, (u) =>
        u.query(`select create_project($1,'Sample','P17S') as id`, [org]))).rows[0].id
      await asUser(boss, (u) => u.query('select seed_sample_data($1)', [p]))
      return { p, boss }
    })

    const r = await rows<{ name: string; mode: string; last_message_at: string | null }>(
      project.boss, 'select * from project_rooms($1)', [project.p])
    expect(r.map((x) => x.name).sort())
      .toEqual(['Commercial — internal', 'Facade coordination'])
    expect(r.map((x) => x.mode).sort()).toEqual(['internal', 'project'])
    expect(r.every((x) => x.last_message_at === null)).toBe(true)

    // And running it again does not open them a second time.
    await asUser(project.boss, (c) => c.query('select seed_sample_data($1)', [project.p]))
    expect(await rows(project.boss, 'select * from project_rooms($1)', [project.p]))
      .toHaveLength(2)
  })
})
