/**
 * The scheduled sender.
 *
 * Two steps, deliberately separate. `queue_notifications()` composes every
 * message that is due and writes it to the ledger; this then posts whatever is
 * in the ledger and records the outcome. Splitting them means a provider
 * outage loses no message — the rows are already written, and the next run
 * sends them — and a message is composed exactly once however many times the
 * job runs, because every row carries a dedupe key.
 *
 * What this function does NOT do is decide what an email says. It cannot: the
 * body was built by build_digest(), which runs as the recipient with row level
 * security applied, so an email cannot contain something its addressee could
 * not load in the application. Assembling the message here, with the service
 * role and every policy bypassed, is exactly the mistake that guarantee
 * exists to prevent.
 *
 * The service-role key is read from the environment and never reaches a
 * browser. This and the nightly snapshot job are the only two places that hold
 * it. See supabase/README.md for the schedule.
 */
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
// Resend or Postmark; the body below is Resend's shape. Absent means dry run,
// which is the right default: a misconfigured job that silently sends nothing
// is better than one that silently sends to everybody.
const RESEND_KEY = Deno.env.get('RESEND_API_KEY')
const MAIL_FROM = Deno.env.get('MAIL_FROM') ?? 'Spine <no-reply@example.com>'
const APP_URL = Deno.env.get('APP_URL') ?? ''

type Notification = {
  id: string
  email: string
  kind: 'invitation' | 'assignment' | 'overdue' | 'digest'
  subject: string
  body: string
  project_id: string | null
}

const rpc = (fn: string, body: Record<string, unknown> = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE!,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
    body: JSON.stringify(body),
  })

Deno.serve(async (req: Request) => {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json({ ok: false, error: 'Not configured' }, 500)
  }
  // Scheduled invocations carry the service-role key; a stray public request
  // must not be able to mail everybody.
  const auth = authorise(req)
  if (!auth.ok) return json({ ok: false, error: 'Unauthorized', reason: auth.reason }, 401)

  let forDate: string | null = null
  try {
    const body = await req.json()
    if (typeof body?.date === 'string') forDate = body.date
  } catch {
    // No body is the normal case for a scheduled run.
  }

  const queued = await rpc('queue_notifications', { p_date: forDate })
  if (!queued.ok) return json({ ok: false, step: 'queue', error: await queued.text() }, 500)
  const counts = await queued.json()

  const pending = await rpc('pending_notifications', { p_limit: 200 })
  if (!pending.ok) return json({ ok: false, step: 'pending', error: await pending.text() }, 500)
  const rows: Notification[] = await pending.json()

  let sent = 0
  let failed = 0
  for (const n of rows) {
    // No key configured: the message stays queued rather than being marked
    // sent. A dry run that quietly consumed the queue would lose every
    // message it pretended to deliver.
    if (!RESEND_KEY) continue
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${RESEND_KEY}`,
        },
        body: JSON.stringify({
          from: MAIL_FROM,
          to: [n.email],
          subject: n.subject,
          text: render(n),
        }),
      })
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`.slice(0, 400))
      await rpc('resolve_notification', { p_id: n.id, p_error: null })
      sent += 1
    } catch (e) {
      // Recorded against the row rather than thrown away, so a failure is
      // visible and the reason survives the run that caused it.
      await rpc('resolve_notification', { p_id: n.id, p_error: String(e).slice(0, 400) })
      failed += 1
    }
  }

  return json({ ok: true, counts, pending: rows.length, sent, failed,
                dry_run: !RESEND_KEY })
})

/**
 * The body, from what the database already decided to include.
 *
 * Plain text on purpose. An email that renders the project's own information
 * into a layout is one more place the figures could be presented differently
 * from the page, and the only thing this message has to do is say what is
 * waiting and link to it.
 */
function render(n: Notification): string {
  const link = (path: string) => (APP_URL ? `\n${APP_URL}${path}\n` : '')
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(n.body)
  } catch {
    return n.body
  }

  if (n.kind === 'invitation') {
    return [
      `${data.invited_by ?? 'Somebody'} has invited you to ${data.account} on Spine.`,
      '',
      'Accept it here:',
      link(`/accept/${data.token}`).trim(),
      '',
      `The invitation expires on ${String(data.expires_at ?? '').slice(0, 10)}.`,
      '',
      'If you were not expecting this you can ignore it — nothing happens until',
      'you accept, and accepting is done from your own login.',
    ].join('\n')
  }

  if (n.kind === 'digest') {
    const waiting = (data.waiting as Record<string, unknown>[]) ?? []
    const overdue = (data.overdue as Record<string, unknown>[]) ?? []
    const line = (x: Record<string, unknown>) =>
      `  ${x.reference ?? ''} ${x.title ?? ''}${x.due ? ` — due ${String(x.due).slice(0, 10)}` : ''}`
    return [
      'Your week on Spine.',
      '',
      `Waiting on you (${waiting.length}):`,
      ...waiting.map(line),
      '',
      `Past its date (${overdue.length}):`,
      ...overdue.map(line),
      link('/'),
      '',
      'To change what you are sent, or to pause it, open your details in the app.',
    ].join('\n')
  }

  // assignment and overdue are the same shape: one record, one link.
  return [
    n.kind === 'overdue'
      ? `${data.reference} is past its date.`
      : `${data.reference} has been assigned to you.`,
    '',
    `${data.title ?? ''}`,
    `Project: ${data.project ?? ''}`,
    data.due ? `Due: ${String(data.due).slice(0, 10)}` : '',
    link(n.project_id ? `/project/${n.project_id}/issues` : '/'),
  ].join('\n')
}

/**
 * Who may run this.
 *
 * It was a string comparison against SUPABASE_SERVICE_ROLE_KEY, which is
 * brittle in two ways that cost an afternoon. A project that has moved to the
 * newer `sb_secret_…` keys injects a different value from the one you copy out
 * of the dashboard, and — far more commonly — somebody pastes the anon key,
 * which is a perfectly valid JWT, sails through Supabase's gateway, and then
 * fails here with the word "Unauthorized" and nothing else. There was no way
 * to tell those apart from the outside.
 *
 * So: accept an exact match on the injected key, which covers the new key
 * format; otherwise read the token's `role` claim. Reading it is safe because
 * the gateway has already verified the signature before the request reaches
 * this code — `verify_jwt` is on by default, and if somebody turns it off then
 * every guarantee about who is calling goes with it, not just this one.
 *
 * And the refusal says which check failed. Nothing secret is in the reason;
 * "you sent the anon key" is not a disclosure, it is the answer.
 */
function authorise(req: Request): { ok: boolean; reason?: string } {
  const header = req.headers.get('Authorization') ?? ''
  if (!header.startsWith('Bearer ')) {
    return { ok: false, reason: 'No bearer token. Send Authorization: Bearer <service_role key>.' }
  }
  const token = header.slice('Bearer '.length).trim()
  if (token === SERVICE_ROLE) return { ok: true }

  const role = jwtRole(token)
  if (role === 'service_role') return { ok: true }
  if (role) {
    return { ok: false,
             reason: `That token's role is "${role}", not service_role. The anon key is not `
                   + `enough: this job reads every project's queue.` }
  }
  return { ok: false,
           reason: 'Token is neither the service-role key nor a readable JWT. Use the '
                 + 'service_role key from Project Settings → API.' }
}

/** The `role` claim, or null. No signature check: the gateway did that. */
function jwtRole(token: string): string | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return (JSON.parse(json) as { role?: string }).role ?? null
  } catch {
    return null
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
