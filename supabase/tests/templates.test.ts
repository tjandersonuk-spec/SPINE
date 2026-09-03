/**
 * An account owns its templates, and owns only its own.
 *
 * All five libraries ship as a published default and an account works from that
 * default until it takes a copy. Everything below is about the boundary between
 * those two: a tenant may edit its fork and must not be able to reach the
 * published rows or another account's, whatever the UI offers.
 *
 * The interesting one is the column grant. RLS decides rows; GRANTs decide
 * columns, and the row policy would happily accept a write that moved a
 * template into somebody else's account -- because it checks the row being
 * written rather than the one it started from. `organisation_id` is outside the
 * update grant, so that write is refused before the policy is consulted.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import type { Client } from 'pg'
import { asSuperuser, asUser, makePerson, refused } from './db'

type World = { admin: string; other: string; org: string; otherOrg: string }
let w: World

const rows = <T = Record<string, unknown>>(who: string, sql: string, params: unknown[] = []) =>
  asUser(who, (c) => c.query(sql, params)).then((r) => r.rows as T[])
const one = async <T = Record<string, unknown>>(
  who: string, sql: string, params: unknown[] = [],
) => (await rows<T>(who, sql, params))[0]
const num = (v: unknown) => Number(v)

beforeAll(async () => {
  w = await asSuperuser(async (c: Client) => {
    const admin = await makePerson(c, 'Tess Admin', 'tpl-tess@hbc.example')
    const other = await makePerson(c, 'Owen Other', 'tpl-owen@ngt.example')
    const mk = async (name: string, slug: string, who: string) => {
      const org = (await c.query(
        `insert into organisations (name, slug, status) values ($1,$2,'active') returning id`,
        [name, slug])).rows[0].id
      await c.query(
        `insert into organisation_members (organisation_id, profile_id, role)
         values ($1,$2,'admin')`, [org, who])
      return org as string
    }
    return {
      admin, other,
      org: await mk('HBC', 'tpl-hbc', admin),
      otherOrg: await mk('Northgate', 'tpl-ngt', other),
    }
  })
})

describe('all five libraries ship a published default', () => {
  test('none of them is empty, so none of them can only be read', async () => {
    // Four of the five shipped empty for a long time, which made "load from
    // library" return nothing and read as broken rather than as a library
    // nobody had filled. A library with no published default cannot be forked
    // at all, so this is the assertion that keeps the fork path reachable.
    for (const t of ['drm_library_items', 'checklist_templates', 'scope_templates',
                     'risk_templates', 'warranty_templates']) {
      const r = await one<{ n: string }>(w.admin,
        `select count(*) as n from ${t} where organisation_id is null`)
      expect(num(r.n), `${t} ships no published default`).toBeGreaterThan(0)
    }
  })

  test('no shipped template quotes a licensed source', async () => {
    // BG6, the CIC schedules and BREEAM's criteria are licensed and are loaded
    // per project by whoever holds the licence. What ships is written for this
    // product, and this is the guard that keeps somebody pasting the real thing
    // in from being a quiet change.
    const hits = await rows<{ where: string }>(w.admin, `
      select 'checklist:' || reference as where from checklist_templates
       where organisation_id is null
         and (title ~* '\\y(BG ?6|CIC)\\y' or coalesce(prompt,'') ~* '\\y(BG ?6|CIC)\\y')
      union all
      select 'scope:' || reference from scope_template_items i
       where description ~* '\\y(BG ?6|CIC)\\y'
         and exists (select 1 from scope_templates t
                      where t.id = i.template_id and t.organisation_id is null)`)
    expect(hits.map((h) => h.where)).toEqual([])
  })
})

describe('an account edits its own fork and nothing else', () => {
  test('forking is idempotent and brings in only what is new', async () => {
    const first = await one<{ n: string }>(w.admin,
      'select fork_risk_templates($1) as n', [w.org])
    expect(num(first.n)).toBeGreaterThan(0)

    const again = await one<{ n: string }>(w.admin,
      'select fork_risk_templates($1) as n', [w.org])
    expect(num(again.n), 'forking twice must not double the library').toBe(0)

    // A row added to the published set afterwards is picked up without
    // disturbing an edit already made to the fork.
    await asSuperuser((c) => c.query(
      `insert into risk_templates (organisation_id, reference, kind, title, likelihood)
       values (null, 'RL-99', 'risk', 'Something published later', 3)`))
    const third = await one<{ n: string }>(w.admin,
      'select fork_risk_templates($1) as n', [w.org])
    expect(num(third.n)).toBe(1)
  })

  test('the fork is what the account reads once it has one', async () => {
    await asUser(w.admin, (c) => c.query(
      `update risk_templates set title = 'Our own wording'
        where organisation_id = $1 and reference = 'RL-01'`, [w.org]))

    const mine = await one<{ title: string }>(w.admin,
      `select title from account_risk_templates($1) where reference = 'RL-01'`, [w.org])
    expect(mine.title).toBe('Our own wording')

    // And the account that has not forked still reads the published wording.
    const theirs = await one<{ title: string }>(w.other,
      `select title from account_risk_templates($1) where reference = 'RL-01'`, [w.otherOrg])
    expect(theirs.title).not.toBe('Our own wording')
  })

  test('a published row cannot be edited by a tenant', async () => {
    // Not an error: the row policy simply does not match, so nothing is
    // updated. The published library is what every account that has not forked
    // is reading, so one tenant editing it would edit it for all of them.
    const r = await asUser(w.admin, (c) => c.query(
      `update risk_templates set title = 'Tampered' where organisation_id is null`))
    expect(r.rowCount).toBe(0)
  })

  test('another account’s fork cannot be edited either', async () => {
    await asUser(w.other, (c) => c.query('select fork_warranty_templates($1)', [w.otherOrg]))
    const r = await asUser(w.admin, (c) => c.query(
      `update warranty_templates set title = 'Reached across' where organisation_id = $1`,
      [w.otherOrg]))
    expect(r.rowCount).toBe(0)
  })

  test('a template cannot be moved into another account', async () => {
    // The row policy would accept this: it checks the row being written, and
    // the write names an account the writer administers or does not. The column
    // grant is what refuses it, before the policy is reached.
    const msg = await refused(() => asUser(w.admin, (c) => c.query(
      `update risk_templates set organisation_id = $1 where organisation_id = $2`,
      [w.otherOrg, w.org])))
    expect(msg).toMatch(/permission denied/i)
  })

  test('forking is an admin act', async () => {
    const msg = await refused(() => asUser(w.other, (c) =>
      c.query('select fork_risk_templates($1)', [w.org])))
    expect(msg).toMatch(/only an account admin/i)
  })
})

describe('editing a template never rewrites a project that already loaded it', () => {
  test('a project keeps the wording it was given', async () => {
    const project = await asSuperuser(async (c) => {
      const p = (await asUser(w.admin, (u) =>
        u.query(`select create_project($1,'Tpl','TPL') as id`, [w.org]))).rows[0].id
      return p as string
    })
    await asUser(w.admin, (c) => c.query('select fork_warranty_templates($1)', [w.org]))
    await asUser(w.admin, (c) => c.query('select load_warranty_library($1)', [project]))

    const before = await one<{ title: string }>(w.admin,
      `select title from warranties where project_id = $1 order by reference limit 1`,
      [project])

    await asUser(w.admin, (c) => c.query(
      `update warranty_templates set title = 'Renamed after the fact'
        where organisation_id = $1`, [w.org]))

    const after = await one<{ title: string }>(w.admin,
      `select title from warranties where project_id = $1 order by reference limit 1`,
      [project])
    expect(after.title).toBe(before.title)
  })
})
