import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select-native'
import {
  ACCOUNT_ROLES, approveMembershipRequest, declineMembershipRequest,
  type MembershipRequest,
} from '@/lib/queries'

/**
 * What an account admin has waiting. These came from people working on projects,
 * who know who is missing long before an admin does — but a new member may
 * change what the account is billed for, so the admin decides, and may change
 * the role on the way through.
 */
export function MembershipRequests({
  requests,
  onChange,
}: {
  requests: MembershipRequest[]
  onChange: () => void
}) {
  const [roles, setRoles] = useState<Record<string, string>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (requests.length === 0) return null

  const act = async (id: string, fn: () => Promise<void>) => {
    setError(null)
    setBusy(id)
    try {
      await fn()
      onChange()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <h2 className="font-semibold">
          {requests.length === 1
            ? 'Someone has asked you to add a person'
            : `${requests.length} requests to add people`}
        </h2>
        <p className="text-muted-foreground text-sm">
          Approving issues an invitation. They still accept it themselves.
        </p>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}

      <ul className="flex flex-col gap-4">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-col gap-3 border-t pt-3 first:border-t-0 first:pt-0">
            <div>
              <p className="font-medium">{r.person_name ?? r.email}</p>
              <p className="text-muted-foreground text-sm">
                {r.person_name ? `${r.email} · ` : ''}
                {r.account_name}
                {r.project_name && ` · for ${r.project_name}`}
                {r.requested_by_name && ` · asked by ${r.requested_by_name}`}
              </p>
              {r.note && <p className="mt-1 text-sm italic">“{r.note}”</p>}
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <Select
                value={roles[r.id] ?? r.proposed_role}
                onChange={(e) => setRoles({ ...roles, [r.id]: e.target.value })}
                aria-label="Role"
              >
                {ACCOUNT_ROLES.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
              <Button
                size="sm"
                disabled={busy === r.id}
                onClick={() =>
                  act(r.id, () =>
                    approveMembershipRequest(
                      r.id,
                      roles[r.id] ?? r.proposed_role,
                      r.proposed_project_role ?? 'member'
                    )
                  )
                }
              >
                Approve and invite
              </Button>
              <div className="flex flex-1 items-end gap-2">
                <Input
                  placeholder="Reason, shown to whoever asked"
                  value={reasons[r.id] ?? ''}
                  onChange={(e) => setReasons({ ...reasons, [r.id]: e.target.value })}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === r.id || !(reasons[r.id] ?? '').trim()}
                  onClick={() =>
                    act(r.id, () => declineMembershipRequest(r.id, reasons[r.id] ?? ''))
                  }
                >
                  Decline
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
