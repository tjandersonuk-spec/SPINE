import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import { Empty, ErrorNote, Shell } from '@/components/Shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  createProject, fetchAccountProjects, fetchInvitations, fetchMembers, fetchMyAccounts,
  inviteToAccount, removeMember, revokeInvitation,
  type Invitation, type Member,
} from '@/lib/queries'

/**
 * Account administration. Inviting someone here is what brings them into the
 * account at all — the decision a project admin deliberately cannot make.
 */
export default function Account() {
  const { id = '' } = useParams()
  const [name, setName] = useState('')
  const [role, setRole] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invitation[]>([])
  const [projects, setProjects] = useState<{ id: string; name: string; code: string }[]>([])
  const [error, setError] = useState<string | null>(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('consultant')
  const [projectName, setProjectName] = useState('')
  const [projectCode, setProjectCode] = useState('')

  const load = useCallback(() => {
    Promise.all([fetchMyAccounts(), fetchMembers(id), fetchInvitations(id), fetchAccountProjects(id)])
      .then(([accounts, m, i, p]) => {
        const mine = accounts.find((a) => a.id === id)
        setName(mine?.name ?? '')
        setRole(mine?.role ?? null)
        setMembers(m)
        setInvites(i)
        setProjects(p)
      })
      .catch((e: Error) => setError(e.message))
  }, [id])

  useEffect(load, [load])

  const act = async (fn: () => Promise<void>) => {
    setError(null)
    try {
      await fn()
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const isAdmin = role === 'admin'
  const open = invites.filter((i) => !i.accepted_at && !i.revoked_at)

  return (
    <Shell title={name || 'Account'} back={{ to: '/', label: 'My accounts' }}>
      <ErrorNote message={error} />
      {!isAdmin && (
        <p className="text-muted-foreground text-sm">
          You are {role ?? 'not a member'} on this account. Only an admin can invite people or
          create projects.
        </p>
      )}

      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people">People ({members.length})</TabsTrigger>
          <TabsTrigger value="invites">Invitations ({open.length})</TabsTrigger>
          <TabsTrigger value="projects">Projects ({projects.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="people" className="flex flex-col gap-4 pt-4">
          {isAdmin && (
            <form
              className="flex flex-wrap items-end gap-2 rounded-lg border p-4"
              onSubmit={(e) => {
                e.preventDefault()
                act(async () => {
                  await inviteToAccount(id, inviteEmail, inviteRole)
                  setInviteEmail('')
                })
              }}
            >
              <div className="flex min-w-56 flex-1 flex-col gap-2">
                <Label htmlFor="invite-email">Invite someone to this account</Label>
                <Input id="invite-email" type="email" required placeholder="name@company.co.uk"
                  value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
              </div>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}
                className="border-input h-9 rounded-md border bg-transparent px-3 text-sm">
                <option value="consultant">Consultant</option>
                <option value="client">Client</option>
                <option value="internal">Internal</option>
                <option value="admin">Admin</option>
              </select>
              <Button type="submit">Send invitation</Button>
            </form>
          )}

          {members.length === 0 ? (
            <Empty>No members yet.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {members.map((m) => (
                <li key={m.profile_id}
                  className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div>
                    <p className="font-medium">{m.profiles?.name}</p>
                    <p className="text-muted-foreground text-sm">{m.profiles?.email} · {m.role}</p>
                  </div>
                  {isAdmin && (
                    <Button size="sm" variant="ghost"
                      onClick={() => act(() => removeMember(id, m.profile_id))}>
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="invites" className="pt-4">
          {open.length === 0 ? (
            <Empty>Nothing outstanding. An invitation grants nothing until it is accepted.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {open.map((i) => (
                <li key={i.id} className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div>
                    <p className="font-medium">{i.email}</p>
                    <p className="text-muted-foreground text-sm">
                      {i.scope === 'project' ? `project · ${i.project_role}` : i.role} · expires{' '}
                      {new Date(i.expires_at).toLocaleDateString('en-GB')}
                    </p>
                  </div>
                  {isAdmin && (
                    <Button size="sm" variant="ghost" onClick={() => act(() => revokeInvitation(i.id))}>
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="projects" className="flex flex-col gap-4 pt-4">
          {isAdmin && (
            <form
              className="flex flex-wrap items-end gap-2 rounded-lg border p-4"
              onSubmit={(e) => {
                e.preventDefault()
                act(async () => {
                  await createProject(id, projectName, projectCode)
                  setProjectName('')
                  setProjectCode('')
                })
              }}
            >
              <div className="flex min-w-48 flex-1 flex-col gap-2">
                <Label htmlFor="p-name">New project</Label>
                <Input id="p-name" required value={projectName}
                  onChange={(e) => setProjectName(e.target.value)} />
              </div>
              <div className="flex w-32 flex-col gap-2">
                <Label htmlFor="p-code">Code</Label>
                <Input id="p-code" required value={projectCode}
                  onChange={(e) => setProjectCode(e.target.value)} />
              </div>
              <Button type="submit">Create</Button>
            </form>
          )}

          {projects.length === 0 ? (
            <Empty>No projects yet. Only an account admin can create one.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link to={`/project/${p.id}`}
                    className="hover:bg-accent flex items-center justify-between rounded-lg border px-4 py-3">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground font-mono text-sm">{p.code}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </Shell>
  )
}
