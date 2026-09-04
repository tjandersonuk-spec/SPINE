/**
 * Every register carries a discussion, and the discussion knows what it is on.
 *
 * A discussion that can only be read ends in somebody's inbox, which is the
 * thing this product exists to replace — so the rule is that every record a
 * person can be asked about has a thread, and a remark in one becomes a task
 * that remembers which register it came from.
 *
 * That rule is invisible: a register added without a thread looks finished,
 * works, and quietly sends the conversation back to email. So it is checked
 * here rather than remembered.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

/** Every .tsx under src, as one string per file. */
function sources(): string[] {
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${d}/${e.name}`)
        : e.name.endsWith('.tsx') ? [readFileSync(`${d}/${e.name}`, 'utf8')] : [])
  return walk('src')
}

/**
 * The registers, and the entity type each one's thread is stored under.
 *
 * The entity type is also what the task's category is derived from, so it must
 * be the register's own name — `warranty`, `transmittal`, `instalment` — and
 * never something generic. Two of them are dynamic and are checked separately:
 * tracked items pass their own `kind`, which is how a task raised on a handover
 * checklist says "Handover checklist" rather than "checklist".
 */
const REGISTERS = [
  'issue', 'meeting', 'drawing', 'drm_item',
  'risk', 'changereq', 'material', 'warranty',
  'fee', 'invoice', 'instalment', 'pack', 'transmittal',
  'company', 'bep', 'occurrence',
]

describe('every register can be talked about', () => {
  const src = sources().join('\n')

  test('each one mounts a thread under its own name', () => {
    const missing = REGISTERS.filter((k) => !src.includes(`entityType="${k}"`))
    expect(missing, `registers with no discussion: ${missing.join(', ')}`).toEqual([])
  })

  test('tracked items pass their kind rather than a generic label', () => {
    // `checklist` as an entity type would give four registers one category and
    // make the task list's filter useless for all of them.
    const tracked = readFileSync('src/components/tracked/TrackedList.tsx', 'utf8')
    expect(tracked).toMatch(/entityType=\{kind\}/)
    expect(tracked).not.toMatch(/entityType="checklist"/)
  })

  test('the category function knows every entity type the client uses', () => {
    // The category is written by the raise and read by the task list's filter.
    // An entity type SQL does not name still gets a category — it falls
    // through to a title-cased version of itself — but a register whose label
    // was never decided reads as an oversight, because it is one.
    const dir = 'supabase/migrations'
    const file = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
      .filter((f) => readFileSync(`${dir}/${f}`, 'utf8').includes('function discussion_category'))
      .pop()
    expect(file, 'no migration defines discussion_category()').toBeTruthy()
    const sql = readFileSync(`${dir}/${file}`, 'utf8')
    const named = new Set(
      [...sql.matchAll(/when '([a-z_]+)'\s+then/g)].map((m) => m[1]))
    const unnamed = REGISTERS.filter((k) => !named.has(k))
    expect(unnamed, `entity types with no category label: ${unnamed.join(', ')}`).toEqual([])
  })
})

describe('raising is offered before the remark is posted', () => {
  const thread = readFileSync('src/components/issues/CommentThread.tsx', 'utf8')

  test('the composer offers it, not only a posted comment', () => {
    // Deciding to raise after the fact means re-reading what you wrote and
    // deciding again. The title, the owner and the date are settled while the
    // person is still thinking about the thing they just typed.
    const composer = thread.slice(thread.indexOf('<form'))
    expect(composer).toMatch(/Raise as a task/)
    expect(composer).toMatch(/Raise as an RFI/)
  })

  test('it opens the issues tab’s own form, not a second one', () => {
    // A thinner "raise from a discussion" form drifts from the real one within
    // a phase, and then two paths to the same record ask for different things.
    expect(thread).toMatch(/import \{ RaiseIssue \}/)
    expect(thread).toMatch(/<RaiseIssue/)
  })

  test('the remark and the task are one write', () => {
    const form = readFileSync('src/components/issues/RaiseIssue.tsx', 'utf8')
    expect(form).toMatch(/discussAndRaise\(/)
  })
})
