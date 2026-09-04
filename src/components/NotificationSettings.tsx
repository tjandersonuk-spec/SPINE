import { useEffect, useState } from 'react'

import { ErrorNote } from '@/components/ui/notes'
import { Eyebrow, Panel } from '@/components/ui/panel'
import { Code, Pill } from '@/components/ui/table'
import { fmtDate } from '@/lib/format'
import {
  fetchMyNotifications, fetchMyWeek, fetchNotificationPreferences,
  setNotificationPreferences, type NotificationPrefs,
} from '@/lib/queries'

/**
 * What you are sent, and what was sent.
 *
 * Three switches and a pause, which is the whole of it. The interesting part
 * is the preview: the week shown here is read from the same function that
 * builds the email, so it is not an approximation of what will arrive — it is
 * the message. Somebody who does not trust an automated email can look at
 * exactly what it will say before it goes.
 *
 * There is no invitation switch. An invitation is how a person consents to
 * join an account, and one that could be muted is a consent somebody has
 * silently lost the ability to give. The page says so rather than leaving it
 * to be discovered.
 */
const SWITCHES: { key: keyof NotificationPrefs; label: string; note: string }[] = [
  { key: 'assignments', label: 'Something is assigned to me',
    note: 'A task or an RFI given to you, once, when it happens.' },
  { key: 'overdue', label: 'Something of mine is late',
    note: 'Past its date. If the programme moves and the new date is missed, that is '
        + 'a new message rather than a silence.' },
  { key: 'digest', label: 'My week, on a Monday',
    note: 'One email with what is waiting and what is late. Not sent at all in a week '
        + 'with neither.' },
]

export function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null)
  const [week, setWeek] = useState<Awaited<ReturnType<typeof fetchMyWeek>> | null>(null)
  const [sent, setSent] = useState<Awaited<ReturnType<typeof fetchMyNotifications>>>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([fetchNotificationPreferences(), fetchMyWeek(), fetchMyNotifications(20)])
      .then(([p, w, s]) => { setPrefs(p); setWeek(w); setSent(s) })
      .catch((e: Error) => setError(e.message))
  }, [])

  const save = (next: NotificationPrefs) => {
    setPrefs(next); setBusy(true); setError(null)
    setNotificationPreferences(next)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }

  if (error && !prefs) return <ErrorNote message={error} />
  if (!prefs) return null

  return (
    <>
      <Panel title="Email">
        <ErrorNote message={error} />
        <div className="flex flex-col gap-3">
          {SWITCHES.map((s) => (
            <label key={s.key} className="flex items-start gap-3">
              <input
                type="checkbox"
                className="accent-primary mt-1 size-4"
                checked={Boolean(prefs[s.key]) && !prefs.paused}
                disabled={busy || prefs.paused}
                onChange={(e) => save({ ...prefs, [s.key]: e.target.checked })}
              />
              <span>
                <span className="text-sm font-medium">{s.label}</span>
                <span className="text-graphite block text-xs">{s.note}</span>
              </span>
            </label>
          ))}

          <label className="border-glass-line flex items-start gap-3 border-t pt-3">
            <input
              type="checkbox"
              className="accent-warn mt-1 size-4"
              checked={prefs.paused}
              disabled={busy}
              onChange={(e) => save({ ...prefs, paused: e.target.checked })}
            />
            <span>
              <span className="text-sm font-medium">Pause everything</span>
              <span className="text-graphite block text-xs">
                For a holiday or a handover. Wins over the three above; nothing is lost,
                and what was waiting is still waiting when you come back.
              </span>
            </span>
          </label>
        </div>

        <p className="text-graphite mt-4 max-w-prose text-xs">
          There is no switch for invitations. An invitation is how you agree to join an
          account, so one you could mute would be a consent you had silently lost the
          ability to give. It is also the only email that reaches you before you have a
          login at all.
        </p>
      </Panel>

      <Panel title="What this week’s email would say">
        <p className="text-graphite mb-3 max-w-prose text-xs">
          Read from the same function that builds the message, so this is not an
          approximation of what will arrive — it is what will arrive.
        </p>
        {!week || (week.waiting.length === 0 && week.overdue.length === 0) ? (
          <p className="text-graphite text-sm">
            Nothing waiting and nothing late, so no email would be sent this week. A weekly
            message that is usually empty teaches people to ignore the one that is not.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Eyebrow className="mb-1.5">Waiting on you ({week.waiting.length})</Eyebrow>
              <ul className="text-sm">
                {week.waiting.slice(0, 8).map((w, i) => (
                  <li key={i} className="py-0.5">
                    <Code className="mr-2">{w.reference}</Code>
                    {w.title}
                    {w.due && <span className="text-graphite-light ml-1.5 text-xs">
                      {fmtDate(w.due)}
                    </span>}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <Eyebrow className="mb-1.5">Past its date ({week.overdue.length})</Eyebrow>
              <ul className="text-sm">
                {week.overdue.slice(0, 8).map((w, i) => (
                  <li key={i} className="py-0.5">
                    <Code className="mr-2">{w.reference}</Code>
                    {w.title}
                    <span className="text-stop-ink ml-1.5 text-xs">{fmtDate(w.due)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="What has been sent to you">
        {sent.length === 0 ? (
          <p className="text-graphite text-sm">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {sent.map((n) => (
              <li key={n.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                <Pill tone={n.failed_at ? 'stop' : n.sent_at ? 'ok' : 'neutral'}>
                  {n.failed_at ? 'failed' : n.sent_at ? 'sent' : 'queued'}
                </Pill>
                <span>{n.subject}</span>
                <span className="text-graphite-light ml-auto text-xs">
                  {fmtDate(n.sent_at ?? n.queued_at)}
                </span>
                {n.error && <span className="text-stop-ink w-full text-xs">{n.error}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="text-graphite mt-3 max-w-prose text-xs">
          Only you can read this. An account administrator cannot: the body of a digest is
          your own view of your own projects, and a mailbox somebody else can open is not
          a mailbox.
        </p>
      </Panel>
    </>
  )
}
