/**
 * PostgREST cannot guess which foreign key an embed means when a table has more
 * than one to the same parent. It fails at run time with "more than one
 * relationship was found", which no amount of TypeScript will catch — the query
 * is a string.
 *
 * This reads the real constraint catalogue and the real client code, and fails
 * the build for any embed that would be ambiguous. It is a lint, not a
 * behaviour test, and it exists because the failure it prevents only appears
 * when a person clicks the page.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

import { asSuperuser } from './db'

const SOURCE = 'src/lib/queries.ts'

/** `.from('x').select('...')` pairs, however the call is wrapped across lines. */
function selectsInSource(src: string): { table: string; select: string }[] {
  const out: { table: string; select: string }[] = []
  const re = /\.from\(\s*'(\w+)'\s*\)\s*\.select\(\s*'([^']*)'/gs
  for (const m of src.matchAll(re)) out.push({ table: m[1], select: m[2] })
  return out
}

/** `!inner` and `!left` after a resource are PostgREST's join modifiers, not
 *  foreign key names, and mean nothing about which relationship is intended. */
const JOIN_MODIFIERS = new Set(['inner', 'left'])

/** Embedded resources inside a select string: `profiles(name)` → `profiles`,
 *  `profiles!some_fkey(name)` → `profiles` named by `some_fkey`. */
function embedsIn(select: string): { resource: string; constraint: string | null }[] {
  const out: { resource: string; constraint: string | null }[] = []
  for (const m of select.matchAll(/([A-Za-z_][\w]*)(?:!([\w]+))?\s*\(/g)) {
    const named = m[2] && !JOIN_MODIFIERS.has(m[2]) ? m[2] : null
    out.push({ resource: m[1], constraint: named })
  }
  return out
}

describe('every ambiguous embed names its foreign key', () => {
  test('no query would fail with "more than one relationship was found"', async () => {
    const ambiguous = await asSuperuser(async (c) => {
      const { rows } = await c.query(`
        select c.conrelid::regclass::text as child,
               c.confrelid::regclass::text as parent,
               array_agg(c.conname::text order by c.conname) as constraints  -- ::text, or node-pg returns name[] unparsed
        from pg_constraint c
        where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        group by c.conrelid, c.confrelid
        having count(*) > 1
      `)
      return new Map(rows.map((r) => [`${r.child}->${r.parent}`, r.constraints as string[]]))
    })

    // Every foreign key that exists, by name. A named embed that does not
    // appear here fails at run time exactly like an ambiguous one.
    const known = await asSuperuser(async (c) => {
      const { rows } = await c.query(`
        select conname::text as name from pg_constraint
        where contype = 'f' and connamespace = 'public'::regnamespace
      `)
      return new Set(rows.map((r) => r.name as string))
    })

    const src = readFileSync(SOURCE, 'utf8')
    const problems: string[] = []

    for (const { table, select } of selectsInSource(src)) {
      for (const { resource, constraint } of embedsIn(select)) {
        const key = `${table}->${resource}`

        // A constraint spelled out must be a constraint that exists. Naming the
        // key is the fix for ambiguity, so a typo in the name silently
        // reintroduces the very failure the name was added to prevent -- and
        // does it on a query that looks more careful than the one it replaced.
        if (constraint && !known.has(constraint)) {
          problems.push(
            `${SOURCE}: .from('${table}') embeds ${resource}!${constraint}(...), but no ` +
              `foreign key called ${constraint} exists. ` +
              (ambiguous.has(key)
                ? `Did you mean ${ambiguous.get(key)![0]}?`
                : `Check the constraint name against the migration that created ${table}.`)
          )
          continue
        }

        if (!ambiguous.has(key) || constraint) continue
        problems.push(
          `${SOURCE}: .from('${table}') embeds ${resource}(...) but ${table} has ` +
            `${ambiguous.get(key)!.length} foreign keys to ${resource}. ` +
            `Write it as ${resource}!${ambiguous.get(key)![0]}(...).`
        )
      }
    }

    expect(problems, problems.join('\n')).toEqual([])
  })
})
