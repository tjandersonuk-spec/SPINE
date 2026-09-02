import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { acceptInvitation, declineInvitation, type PendingInvitation } from '@/lib/queries'

const describe = (i: PendingInvitation) =>
  i.scope === 'project'
    ? `${i.project_name} · ${i.project_role === 'project_admin' ? 'project admin' : 'member'}`
    : `${i.account_name} · ${i.role}`

/**
 * Waiting invitations, shown above everything else on the landing page. An
 * emailed link is not the only way in: the email may be filtered, delayed, or
 * simply older than the person's patience, and the invitation is still theirs.
 */
export function PendingInvitations({
  invitations,
  onChange,
}: {
  invitations: PendingInvitation[]
  onChange: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (invitations.length === 0) return null

  const act = async (token: string, fn: (t: string) => Promise<void>) => {
    setError(null)
    setBusy(token)
    try {
      await fn(token)
      onChange()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="font-semibold">
        {invitations.length === 1 ? 'You have an invitation' : `You have ${invitations.length} invitations`}
      </h2>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <ul className="flex flex-col gap-2">
        {invitations.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">
                {i.scope === 'project' ? 'Join a project' : 'Join an account'} — {describe(i)}
              </p>
              <p className="text-muted-foreground text-sm">
                {i.invited_by_name ? `Invited by ${i.invited_by_name}. ` : ''}
                Expires {new Date(i.expires_at).toLocaleDateString('en-GB')}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy === i.token}
                onClick={() => act(i.token, acceptInvitation)}>
                Accept
              </Button>
              <Button size="sm" variant="ghost" disabled={busy === i.token}
                onClick={() => act(i.token, declineInvitation)}>
                Decline
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
