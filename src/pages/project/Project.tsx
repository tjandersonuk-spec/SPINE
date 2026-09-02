import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'

import { Directory } from '@/components/Directory'
import { Matrix } from '@/components/Matrix'
import { Empty, ErrorNote, Shell } from '@/components/Shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select-native'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { supabase } from '@/lib/supabase'
import {
  ACCOUNT_ROLES, fetchMyAccounts, fetchProjectMembers, inviteToProject, removeFromProject,
  requestMembership, updateProject, type ProjectMember,
} from '@/lib/queries'

type Project = { name: string; code: string; organisation_id: string }

export default function ProjectPage() {
  const { id = '' } = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [me, setMe] = useState<string | null>(null)
  const [accountRole, setAccountRole] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [personName, setPersonName] = useState('')
  const [role, setRole] = useState('consultant')
  const [projectRole, setProjectRole] = useState('member')
  const [note, setNote] = useState('')
  const [editName, setEditName] = useState('')
  const [editCode, setEditCode] = useState('')

  const load = useCallback(() => {
    Promise.all([
      supabase.from('projects').select('name, code, organisation_id').eq('id', id).single(),
      fetchProjectMembers(id),
      supabase.auth.getUser(),
      fetchMyAccounts(),
    ])
      .then(([p, m, u, accounts]) => {
        if (p.error) throw p.error
        setProject(p.data)
        setEditName(p.data.name)
        setEditCode(p.data.code)
        setMembers(m)
        setMe(u.data.user?.id ?? null)
        setAccountRole(accounts.find((a) => a.id === p.data.organisation_id)?.role ?? null)
      })
      .catch((e: Error) => setError(e.message))
  }, [id])

  useEffect(load, [load])

  const act = async (fn: () => Promise<void>, message?: string) => {
    setError(null)
    setNotice(null)
    try {
      await fn()
      if (message) setNotice(message)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const isAccountAdmin = accountRole === 'admin'
  const isProjectAdmin = members.some((m) => m.profile_id === me && m.project_role === 'project_admin')
  const canEdit = isAccountAdmin || isProjectAdmin

  /**
   * Top down or bottom up. An account admin holds the commercial relationship,
   * so their invitation goes straight out. Anyone else is proposing: a new
   * member may change what the account is billed for, so it goes to the admins
   * to confirm before anything reaches the person named.
   */
  const submitPerson = (e: React.FormEvent) => {
    e.preventDefault()
    if (isAccountAdmin) {
      act(async () => {
        await inviteToProject(id, email, projectRole)
        setEmail('')
      }, `Invitation sent to ${email}.`)
    } else {
      act(async () => {
        await requestMembership({
          projectId: id, email, role, projectRole, personName, note,
        })
        setEmail('')
        setPersonName('')
        setNote('')
      }, 'Sent to your account admin to confirm. Nothing reaches this person until they approve.')
    }
  }

  return (
    <Shell title={project?.name ?? 'Project'} back={{ to: '/', label: 'My projects' }}>
      <ErrorNote message={error} />
      {notice && <p className="text-muted-foreground text-sm">{notice}</p>}
      <p className="text-muted-foreground font-mono text-sm">{project?.code}</p>

      <Tabs defaultValue="directory">
        <TabsList>
          <TabsTrigger value="directory">Directory</TabsTrigger>
          <TabsTrigger value="matrix">Responsibility matrix</TabsTrigger>
          <TabsTrigger value="people">Access ({members.length})</TabsTrigger>
          {canEdit && <TabsTrigger value="settings">Settings</TabsTrigger>}
        </TabsList>

        <TabsContent value="directory" className="pt-4">
          {project && (
            <Directory
              projectId={id}
              organisationId={project.organisation_id}
              canEdit={canEdit}
            />
          )}
        </TabsContent>

        <TabsContent value="matrix" className="pt-4">
          <Matrix projectId={id} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="people" className="flex flex-col gap-4 pt-4">
          <form className="flex flex-col gap-3 rounded-lg border p-4" onSubmit={submitPerson}>
            <h2 className="font-semibold">
              {isAccountAdmin ? 'Give someone access to this project' : 'Ask for someone to be added'}
            </h2>
            <p className="text-muted-foreground text-sm">
              This is about logins — who can open this project. Naming people in the directory is
              on the Directory tab and is a separate thing: a person can be in the directory with
              no login at all.
            </p>

            <div className="flex flex-wrap items-end gap-2">
              <div className="flex min-w-56 flex-1 flex-col gap-2">
                <Label htmlFor="pm-email">Email</Label>
                <Input id="pm-email" type="email" required placeholder="name@company.co.uk"
                  value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              {!isAccountAdmin && (
                <div className="flex min-w-40 flex-1 flex-col gap-2">
                  <Label htmlFor="pm-name">Their name</Label>
                  <Input id="pm-name" value={personName}
                    onChange={(e) => setPersonName(e.target.value)} />
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-2">
              {!isAccountAdmin && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="pm-role">Role on the account</Label>
                  <Select id="pm-role" value={role} onChange={(e) => setRole(e.target.value)}>
                    {ACCOUNT_ROLES.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </Select>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="pm-project-role">Role on this project</Label>
                <Select id="pm-project-role" value={projectRole}
                  onChange={(e) => setProjectRole(e.target.value)}>
                  <option value="member">Member</option>
                  <option value="project_admin">Project admin</option>
                </Select>
              </div>
              {!isAccountAdmin && (
                <div className="flex min-w-48 flex-1 flex-col gap-2">
                  <Label htmlFor="pm-note">Why</Label>
                  <Input id="pm-note" placeholder="Helps your admin decide"
                    value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
              )}
              <Button type="submit">{isAccountAdmin ? 'Invite' : 'Send request'}</Button>
            </div>

            <p className="text-muted-foreground text-xs">
              {isAccountAdmin
                ? 'An invitation goes straight out. They still accept it themselves.'
                : 'This goes to your account admin first. Adding someone can change what the account is billed for, so it is their call — nothing reaches the person named until they approve.'}
            </p>
          </form>

          {members.length === 0 ? (
            <Empty>Nobody on this project yet.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {members.map((m) => (
                <li key={m.profile_id}
                  className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div>
                    <p className="font-medium">{m.profiles?.name}</p>
                    <p className="text-muted-foreground text-sm">
                      {m.profiles?.email} ·{' '}
                      {m.project_role === 'project_admin' ? 'project admin' : 'member'}
                    </p>
                  </div>
                  {canEdit && (
                    <Button size="sm" variant="ghost"
                      onClick={() => act(() => removeFromProject(id, m.profile_id))}>
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {canEdit && (
          <TabsContent value="settings" className="pt-4">
            <form
              className="flex max-w-md flex-col gap-4 rounded-lg border p-4"
              onSubmit={(e) => {
                e.preventDefault()
                act(() => updateProject(id, { name: editName, code: editCode }), 'Saved.')
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="proj-name">Project name</Label>
                <Input id="proj-name" required value={editName}
                  onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="proj-code">Code</Label>
                <Input id="proj-code" required className="font-mono" value={editCode}
                  onChange={(e) => setEditCode(e.target.value)} />
              </div>
              <Button type="submit" className="self-start">Save</Button>
            </form>
          </TabsContent>
        )}
      </Tabs>

      <p className="text-muted-foreground border-t pt-4 text-sm">
        The rest of the project — directory, matrix, programme, register — is built from phase 2.
      </p>
    </Shell>
  )
}
