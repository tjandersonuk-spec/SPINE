/**
 * The nightly snapshot job.
 *
 * One row per live project in `snapshots`, which is the only stored derived
 * table in the product. It exists for trends: yesterday's overdue count cannot
 * be recomputed, because the register has moved since.
 *
 * Deployed as a Supabase Edge Function and invoked on a schedule — see
 * supabase/README.md. It calls take_daily_snapshots(), which is a security
 * definer function that `authenticated` deliberately cannot execute: a snapshot
 * somebody could take by hand is one they could take twice on a good day and
 * never on a bad one.
 *
 * The service-role key is read from the environment and NEVER reaches a
 * browser. It is the one place in this codebase that holds it, and it holds it
 * because RLS is bypassed on purpose here: the job runs with no session and
 * must see every project regardless of who last signed in.
 */
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

Deno.serve(async (req: Request) => {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json({ ok: false, error: 'Not configured' }, 500)
  }

  // Scheduled invocations carry the service-role key; a stray public request
  // must not be able to fire the job.
  const auth = req.headers.get('Authorization') ?? ''
  if (auth !== `Bearer ${SERVICE_ROLE}`) {
    return json({ ok: false, error: 'Unauthorized' }, 401)
  }

  // An explicit date lets a missed night be backfilled. take_snapshot() upserts
  // on (project, date), so a rerun replaces rather than duplicating.
  let forDate: string | null = null
  try {
    const body = await req.json()
    if (typeof body?.date === 'string') forDate = body.date
  } catch {
    // No body is the normal case for a scheduled run.
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/take_daily_snapshots`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
    body: JSON.stringify({ p_date: forDate }),
  })

  if (!res.ok) {
    return json({ ok: false, status: res.status, error: await res.text() }, 500)
  }
  const projects = await res.json()
  return json({ ok: true, date: forDate ?? new Date().toISOString().slice(0, 10), projects })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}
