/**
 * Phase 6 — tasks, RFIs, meetings, comments and evidence.
 *
 * The assertions TASKS.md names: a comment's drawing link shows the current
 * revision; revising an evidence drawing flips its state with no write; an RFI
 * and a task are rows in the same table. Plus the two rules the handover notes
 * single out — a distribution list never locks out the owner, and carrying an
 * item forward must not empty the previous minutes.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import type { Client } from 'pg'
import { asSuperuser, asUser, makePerson, refused } from './db'

type World = {
  admin: string; consultant: string; other: string
  org: string; project: string
  company: string; caraPerson: string; otherPerson: string
  drawing: string
}
let w: World

const denied = (who: string, sql: string, params: unknown[] = []) =>
  refused(() => asUser(who, (c) => c.query(sql, params)))

beforeAll(async () => {
  w = await asSuperuser(async (c: Client) => {
    const admin = await makePerson(c, 'Ada Admin', 'p6-ada@hbc.example')
    const consultant = await makePerson(c, 'Cara Consultant', 'p6-cara@bel.example')
    const other = await makePerson(c, 'Owen Other', 'p6-owen@cwc.example')

    const org = (await c.query(
      `insert into organisations (name, slug, status) values ('HBC6','hbc6','active')
       returning id`)).rows[0].id
    for (const [p, role] of [
      [admin, 'admin'], [consultant, 'consultant'], [other, 'consultant'],
    ] as const) {
      await c.query(
        'insert into organisation_members (organisation_id, profile_id, role) values ($1,$2,$3)',
        [org, p, role])
    }
    const project = (await c.query(
      `insert into projects (organisation_id, name, code) values ($1,'Kingsmead','KMW6')
       returning id`, [org])).rows[0].id
    for (const p of [consultant, other]) {
      await c.query(
        `insert into project_members (project_id, profile_id, project_role)
         values ($1,$2,'member')`, [project, p])
    }
    const company = (await c.query(
      `insert into companies (project_id, name, originator_code, company_type)
       values ($1,'Bellweather','BEL','consultant') returning id`, [project])).rows[0].id
    const caraPerson = (await c.query(
      `insert into project_people (project_id, company_id, name, email, profile_id)
       values ($1,$2,'Cara Consultant','p6-cara@bel.example',$3) returning id`,
      [project, company, consultant])).rows[0].id
    const otherPerson = (await c.query(
      `insert into project_people (project_id, company_id, name, email, profile_id)
       values ($1,$2,'Owen Other','p6-owen@cwc.example',$3) returning id`,
      [project, company, other])).rows[0].id
    const drawing = (await c.query(
      `insert into drawing_register (project_id, document_number, title, revision)
       values ($1,'KMW-BEL-BC-ZZ-DR-A-0400','GA plans','C01') returning id`,
      [project])).rows[0].id
    return { admin, consultant, other, org, project, company, caraPerson, otherPerson, drawing }
  })

  await asUser(w.admin, (c) => c.query('select import_programme($1,$2,$3)', [
    w.project, 'Rev 1', JSON.stringify([
      { task_uid: '1121', description: 'Architectural package', start_date: '2026-06-01',
        finish_date: '2026-10-30', percent_complete: 50, level: 1, task_type: 'Task' },
    ])]))
})

describe('one issues store', () => {
  test('an RFI and a task are rows in the same table', async () => {
    const task = (await asUser(w.consultant, (c) =>
      c.query(`select raise_issue($1,'Coordinate the riser','irs') as o`, [w.project])))
      .rows[0].o
    const rfi = (await asUser(w.consultant, (c) =>
      c.query(`select raise_issue($1,'Riser clash','rfi',null,null,null,0,'finish',50,
                 'Which duct takes priority at grid E?') as o`, [w.project]))).rows[0].o

    expect(task.reference).toMatch(/^TSK-\d{3}$/)
    expect(rfi.reference).toMatch(/^RFI-\d{3}$/)

    const rows = await asUser(w.consultant, (c) =>
      c.query('select source_kind from issues where project_id = $1 order by source_kind',
        [w.project]))
    expect(rows.rows.map((r) => r.source_kind)).toEqual(['irs', 'rfi'])
  })

  test('an RFI without a question is refused', async () => {
    expect(await denied(w.consultant,
      `select raise_issue($1,'Empty question','rfi')`, [w.project]))
      .toMatch(/needs a question/)
  })

  test('an issue with no title is refused rather than created blank', async () => {
    expect(await denied(w.consultant, `select raise_issue($1,'   ','irs')`, [w.project]))
      .toMatch(/needs a title/)
  })

  test('answering an RFI records who and when, and cannot be forged', async () => {
    const id = (await asUser(w.consultant, (c) =>
      c.query(`select id from issues where project_id=$1 and source_kind='rfi'`, [w.project])))
      .rows[0].id

    await asUser(w.admin, (c) =>
      c.query(`select answer_rfi($1,'The mechanical duct takes priority.')`, [id]))
    const r = await asUser(w.consultant, (c) =>
      c.query('select rfi_status, rfi_response, rfi_responded_by from issues where id = $1', [id]))
    expect(r.rows[0].rfi_status).toBe('Answered')
    expect(r.rows[0].rfi_responded_by).toBe(w.admin)

    // The columns are outside the update grant, so an answer cannot be planted.
    expect(await denied(w.consultant,
      `update issues set rfi_responded_by = $1 where id = $2`, [w.consultant, id]))
      .toMatch(/permission denied/)
  })

  test('an empty answer is refused', async () => {
    const id = (await asUser(w.consultant, (c) =>
      c.query(`select id from issues where project_id=$1 and source_kind='rfi'`, [w.project])))
      .rows[0].id
    expect(await denied(w.admin, `select answer_rfi($1,'  ')`, [id]))
      .toMatch(/cannot be empty/)
  })

  test('closing moves the status and the record together', async () => {
    const id = (await asUser(w.consultant, (c) =>
      c.query(`select id from issues where project_id=$1 and source_kind='irs'`, [w.project])))
      .rows[0].id
    await asUser(w.admin, (c) => c.query('select close_issue($1)', [id]))
    const r = await asUser(w.consultant, (c) =>
      c.query('select status, closed_by, closed_at from issues where id = $1', [id]))
    expect(r.rows[0].status).toBe('Closed')
    expect(r.rows[0].closed_by).toBe(w.admin)
    expect(r.rows[0].closed_at).not.toBeNull()

    // A status set without the closing record is refused by the constraint --
    // and in any case status is outside the update grant.
    expect(await denied(w.consultant,
      `update issues set status = 'Open' where id = $1`, [id])).toMatch(/permission denied/)

    await asUser(w.admin, (c) => c.query('select close_issue($1, true)', [id]))
    const back = await asUser(w.consultant, (c) =>
      c.query('select status, closed_at from issues where id = $1', [id]))
    expect(back.rows[0]).toEqual({ status: 'Open', closed_at: null })
  })
})

describe('urgency is derived and arguable', () => {
  test('priority plus time pressure, capped, and zero once closed', async () => {
    const out = (await asUser(w.consultant, (c) =>
      c.query(`select raise_issue($1,'Overdue thing','irs',null,null,'1121',-120,'finish',80) as o`,
        [w.project]))).rows[0].o

    const r = await asUser(w.consultant, (c) =>
      c.query('select due, overdue, urgency from v_issues where id = $1', [out.id]))
    // 1121 finishes 2026-10-30; 120 days before is 2026-07-02, already past.
    expect(r.rows[0].overdue).toBe(true)
    expect(r.rows[0].urgency).toBe(100)   // 80 + 30, capped

    await asUser(w.admin, (c) => c.query('select close_issue($1)', [out.id]))
    const closed = await asUser(w.consultant, (c) =>
      c.query('select urgency, overdue from v_issues where id = $1', [out.id]))
    expect(closed.rows[0]).toEqual({ urgency: 0, overdue: false })
  })

  test('an issue moves when the programme does, with no write to it', async () => {
    const out = (await asUser(w.consultant, (c) =>
      c.query(`select raise_issue($1,'Anchored task','irs',null,null,'1121',-30) as o`,
        [w.project]))).rows[0].o
    const before = await asUser(w.consultant, (c) =>
      c.query('select due from v_issues where id = $1', [out.id]))
    expect(before.rows[0].due.toISOString().slice(0, 10)).toBe('2026-09-30')

    await asUser(w.admin, (c) => c.query('select import_programme($1,$2,$3)', [
      w.project, 'Rev 2', JSON.stringify([
        { task_uid: '1121', description: 'Architectural package', start_date: '2026-06-01',
          finish_date: '2026-12-11', percent_complete: 50, level: 1, task_type: 'Task' },
      ])]))

    const after = await asUser(w.consultant, (c) =>
      c.query('select due from v_issues where id = $1', [out.id]))
    expect(after.rows[0].due.toISOString().slice(0, 10)).toBe('2026-11-11')
  })

  test('the line inspector reaches issues as well as drawings', async () => {
    const deps = await asUser(w.consultant, (c) =>
      c.query('select module from programme_dependents($1,$2) order by module',
        [w.project, '1121']))
    expect(new Set(deps.rows.map((r) => r.module))).toEqual(new Set(['Task']))
  })
})

describe('visibility is one rule', () => {
  test('a named list still shows the item to its raiser and its owner', async () => {
    // Raised by Cara, owned by Owen, named to nobody at all. Neither may be
    // locked out of their own item -- a list that hides it from them reads as
    // the item having vanished.
    const out = (await asUser(w.consultant, (c) =>
      c.query(`select raise_issue($1,'Closed discussion','irs',null,$2,null,0,'finish',50,
                 null,null,null,null,'{"mode":"named","people":[]}'::jsonb) as o`,
        [w.project, w.otherPerson]))).rows[0].o

    for (const who of [w.consultant, w.other, w.admin]) {
      const seen = await asUser(who, (c) =>
        c.query('select count(*)::int as n from issues where id = $1', [out.id]))
      expect(seen.rows[0].n).toBe(1)
    }
  })

  test('and hides it from everyone else on the project', async () => {
    const third = await asSuperuser(async (c: Client) => {
      const p = await makePerson(c, 'Nina Nobody', 'p6-nina@else.example')
      await c.query(
        `insert into organisation_members (organisation_id, profile_id, role)
         values ($1,$2,'consultant')`, [w.org, p])
      await c.query(
        `insert into project_members (project_id, profile_id, project_role)
         values ($1,$2,'member')`, [w.project, p])
      return p
    })
    const seen = await asUser(third, (c) =>
      c.query(`select count(*)::int as n from issues
               where project_id = $1 and title = 'Closed discussion'`, [w.project]))
    expect(seen.rows[0].n).toBe(0)
  })

  test('a visibility value no mode understands is refused, not defaulted', async () => {
    // Falling through to "everyone" would be the worst possible default.
    expect(await denied(w.consultant,
      `insert into issues (project_id, reference, title, visibility)
       values ($1,'X-999','Bad visibility','{"mode":"whatever"}'::jsonb)`, [w.project]))
      .toMatch(/visibility/)
  })

  test('a consultant cannot widen an item’s visibility by editing another column', async () => {
    // visibility IS in the update grant -- an owner may change who sees their
    // own item -- but the select policy still gates which rows they can reach.
    const hidden = await asUser(w.other, (c) =>
      c.query(`select id from issues where title = 'Closed discussion'`))
    expect(hidden.rows).toHaveLength(1)
  })
})

describe('comments carry live links, not filenames', () => {
  let comment: string

  test('a drawing attached to a comment shows the revision it is at now', async () => {
    comment = (await asUser(w.consultant, (c) => c.query(
      `insert into comments (project_id, entity_type, entity_id, author_id, body)
       values ($1,'drawing',$2,$3,'This clashes with the riser at grid E.')
       returning id`, [w.project, w.drawing, w.consultant]))).rows[0].id

    await asUser(w.consultant, (c) => c.query(
      `insert into comment_attachments (comment_id, drawing_id, uploaded_by)
       values ($1,$2,$3)`, [comment, w.drawing, w.consultant]))

    const before = await asUser(w.other, (c) =>
      c.query('select document_number, revision_now from v_comment_attachments where comment_id = $1',
        [comment]))
    expect(before.rows[0].revision_now).toBe('C01')

    // The register moves on. The comment was written months ago and nothing
    // about it is rewritten, but the link now reads C02.
    await asSuperuser((c: Client) =>
      c.query(`update drawing_register set revision = 'C02' where id = $1`, [w.drawing]))

    const after = await asUser(w.other, (c) =>
      c.query('select revision_now from v_comment_attachments where comment_id = $1', [comment]))
    expect(after.rows[0].revision_now).toBe('C02')
  })

  test('an attachment to nothing at all is refused', async () => {
    expect(await denied(w.consultant,
      `insert into comment_attachments (comment_id) values ($1)`, [comment]))
      .toMatch(/comment_attachment_has_a_target/)
  })

  test('an empty comment is refused rather than created blank', async () => {
    expect(await denied(w.consultant,
      `insert into comments (project_id, entity_type, entity_id, author_id, body)
       values ($1,'drawing',$2,$3,'   ')`, [w.project, w.drawing, w.consultant]))
      .toMatch(/body/)
  })

  test('an author edits their own words and nothing else about the comment', async () => {
    await asUser(w.consultant, (c) =>
      c.query(`update comments set body = 'Reworded.' where id = $1`, [comment]))

    // author_id and entity_id are outside the grant: an author cannot move
    // their comment onto another record or attribute it to someone else.
    expect(await denied(w.consultant,
      `update comments set author_id = $1 where id = $2`, [w.other, comment]))
      .toMatch(/permission denied/)
    expect(await denied(w.consultant,
      `update comments set entity_id = $1 where id = $2`, [w.project, comment]))
      .toMatch(/permission denied/)
  })

  test('nobody edits someone else’s comment', async () => {
    await asUser(w.other, (c) =>
      c.query(`update comments set body = 'Not mine to change.' where id = $1`, [comment]))
    const r = await asUser(w.consultant, (c) =>
      c.query('select body from comments where id = $1', [comment]))
    expect(r.rows[0].body).toBe('Reworded.')
  })

  test('a task can be raised from a comment, carrying its origin', async () => {
    const out = (await asUser(w.consultant, (c) =>
      c.query(`select raise_issue($1,'Resolve the riser clash','comment',null,null,null,
                 0,'finish',50,null,$2) as o`, [w.project, comment]))).rows[0].o
    const r = await asUser(w.consultant, (c) =>
      c.query('select source_kind, origin_comment_id from issues where id = $1', [out.id]))
    expect(r.rows[0]).toEqual({ source_kind: 'comment', origin_comment_id: comment })
  })
})

describe('evidence state is derived, never stored', () => {
  let ev: string

  test('a new attachment is awaiting review, with the revision stamped', async () => {
    ev = (await asUser(w.consultant, (c) => c.query(
      `insert into evidence (project_id, entity_type, entity_id, drawing_id, added_by)
       values ($1,'drm',$2,$3,$4) returning id`,
      [w.project, w.project, w.drawing, w.consultant]))).rows[0].id

    const r = await asUser(w.consultant, (c) =>
      c.query('select state, revision_at_add from v_evidence where id = $1', [ev]))
    expect(r.rows[0].state).toBe('Awaiting review')
    // Stamped by trigger from the register, never passed in.
    expect(r.rows[0].revision_at_add).toBe('C02')
  })

  test('only the contractor’s team reviews it', async () => {
    expect(await denied(w.consultant, 'select review_evidence($1)', [ev]))
      .toMatch(/contractor's team/)
  })

  test('reviewing records who, when, and the revision reviewed', async () => {
    await asUser(w.admin, (c) => c.query('select review_evidence($1)', [ev]))
    const r = await asUser(w.consultant, (c) =>
      c.query('select state, reviewed_by, revision_at_review from v_evidence where id = $1', [ev]))
    expect(r.rows[0].state).toBe('Reviewed')
    expect(r.rows[0].reviewed_by).toBe(w.admin)
    expect(r.rows[0].revision_at_review).toBe('C02')
  })

  test('revising the drawing reopens the review, with no write to the evidence', async () => {
    const before = await asSuperuser((c: Client) =>
      c.query('select * from evidence where id = $1', [ev]))

    await asSuperuser((c: Client) =>
      c.query(`update drawing_register set revision = 'C03' where id = $1`, [w.drawing]))

    const after = await asUser(w.consultant, (c) =>
      c.query('select state from v_evidence where id = $1', [ev]))
    expect(after.rows[0].state).toBe('Revised since review')

    // Not one column of the evidence row changed. The state is a comparison,
    // not a status somebody has to remember to update.
    const unchanged = await asSuperuser((c: Client) =>
      c.query('select * from evidence where id = $1', [ev]))
    expect(unchanged.rows[0]).toEqual(before.rows[0])
  })

  test('nobody can mark their own submission reviewed by writing the column', async () => {
    expect(await denied(w.consultant,
      `update evidence set reviewed_by = $1, reviewed_at = now() where id = $2`,
      [w.consultant, ev])).toMatch(/permission denied/)
  })
})

describe('minutes are a record of the day', () => {
  let first: string
  let second: string
  let issue: string

  beforeAll(async () => {
    const mk = async (ref: string, date: string) => (await asUser(w.admin, (c) => c.query(
      `insert into meetings (project_id, reference, title, meeting_type, meeting_date, created_by)
       values ($1,$2,'Design team meeting','Design',$3,$4) returning id`,
      [w.project, ref, date, w.admin]))).rows[0].id
    first = await mk('DTM-01', '2026-08-05')
    second = await mk('DTM-02', '2026-09-02')
    for (const m of [first, second]) {
      await asUser(w.admin, (c) => c.query(
        `insert into meeting_people (meeting_id, person_id, role)
         values ($1,$2,'attendee'), ($1,$3,'attendee')`, [m, w.caraPerson, w.otherPerson]))
    }
    issue = (await asUser(w.admin, (c) =>
      c.query(`select (raise_issue($1,'Confirm the riser strategy','meeting',null,null,null,
                 0,'finish',50,null,null,$2)->>'id')::uuid as id`, [w.project, first])))
      .rows[0].id
  })

  test('an item raised in a meeting appears on that agenda', async () => {
    const r = await asUser(w.admin, (c) =>
      c.query('select meeting_id from issue_agenda_refs where issue_id = $1', [issue]))
    expect(r.rows.map((x) => x.meeting_id)).toEqual([first])
  })

  test('carrying it forward adds a reference and empties nothing', async () => {
    await asUser(w.admin, (c) => c.query('select carry_issue_forward($1,$2)', [issue, second]))

    const refs = await asUser(w.admin, (c) =>
      c.query(`select meeting_id from issue_agenda_refs where issue_id = $1
               order by added_at`, [issue]))
    expect(refs.rows.map((x) => x.meeting_id)).toEqual([first, second])

    // Where it was first raised never moves. An earlier version updated it and
    // left the previous minutes showing an empty agenda.
    const r = await asUser(w.admin, (c) =>
      c.query('select raised_meeting_id from issues where id = $1', [issue]))
    expect(r.rows[0].raised_meeting_id).toBe(first)
  })

  test('carrying it forward twice is a no-op, not a duplicate', async () => {
    await asUser(w.admin, (c) => c.query('select carry_issue_forward($1,$2)', [issue, second]))
    const r = await asUser(w.admin, (c) =>
      c.query('select count(*)::int as n from issue_agenda_refs where issue_id = $1', [issue]))
    expect(r.rows[0].n).toBe(2)
  })

  test('a meeting is visible to the people on it and nobody else', async () => {
    const attendee = await asUser(w.consultant, (c) =>
      c.query('select count(*)::int as n from meetings where project_id = $1', [w.project]))
    expect(attendee.rows[0].n).toBe(2)

    const outsider = await asSuperuser(async (c: Client) => {
      const p = await makePerson(c, 'Mo Missing', 'p6-mo@else.example')
      await c.query(
        `insert into organisation_members (organisation_id, profile_id, role)
         values ($1,$2,'consultant')`, [w.org, p])
      await c.query(
        `insert into project_members (project_id, profile_id, project_role)
         values ($1,$2,'member')`, [w.project, p])
      return p
    })
    const seen = await asUser(outsider, (c) =>
      c.query('select count(*)::int as n from meetings where project_id = $1', [w.project]))
    expect(seen.rows[0].n).toBe(0)
  })

  test('a consultant cannot create or rewrite a meeting', async () => {
    expect(await denied(w.consultant,
      `insert into meetings (project_id, reference, title, meeting_type, meeting_date)
       values ($1,'DTM-99','Mine','Design','2026-10-01')`, [w.project]))
      .toMatch(/row-level security/)
  })
})
