import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { supabase } from '@/lib/supabase'
import {
  fetchMyAccountRequests, fetchMyAccounts, fetchMyProjects,
  type Account, type AccountRequest, type ProjectRow,
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
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([fetchMyAccounts(), fetchMyProjects(), fetchMyAccountRequests()])
      .then(([a, p, r]) => {
        setAccounts(a)
        setProjects(p)
        setRequests(r)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const pending = requests.find((r) => r.status === 'pending')

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Spine</h1>
        <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
          Sign out
        </Button>
      </header>

      {error && <p className="text-destructive text-sm">{error}</p>}

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
                <li
                  key={a.id}
                  className="flex items-center justify-between rounded-lg border px-4 py-3"
                >
                  <span className="font-medium">{a.name}</span>
                  <span className="text-muted-foreground text-sm">
                    {a.role}
                    {a.status !== 'active' && ` · ${a.status}`}
                  </span>
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
    </main>
  )
}
