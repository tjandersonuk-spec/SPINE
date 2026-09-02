import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'

import { MembershipRequests } from '@/components/MembershipRequests'
import { PendingInvitations } from '@/components/PendingInvitations'
import { Shell } from '@/components/Shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  fetchMyAccountRequests, fetchMyAccounts, fetchMyInvitations, fetchMyMembershipRequests,
  fetchMyProjects, isPlatformOwner,
  type Account, type AccountRequest, type MembershipRequest, type PendingInvitation,
  type ProjectRow,
} from '@/lib/queries'

/**
 * The personal landing page. Shown to everyone who is signed in, including a
 * person holding no memberships at all — that is a supported state, not an
 * error, so both tabs render empty rather than failing.
 *
 * This is the only screen that spans accounts, and it spans only this person's
 * own memberships.
 */
export default function Landing() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [requests, setRequests] = useState<AccountRequest[]>([])
  const [invitations, setInvitations] = useState<PendingInvitation[]>([])
  const [memberRequests, setMemberRequests] = useState<MembershipRequest[]>([])
  const [owner, setOwner] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    Promise.all([
      fetchMyAccounts(),
      fetchMyProjects(),
      fetchMyAccountRequests(),
      isPlatformOwner(),
      fetchMyInvitations(),
      fetchMyMembershipRequests(),
    ])
      .then(([a, p, r, o, i, m]) => {
        setAccounts(a)
        setProjects(p)
        setRequests(r)
        setOwner(o)
        setInvitations(i)
        setMemberRequests(m)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const pending = requests.find((r) => r.status === 'pending')

  return (
    <Shell title="Spine">
      {error && <p className="text-destructive text-sm">{error}</p>}

      {/* Shown only to a platform owner. is_platform_owner() is the real guard;
          this just keeps the nav honest for everyone else. */}
      {owner && (
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/platform/accounts">Accounts</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/platform/people">People</Link>
          </Button>
        </div>
      )}

      <PendingInvitations invitations={invitations} onChange={load} />
      <MembershipRequests requests={memberRequests} onChange={load} />

      <Tabs defaultValue="projects">
        <TabsList>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="accounts">My accounts</TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="pt-4">
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : projects.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No projects yet</CardTitle>
                <CardDescription>
                  Projects appear here once you have been invited to one and accepted. An
                  invitation arrives by email.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <ul className="flex flex-col gap-2">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/project/${p.id}`}
                    className="hover:bg-accent flex items-center justify-between rounded-lg border px-4 py-3"
                  >
                    <span className="font-medium">{p.name}</span>
                    {/* the account label is resolved from this person's own
                        memberships, never from a lookup across accounts */}
                    <span className="text-muted-foreground text-sm">{p.account_name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="accounts" className="pt-4">
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : accounts.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>You are not in any account</CardTitle>
                <CardDescription>
                  {pending
                    ? `Your request for ${pending.company_name} is with us for approval. We approve accounts by hand, so you will hear from a person.`
                    : 'If your company should have an account here, ask for one. Otherwise, wait for an invitation to a project.'}
                </CardDescription>
              </CardHeader>
              {!pending && (
                <CardContent>
                  <Button asChild>
                    <Link to="/request-account">Request an account</Link>
                  </Button>
                </CardContent>
              )}
            </Card>
          ) : (
            <ul className="flex flex-col gap-2">
              {accounts.map((a) => (
                <li key={a.id}>
                  <Link
                    to={`/account/${a.id}`}
                    className="hover:bg-accent flex items-center justify-between rounded-lg border px-4 py-3"
                  >
                    <span className="font-medium">{a.name}</span>
                    <span className="text-muted-foreground text-sm">
                      {a.role}
                      {a.status !== 'active' && ` · ${a.status}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {requests.filter((r) => r.status === 'rejected').map((r) => (
            <Card key={r.id} className="mt-4">
              <CardHeader>
                <CardTitle className="text-base">
                  {r.company_name} — request declined
                </CardTitle>
                <CardDescription>{r.review_note ?? 'No reason was recorded.'}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </Shell>
  )
}
