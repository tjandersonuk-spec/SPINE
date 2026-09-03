/**
 * Entitlements as bolt-ons.
 *
 * Modules are packaging, not permission: turning one off removes it from the
 * nav and its page refuses, and the data underneath is untouched because RLS
 * never asked. What these tests hold is WHO may set the map -- the platform
 * owner alone at account level, and an account admin only ever downwards on a
 * project -- and that the registry is one list.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import type { Client } from 'pg'
import { asSuperuser, asUser, makePerson, refused } from './db'

type World = { owner: string; admin: string; consultant: string; org: string; project: string }
let w: World

const denied = (who: string, sql: string, params: unknown[] = []) =>
  refused(() => asUser(who, (c) => c.query(sql, params)))
const rows = <T = Record<string, unknown>>(who: string, sql: string, params: unknown[] = []) =>
  asUser(who, (c) => c.query(sql, params)).then((r) => r.rows as T[])
const one = async <T = Record<string, unknown>>(
  who: string, sql: string, params: unknown[] = [],
) => (await rows<T>(who, sql, params))[0]

beforeAll(async () => {
  w = await asSuperuser(async (c: Client) => {
    const owner = await makePerson(c, 'Olive Owner', 'ent-owner@spine.example')
    await c.query('insert into platform_owners (profile_id) values ($1)', [owner])
    const admin = await makePerson(c, 'Ada Admin', 'ent-ada@hbc.example')
    const consultant = await makePerson(c, 'Cara Consultant', 'ent-cara@bel.example')
    const org = (await c.query(
      `insert into organisations (name, slug, status) values ('HBC-ENT','hbc-ent','active')
       returning id`)).rows[0].id
    await c.query(
      `insert into organisation_members (organisation_id, profile_id, role)
       values ($1,$2,'admin'), ($1,$3,'consultant')`, [org, admin, consultant])
    const project = (await c.query(
      `insert into projects (organisation_id, name, code) values ($1,'Ent','ENT1')
       returning id`, [org])).rows[0].id
    await c.query(
      `insert into project_members (project_id, profile_id, project_role)
       values ($1,$2,'member')`, [project, consultant])
    // Something behind a module, so "off is not deleted" has something to read.
    await c.query(
      `insert into breeam_schemes (project_id, version) values ($1,'TEST 1.0')`, [project])
    return { owner, admin, consultant, org, project }
  })
})

describe('one registry', () => {
  test('module_keys() is the catalogue, in order', async () => {
    const keys = (await one<{ k: string[] }>(w.admin, 'select module_keys() as k')).k
    const cat = await rows<{ key: string; label: string; group: string }>(w.admin,
      'select key, label, "group" from module_catalogue() order by sort')
    expect(keys).toEqual(cat.map((c) => c.key))
    // Every entry has a human label and a group, because the platform owner's
    // editor and the project settings screen both render straight from here.
    for (const c of cat) {
      expect(c.label.length).toBeGreaterThan(2)
      expect(c.group.length).toBeGreaterThan(2)
    }
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('a key that is not a module is refused everywhere', async () => {
    // A nav group title is not a module. This sat in a live row for six
    // phases meaning nothing, which is why the validator is now shared.
    expect(await denied(w.owner, `select set_modules($1,'{"compliance":true}'::jsonb)`, [w.org]))
      .toMatch(/No module called "compliance"/)
    expect(await denied(w.owner,
      `select update_account_as_owner($1,null,null,null,'{"commercial":true}'::jsonb)`, [w.org]))
      .toMatch(/No module called "commercial"/)
    expect(await denied(w.owner, `select set_modules($1,'{"breeam":"yes"}'::jsonb)`, [w.org]))
      .toMatch(/must be true or false/)
  })
})

describe('a key that is not a module is not a module that is off', () => {
  test('the legacy tier keys are stripped from live rows', async () => {
    // The approval form used to write {compliance, commercial} -- nav group
    // titles, never modules. Nothing ever read them, but the owner's account
    // card counted their `false` values, so a core-tier account reported
    // "2 switched off" with every checkbox on the editor ticked.
    const legacy = await asSuperuser(async (c: Client) => {
      const org = (await c.query(
        `insert into organisations (name, slug, status, modules)
         values ('Legacy','ent-legacy','active','{"compliance":false,"commercial":false}'::jsonb)
         returning id`)).rows[0].id
      const proj = (await c.query(
        `insert into projects (organisation_id, name, code, modules_override)
         values ($1,'Old','OLD1','{"compliance":false,"breeam":false}'::jsonb)
         returning id`, [org])).rows[0].id
      // Re-run the cleanup exactly as the migration does.
      await c.query(`
        update organisations o
           set modules = coalesce((
                 select jsonb_object_agg(k.key, o.modules -> k.key)
                 from jsonb_object_keys(o.modules) as k(key)
                 where k.key = any(module_keys())), '{}'::jsonb)
         where o.id = $1
           and exists (select 1 from jsonb_object_keys(o.modules) as k(key)
                       where not (k.key = any(module_keys())))`, [org])
      await c.query(`
        update projects p
           set modules_override = (
                 select case when count(*) = 0 then null
                             else jsonb_object_agg(k.key, p.modules_override -> k.key) end
                 from jsonb_object_keys(p.modules_override) as k(key)
                 where k.key = any(module_keys()))
         where p.id = $1
           and exists (select 1 from jsonb_object_keys(p.modules_override) as k(key)
                       where not (k.key = any(module_keys())))`, [proj])
      return { org, proj }
    })

    const o = await one<{ modules: Record<string, boolean> }>(w.owner,
      'select modules from organisations where id = $1', [legacy.org])
    // Nothing meaningful was lost: an empty map is the complete product, which
    // is what a tier map of meaningless keys always described.
    expect(o.modules).toEqual({})

    // Read as superuser: the platform owner deliberately cannot see project
    // rows, and this is an assertion about the data's shape rather than about
    // who may look at it.
    const p = await asSuperuser((c: Client) => c.query(
      'select modules_override from projects where id = $1', [legacy.proj])
      .then((r) => r.rows[0] as { modules_override: Record<string, boolean> }))
    // The real key survives; the junk beside it does not.
    expect(p.modules_override).toEqual({ breeam: false })
  })

  test('the off count is against the catalogue, not the stored values', async () => {
    // What the owner's account card reads. A legacy key counts for nothing
    // because it is not a module.
    const r = await one<{ legacy: number; real: number; mixed: number; empty: number }>(w.owner, `
      select modules_off_count('{"compliance":false,"commercial":false}'::jsonb) as legacy,
             modules_off_count('{"breeam":false,"fees":false}'::jsonb) as real,
             modules_off_count('{"compliance":false,"breeam":false}'::jsonb) as mixed,
             modules_off_count('{}'::jsonb) as empty`)
    expect([Number(r.legacy), Number(r.real), Number(r.mixed), Number(r.empty)])
      .toEqual([0, 2, 1, 0])
    // A module explicitly ON is not off either.
    expect(Number((await one<{ n: number }>(w.owner,
      `select modules_off_count('{"breeam":true}'::jsonb) as n`)).n)).toBe(0)
  })
})

describe('the account map is the platform owner’s to sell', () => {
  test('an account admin cannot widen their own entitlements', async () => {
    // Not by the function, which is the path that would look legitimate...
    expect(await denied(w.admin, `select set_modules($1,'{"breeam":true}'::jsonb)`, [w.org]))
      .toMatch(/set by the platform owner/)
    // ...and not by the column, which Phase 1 already closed.
    expect(await denied(w.admin,
      `update organisations set modules = '{"breeam":true}'::jsonb where id = $1`, [w.org]))
      .toMatch(/permission denied/)
    // Nor can they NARROW at account level: that is a commercial change too,
    // and it belongs with whoever carries the contract.
    expect(await denied(w.admin, `select set_modules($1,'{"breeam":false}'::jsonb)`, [w.org]))
      .toMatch(/set by the platform owner/)
  })

  test('the platform owner can, and it is audited', async () => {
    await asUser(w.owner, (c) => c.query(
      `select set_modules($1,'{"breeam":false,"fees":false}'::jsonb)`, [w.org]))
    const m = await one<{ modules: Record<string, boolean> }>(w.owner,
      'select modules from organisations where id = $1', [w.org])
    expect(m.modules).toEqual({ breeam: false, fees: false })
    const audit = await rows(w.owner,
      `select detail from platform_audit
        where organisation_id = $1 and action = 'set_modules' order by at desc limit 1`,
      [w.org])
    expect(audit).toHaveLength(1)
    expect((audit[0].detail as { to: unknown }).to).toEqual({ breeam: false, fees: false })
  })

  test('off is absent from the shell, not dimmed', async () => {
    const s = (await one<{ s: { modules: Record<string, boolean> } }>(w.consultant,
      'select project_shell($1) as s', [w.project])).s
    expect(s.modules.breeam).toBe(false)
    expect(s.modules.fees).toBe(false)
    // Everything the owner said nothing about is on.
    expect(s.modules.drm).toBe(true)
    expect(s.modules.warranties).toBe(true)
  })

  test('off is not deleted: the data is still there for when it is bought back', async () => {
    // Entitlements are packaging. RLS decides what a person may read, and it
    // did not change when the module went off -- so switching it back on
    // later shows exactly what was there, not an empty module.
    expect((await one<{ v: boolean }>(w.consultant,
      `select module_on($1,'breeam') as v`, [w.project])).v).toBe(false)
    const schemes = await rows(w.consultant,
      'select version from breeam_schemes where project_id = $1', [w.project])
    expect(schemes.map((r) => r.version)).toEqual(['TEST 1.0'])

    await asUser(w.owner, (c) => c.query(`select set_modules($1,'{}'::jsonb)`, [w.org]))
    expect((await one<{ v: boolean }>(w.consultant,
      `select module_on($1,'breeam') as v`, [w.project])).v).toBe(true)
  })
})

describe('a project override only narrows', () => {
  test('an account admin can switch a module off for one project', async () => {
    await asUser(w.admin, (c) => c.query(
      `select set_project_modules($1,'{"materials":false}'::jsonb)`, [w.project]))
    expect((await one<{ v: boolean }>(w.consultant,
      `select module_on($1,'materials') as v`, [w.project])).v).toBe(false)
    // And put it back by clearing the override, not by writing true.
    await asUser(w.admin, (c) => c.query(`select set_project_modules($1,null)`, [w.project]))
    expect((await one<{ v: boolean }>(w.consultant,
      `select module_on($1,'materials') as v`, [w.project])).v).toBe(true)
  })

  test('an account admin cannot switch one on that the account does not have', async () => {
    await asUser(w.owner, (c) => c.query(
      `select set_modules($1,'{"breeam":false}'::jsonb)`, [w.org]))
    // This was the back door: a true in the override beat the account map.
    expect(await denied(w.admin,
      `select set_project_modules($1,'{"breeam":true}'::jsonb)`, [w.project]))
      .toMatch(/can only switch a module off/)
    // Even a true for something the account already has is refused, because
    // the rule is about the direction and not the current state.
    expect(await denied(w.admin,
      `select set_project_modules($1,'{"drm":true}'::jsonb)`, [w.project]))
      .toMatch(/can only switch a module off/)
    expect((await one<{ v: boolean }>(w.consultant,
      `select module_on($1,'breeam') as v`, [w.project])).v).toBe(false)
  })

  test('the platform owner may set a project either way', async () => {
    await asUser(w.owner, (c) => c.query(
      `select set_project_modules($1,'{"breeam":true}'::jsonb)`, [w.project]))
    expect((await one<{ v: boolean }>(w.consultant,
      `select module_on($1,'breeam') as v`, [w.project])).v).toBe(true)
    await asUser(w.owner, (c) => c.query(`select set_project_modules($1,null)`, [w.project]))
    await asUser(w.owner, (c) => c.query(`select set_modules($1,'{}'::jsonb)`, [w.org]))
  })

  test('a consultant cannot touch either', async () => {
    expect(await denied(w.consultant,
      `select set_project_modules($1,'{"drm":false}'::jsonb)`, [w.project]))
      .toMatch(/account admin/)
    expect(await denied(w.consultant,
      `update projects set modules_override = '{"drm":false}'::jsonb where id = $1`,
      [w.project])).toMatch(/permission denied/)
  })
})
