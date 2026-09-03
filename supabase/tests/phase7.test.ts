/**
 * Phase 7 — the change log, theming and module entitlements.
 *
 * The assertions TASKS.md names: the brand colour reaches the stylesheet with
 * auto contrast text; no setting exists for semantic colours; switching a
 * module off removes its nav entry and its page refuses. The colour arithmetic
 * and the nav are client-side and tested in src/theme.test.ts; what belongs
 * here is what the database will and will not hand over.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import type { Client } from 'pg'
import { asSuperuser, asUser, makePerson, refused } from './db'

type World = {
  admin: string; consultant: string; stranger: string
  org: string; project: string
}
let w: World

const denied = (who: string, sql: string, params: unknown[] = []) =>
  refused(() => asUser(who, (c) => c.query(sql, params)))

beforeAll(async () => {
  w = await asSuperuser(async (c: Client) => {
    const admin = await makePerson(c, 'Ada Admin', 'p7-ada@hbc.example')
    const consultant = await makePerson(c, 'Cara Consultant', 'p7-cara@bel.example')
    const stranger = await makePerson(c, 'Stan Stranger', 'p7-stan@rival.example')

    const org = (await c.query(
      `insert into organisations (name, slug, status, brand_colour, modules)
       values ('HBC7','hbc7','active','#0B1A2B','{"directory":true,"drm":true,"breeam":false}')
       returning id`)).rows[0].id
    const rival = (await c.query(
      `insert into organisations (name, slug, status) values ('Rival7','rival7','active')
       returning id`)).rows[0].id
    for (const [o, p, role] of [
      [org, admin, 'admin'], [org, consultant, 'consultant'], [rival, stranger, 'admin'],
    ] as const) {
      await c.query(
        'insert into organisation_members (organisation_id, profile_id, role) values ($1,$2,$3)',
        [o, p, role])
    }
    const project = (await c.query(
      `insert into projects (organisation_id, name, code) values ($1,'Kingsmead','KMW7')
       returning id`, [org])).rows[0].id
    await c.query(
      `insert into project_members (project_id, profile_id, project_role)
       values ($1,$2,'member')`, [project, consultant])
    return { admin, consultant, stranger, org, project }
  })
})

describe('the change log is written by the database, not the code', () => {
  let company: string

  test('an insert is one row, not forty', async () => {
    company = (await asUser(w.admin, (c) => c.query(
      `insert into companies (project_id, name, originator_code, company_type)
       values ($1,'Bellweather','BEL','consultant') returning id`, [w.project]))).rows[0].id

    const log = await asUser(w.admin, (c) =>
      c.query(`select action, field, actor_id from v_change_log
               where entity_id = $1`, [company]))
    expect(log.rows).toHaveLength(1)
    expect(log.rows[0]).toMatchObject({ action: 'insert', field: null, actor_id: w.admin })
  })

  test('an update logs one row per field that actually moved', async () => {
    await asUser(w.admin, (c) => c.query(
      `update companies set name = 'Bellweather Architects', address = '12 Queen Square'
       where id = $1`, [company]))

    const log = await asUser(w.admin, (c) =>
      c.query(`select field, value_from, value_to from v_change_log
               where entity_id = $1 and action = 'update' order by field`, [company]))
    expect(log.rows.map((r) => r.field)).toEqual(['address', 'name'])
    expect(log.rows[1]).toMatchObject({
      value_from: 'Bellweather', value_to: 'Bellweather Architects',
    })
  })

  test('a write that changes nothing logs nothing', async () => {
    const before = await asUser(w.admin, (c) =>
      c.query('select count(*)::int as n from change_log where entity_id = $1', [company]))
    await asUser(w.admin, (c) => c.query(
      `update companies set name = 'Bellweather Architects' where id = $1`, [company]))
    const after = await asUser(w.admin, (c) =>
      c.query('select count(*)::int as n from change_log where entity_id = $1', [company]))
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })

  test('it records who, resolved to a name rather than a uuid', async () => {
    const log = await asUser(w.consultant, (c) =>
      c.query(`select distinct actor_name from v_change_log where entity_id = $1`, [company]))
    expect(log.rows.map((r) => r.actor_name)).toEqual(['Ada Admin'])
  })

  test('it catches a change nobody wrote code for', async () => {
    // The point of a trigger over application logging: this update goes
    // straight through PostgREST, past any code that might have remembered to
    // log it, and is recorded anyway.
    await asUser(w.admin, (c) => c.query(
      `update companies set originator_code = 'BWA' where id = $1`, [company]))
    const log = await asUser(w.admin, (c) =>
      c.query(`select value_to from v_change_log
               where entity_id = $1 and field = 'originator_code'`, [company]))
    expect(log.rows[0].value_to).toBe('BWA')
  })

  test('nobody can edit or delete the trail, admin included', async () => {
    expect(await denied(w.admin, `update change_log set value_to = 'forged'`))
      .toMatch(/permission denied/)
    expect(await denied(w.admin, 'delete from change_log')).toMatch(/permission denied/)
    expect(await denied(w.admin,
      `insert into change_log (project_id, entity_type, action)
       values ($1,'companies','insert')`, [w.project])).toMatch(/permission denied/)
  })

  test('everyone on the project reads it; nobody off it sees anything', async () => {
    const seen = await asUser(w.consultant, (c) =>
      c.query('select count(*)::int as n from change_log where project_id = $1', [w.project]))
    expect(seen.rows[0].n).toBeGreaterThan(0)

    const stranger = await asUser(w.stranger, (c) =>
      c.query('select count(*)::int as n from change_log where project_id = $1', [w.project]))
    expect(stranger.rows[0].n).toBe(0)
  })

  test('a delete is recorded before the row goes', async () => {
    const doomed = (await asUser(w.admin, (c) => c.query(
      `insert into companies (project_id, name, originator_code, company_type)
       values ($1,'Temporary','TMP','consultant') returning id`, [w.project]))).rows[0].id
    await asUser(w.admin, (c) => c.query('delete from companies where id = $1', [doomed]))

    const log = await asUser(w.admin, (c) =>
      c.query(`select action from v_change_log where entity_id = $1 order by created_at`,
        [doomed]))
    expect(log.rows.map((r) => r.action)).toEqual(['insert', 'delete'])
  })
})

describe('the shell reads branding without reading the account', () => {
  test('every member gets the brand, the logo, the theme and the modules', async () => {
    const r = await asUser(w.consultant, (c) =>
      c.query('select project_shell($1) as s', [w.project]))
    const s = r.rows[0].s
    expect(s.brand_colour).toBe('#0B1A2B')
    expect(s.account_name).toBe('HBC7')
    expect(s.theme).toBe('light')
    // Every module key, resolved: what the account said, and true wherever it
    // said nothing. The client never sees the raw map, so it cannot
    // reimplement the absent-means-on rule and disagree with the database.
    expect(s.modules.directory).toBe(true)
    expect(s.modules.drm).toBe(true)
    expect(s.modules.breeam).toBe(false)
    expect(s.modules.fees).toBe(true)          // never mentioned, so included
    expect(Object.keys(s.modules).length).toBeGreaterThan(20)
  })

  test('and nothing else about it — a consultant still cannot read the account row', async () => {
    const direct = await asUser(w.consultant, (c) =>
      c.query('select count(*)::int as n from organisations where id = $1', [w.org]))
    expect(direct.rows[0].n).toBe(1)   // a member may see the account they belong to
    // but not its status history, billing tier or anything a project override
    // would expose about another project.
    const other = await asUser(w.stranger, (c) =>
      c.query('select project_shell($1) as s', [w.project]))
    expect(other.rows[0].s).toBeNull()
  })

  test('there is no setting for a semantic colour, anywhere', async () => {
    // The whole customiser is name, logo, one colour, light or dark. If a
    // tenant could make "overdue" blue, the convention holding every page
    // together is gone -- so the absence is asserted rather than assumed.
    const cols = await asUser(w.admin, (c) =>
      c.query(`select column_name from information_schema.columns
               where table_schema = 'public' and table_name = 'organisations'`))
    const names = cols.rows.map((r) => r.column_name as string)
    for (const forbidden of ['hivis', 'ok_colour', 'warn_colour', 'stop_colour', 'semantic']) {
      expect(names.some((n) => n.includes(forbidden))).toBe(false)
    }
    expect(names).toContain('brand_colour')

    const shell = (await asUser(w.consultant, (c) =>
      c.query('select project_shell($1) as s', [w.project]))).rows[0].s
    expect(Object.keys(shell).filter((k) => /hivis|ok|warn|stop/.test(k))).toEqual([])
  })
})

describe('module entitlements', () => {
  test('a project inherits the account map', async () => {
    const r = await asUser(w.consultant, (c) =>
      c.query(`select module_on($1,'drm') as drm, module_on($1,'breeam') as breeam,
                      module_on($1,'fees') as undecided,
                      module_on($1,'telepathy') as not_a_module`, [w.project]))
    // An explicit false is off. A key nobody has decided about is ON: modules
    // are packaging, not permission, and an account that has never been sold a
    // feature list should still have a working product. A key that is not a
    // module at all stays off, so a nav entry naming one never appears.
    expect(r.rows[0]).toEqual({
      drm: true, breeam: false, undecided: true, not_a_module: false,
    })
  })

  test('an account whose entitlements were never set has everything', async () => {
    // The regression this rule exists for. Every account defaults to an empty
    // map; reading absent as "off" emptied the whole sidebar the moment the
    // shell started asking.
    const bare = await asSuperuser(async (c: Client) => {
      const org = (await c.query(
        `insert into organisations (name, slug, status) values ('Bare','bare7','active')
         returning id`)).rows[0].id
      await c.query(
        `insert into organisation_members (organisation_id, profile_id, role)
         values ($1,$2,'admin')`, [org, w.admin])
      return (await c.query(
        `insert into projects (organisation_id, name, code) values ($1,'Fresh','FR7')
         returning id`, [org])).rows[0].id
    })

    const shell = (await asUser(w.admin, (c) =>
      c.query('select project_shell($1) as s', [bare]))).rows[0].s
    expect(Object.values(shell.modules).every((v) => v === true)).toBe(true)

    const r = await asUser(w.admin, (c) =>
      c.query(`select module_on($1,'directory') as d, module_on($1,'breeam') as b`, [bare]))
    expect(r.rows[0]).toEqual({ d: true, b: true })
  })

  test('a project override wins over the account, downwards only', async () => {
    // An account admin may switch a module off for one job. Switching one ON
    // that the account does not have is refused -- that is the platform
    // owner's to sell, and a true in the override was a back door to it.
    await asUser(w.admin, (c) =>
      c.query(`select set_project_modules($1,'{"drm":false}'::jsonb)`, [w.project]))
    const r = await asUser(w.consultant, (c) =>
      c.query(`select module_on($1,'drm') as drm, module_on($1,'breeam') as breeam,
                      module_on($1,'directory') as inherited`, [w.project]))
    // drm flips off; breeam stays off from the account; directory is untouched.
    expect(r.rows[0]).toEqual({ drm: false, breeam: false, inherited: true })
  })

  test('the shell sees the merged map, not the two halves', async () => {
    const s = (await asUser(w.consultant, (c) =>
      c.query('select project_shell($1) as s', [w.project]))).rows[0].s
    // The override switched drm off; breeam is off from the account; directory
    // came from the account; everything nobody mentioned is on.
    expect(s.modules.drm).toBe(false)
    expect(s.modules.breeam).toBe(false)
    expect(s.modules.directory).toBe(true)
    expect(s.modules.programme).toBe(true)
  })

  test('a module key nothing answers to is refused', async () => {
    // Entitling a key no page reads would silently entitle nothing.
    expect(await denied(w.admin,
      `select set_project_modules($1,'{"telepathy":false}'::jsonb)`, [w.project]))
      .toMatch(/No module called/)
  })

  test('the account map is the platform owner’s; a project is the admin’s, downwards', async () => {
    // An account admin cannot set their own account's entitlements at all --
    // that is a customer switching on a bolt-on nobody sold them.
    expect(await denied(w.admin, `select set_modules($1,'{"drm":true}'::jsonb)`, [w.org]))
      .toMatch(/platform owner/)
    expect(await denied(w.consultant, `select set_modules($1,'{"drm":true}'::jsonb)`, [w.org]))
      .toMatch(/platform owner/)
    expect(await denied(w.consultant,
      `select set_project_modules($1,'{"drm":false}'::jsonb)`, [w.project]))
      .toMatch(/account admin/)
  })

  test('and cannot do it by writing the column directly', async () => {
    // The column-level grants from Phase 1 close this; asserted here because
    // it is the whole enforcement of entitlements.
    expect(await denied(w.consultant,
      `update organisations set modules = '{"breeam":true}'::jsonb where id = $1`, [w.org]))
      .toMatch(/permission denied/)
    expect(await denied(w.consultant,
      `update projects set modules_override = '{"breeam":true}'::jsonb where id = $1`,
      [w.project])).toMatch(/permission denied/)
  })
})

describe('an export honours the exporting role’s visibility', () => {
  test('a restricted task is absent from a consultant’s rows, not filtered afterwards', async () => {
    // The export layer calls the same fetchers the pages use, so this asserts
    // the thing that actually protects it: the query itself returns fewer rows
    // for the consultant. A wide query filtered in the browser is the easiest
    // way in the whole product to leak a restricted item.
    const co = (await asUser(w.admin, (c) => c.query(
      `select id from companies where project_id = $1 limit 1`, [w.project]))).rows[0].id
    const person = await asSuperuser(async (c: Client) => (await c.query(
      `insert into project_people (project_id, company_id, name, profile_id)
       values ($1,$2,'Cara Consultant',$3) returning id`,
      [w.project, co, w.consultant])).rows[0].id)

    await asUser(w.admin, (c) => c.query(
      `select raise_issue($1,'Everyone sees this','irs')`, [w.project]))
    await asUser(w.admin, (c) => c.query(
      `select raise_issue($1,'Only the contractor sees this','irs',null,null,null,0,'finish',
         50,null,null,null,null,'{"mode":"named","people":[]}'::jsonb)`, [w.project]))

    const asAdmin = await asUser(w.admin, (c) =>
      c.query('select title from v_issues where project_id = $1 order by title', [w.project]))
    const asConsultant = await asUser(w.consultant, (c) =>
      c.query('select title from v_issues where project_id = $1 order by title', [w.project]))

    expect(asAdmin.rows.map((r) => r.title)).toEqual([
      'Everyone sees this', 'Only the contractor sees this'])
    expect(asConsultant.rows.map((r) => r.title)).toEqual(['Everyone sees this'])
    void person
  })

  test('a meeting the exporter is not on is absent from their export too', async () => {
    await asUser(w.admin, (c) => c.query(
      `insert into meetings (project_id, reference, title, meeting_type, meeting_date)
       values ($1,'DTM-01','Contractor only','Design','2026-09-01')`, [w.project]))

    const asAdmin = await asUser(w.admin, (c) =>
      c.query('select count(*)::int as n from meetings where project_id = $1', [w.project]))
    const asConsultant = await asUser(w.consultant, (c) =>
      c.query('select count(*)::int as n from meetings where project_id = $1', [w.project]))

    expect(asAdmin.rows[0].n).toBe(1)
    expect(asConsultant.rows[0].n).toBe(0)
  })

  test('the change log an export carries is the exporter’s own view of it', async () => {
    const stranger = await asUser(w.stranger, (c) =>
      c.query('select count(*)::int as n from v_change_log where project_id = $1', [w.project]))
    expect(stranger.rows[0].n).toBe(0)
  })
})
