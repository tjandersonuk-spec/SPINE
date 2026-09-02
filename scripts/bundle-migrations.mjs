/**
 * Concatenate the migrations into one file for pasting into the Supabase SQL
 * editor, for when the CLI cannot reach the database directly — a blocked
 * PostgreSQL port on a corporate network, typically.
 *
 * The migrations stay the source of truth; this is a view of them, generated on
 * demand and gitignored, so it can never drift from what it was built from.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'supabase/migrations'
const OUT = 'supabase/bundle.sql'

const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
if (files.length === 0) throw new Error(`no migrations found in ${DIR}`)

const parts = [
  '-- GENERATED FILE — do not edit, and do not commit.',
  '-- Built by `npm run db:bundle` from supabase/migrations/.',
  '-- Paste the whole of this into the Supabase SQL editor and press Run.',
  '--',
  '-- It runs as one transaction: if any statement fails, the whole thing is',
  '-- rolled back and your database is left exactly as it was. So a failure is',
  '-- safe to read, fix and re-run.',
  '',
  'begin;',
  '',
]

for (const f of files) {
  parts.push(`-- ${'='.repeat(74)}`, `-- ${f}`, `-- ${'='.repeat(74)}`, '')
  parts.push(readFileSync(join(DIR, f), 'utf8').trimEnd(), '')
}

parts.push('commit;', '')
writeFileSync(OUT, parts.join('\n'))

const lines = parts.join('\n').split('\n').length
console.log(`Wrote ${OUT} — ${files.length} migrations, ${lines} lines.`)
console.log('Open it, select all, copy, and paste into the Supabase SQL editor.')
