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

/** Embedded resources inside a select string: `profiles(name)` → `profiles`. */
function embedsIn(select: string): { resource: string; disambiguated: boolean }[] {
  const out: { resource: string; disambiguated: boolean }[] = []
  for (const m of select.matchAll(/([A-Za-z_][\w]*)(![\w]+)?\s*\(/g)) {
    out.push({ resource: m[1], disambiguated: Boolean(m[2]) })
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

    const src = readFileSync(SOURCE, 'utf8')
    const problems: string[] = []

    for (const { table, select } of selectsInSource(src)) {
      for (const { resource, disambiguated } of embedsIn(select)) {
        const key = `${table}->${resource}`
        if (!ambiguous.has(key) || disambiguated) continue
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
