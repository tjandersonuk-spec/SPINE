import { useState } from 'react'
import { useOutletContext, useParams } from 'react-router'

import { Empty, ErrorNote } from '@/components/ui/notes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Panel, PageHead } from '@/components/ui/panel'
import { Select } from '@/components/ui/select-native'
import {
  ACCOUNT_ROLES, inviteToProject, removeFromProject, requestMembership,
} from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

/**
 * Who can open this project. Distinct from the Directory, which names people
 * whether or not they hold a login — a consultant's technician can be in the
 * directory of a job they have no access to.
 */
export default function AccessPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [personName, setPersonName] = useState('')
  const [role, setRole] = useState('consultant')
  const [projectRole, setProjectRole] = useState('member')
  const [note, setNote] = useState('')

  const act = async (fn: () => Promise<void>, message?: string) => {
    setError(null)
    setNotice(null)
    try {
      await fn()
      if (message) setNotice(message)
      ctx.reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  /**
   * Top down or bottom up. An account admin holds the commercial relationship,
   * so their invitation goes straight out. Anyone else is proposing: a new
   * member may change what the account is billed for.
   */
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (ctx.isAccountAdmin) {
      act(async () => {
        await inviteToProject(id, email, projectRole)
        setEmail('')
      }, `Invitation sent to ${email}.`)
    } else {
      act(async () => {
        await requestMembership({ projectId: id, email, role, projectRole, personName, note })
        setEmail('')
        setPersonName('')
        setNote('')
      }, 'Sent to your account admin to confirm. Nothing reaches this person until they approve.')
    }
  }

  return (
    <>
      <PageHead
        eyebrow="Admin"
        title="Project access"
        meta="Who can open this project. Naming people in the Directory is a separate thing — someone can be in the directory with no login at all."
      />
      <ErrorNote message={error} />
      {notice && <p className="text-graphite mb-3 text-sm">{notice}</p>}

      <Panel title={ctx.isAccountAdmin ? 'Give someone access' : 'Ask for someone to be added'}>
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-56 flex-1 flex-col gap-2">
              <Label htmlFor="pm-email">Email</Label>
              <Input id="pm-email" type="email" required placeholder="name@company.co.uk"
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {!ctx.isAccountAdmin && (
              <div className="flex min-w-40 flex-1 flex-col gap-2">
                <Label htmlFor="pm-name">Their name</Label>
                <Input id="pm-name" value={personName}
                  onChange={(e) => setPersonName(e.target.value)} />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            {!ctx.isAccountAdmin && (
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
            {!ctx.isAccountAdmin && (
              <div className="flex min-w-48 flex-1 flex-col gap-2">
                <Label htmlFor="pm-note">Why</Label>
                <Input id="pm-note" placeholder="Helps your admin decide"
                  value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            )}
            <Button type="submit">{ctx.isAccountAdmin ? 'Invite' : 'Send request'}</Button>
          </div>

          <p className="text-graphite-light text-xs">
            {ctx.isAccountAdmin
              ? 'An invitation goes straight out. They still accept it themselves.'
              : 'This goes to your account admin first. Adding someone can change what the account is billed for, so it is their call — nothing reaches the person named until they approve.'}
          </p>
        </form>
      </Panel>

      <Panel title={`People with access (${ctx.members.length})`}>
        {ctx.members.length === 0 ? (
          <Empty>Nobody yet.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {ctx.members.map((m) => (
              <li key={m.profile_id}
                className="border-rule flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <p className="font-medium">{m.profiles?.name}</p>
                  <p className="text-graphite text-sm">
                    {m.profiles?.email} ·{' '}
                    {m.project_role === 'project_admin' ? 'project admin' : 'member'}
                  </p>
                </div>
                {ctx.canEdit && (
                  <Button size="sm" variant="ghost"
                    onClick={() => act(() => removeFromProject(id, m.profile_id))}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}
