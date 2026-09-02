import { execFileSync } from 'node:child_process'
import { connection } from './db'

const FILES = [
  'supabase/tests/local-harness.sql',
  'supabase/migrations/0001_phase1_identity.sql',
  'supabase/migrations/0002_phase1_functions.sql',
  'supabase/migrations/0003_phase1_actions.sql',
  'supabase/migrations/0004_phase1_rls.sql',
  'supabase/tests/grants.sql',
  // after the blanket grants, so the column-level revokes are the last word
  'supabase/migrations/0005_phase1_column_grants.sql',
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
