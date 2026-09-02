import { Client } from 'pg'

export const connection = {
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.PGDATABASE ?? 'spine_test',
}

/** A superuser connection. Bypasses RLS — use it only to seed. */
export async function asSuperuser<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client(connection)
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

/**
 * Run as a signed-in person, exactly as PostgREST would: the `authenticated`
 * role with the JWT subject claim set. RLS applies, because `authenticated`
 * holds no BYPASSRLS attribute.
 */
export async function asUser<T>(profileId: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client(connection)
  await c.connect()
  try {
    await c.query('set role authenticated')
    await c.query(`select set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: profileId }),
    ])
    return await fn(c)
  } finally {
    await c.end()
  }
}

/** Assert that a statement is refused, and return the message. */
export async function refused(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (e) {
    return (e as Error).message
  }
  throw new Error('expected the statement to be refused, but it succeeded')
}

/** Create an auth user and its profile. Returns the profile id. */
export async function makePerson(c: Client, name: string, email: string): Promise<string> {
  const { rows } = await c.query(
    'insert into auth.users (email) values ($1) returning id',
    [email]
  )
  const id = rows[0].id as string
  await c.query('insert into profiles (id, name, email) values ($1, $2, $3)', [id, name, email])
  return id
}
