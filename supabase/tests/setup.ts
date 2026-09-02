import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

import { connection } from './db'

/** The harness, then every migration in filename order — the same order and the
 *  same bytes the hosted project gets, so the tests cannot pass against a schema
 *  that production will not have. */
const FILES = [
  'supabase/tests/local-harness.sql',
  ...readdirSync('supabase/migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => `supabase/migrations/${f}`),
]

const base = ['-h', connection.host, '-p', String(connection.port), '-U', connection.user]

/** Rebuild the test database from the migrations before every run. */
export default function setup() {
  const psql = (args: string[]) =>
    execFileSync('psql', [...base, '-v', 'ON_ERROR_STOP=1', '-q', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

  try {
    psql(['-c', `drop database if exists ${connection.database} with (force)`, 'postgres'])
    psql(['-c', `create database ${connection.database}`, 'postgres'])
    for (const f of FILES) psql(['-f', f, connection.database])
  } catch (e) {
    const err = e as { stderr?: Buffer }
    throw new Error(
      `Could not build the test database. Is the local PostgreSQL running?\n` +
        `Start it with: npm run db:start\n\n${err.stderr?.toString() ?? String(e)}`
    )
  }
}
