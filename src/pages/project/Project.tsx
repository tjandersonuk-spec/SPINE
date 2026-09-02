import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'

import { Empty, ErrorNote, Shell } from '@/components/Shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import {
  fetchProjectMembers, inviteToProject, removeFromProject, type ProjectMember,
} from '@/lib/queries'

/**
 * The project shell is phase 2 onward; this is the membership half of it, which
 * phase 1 owns. A project admin staffs the project from people already in the
 * account — the database refuses an address that holds no membership, so the
 * error below is the real guard surfacing, not a client-side check.
 */
export default function Project() {
  const { id = '' } = useParams()
  const [project, setProject] = useState<{ name: string; code: string } | null>(null)
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [me, setMe] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [projectRole, setProjectRole] = useState('member')

  const load = useCallback(() => {
    Promise.all([
      supabase.from('projects').select('name, code').eq('id', id).single(),
      fetchProjectMembers(id),
      supabase.auth.getUser(),
    ])
      .then(([p, m, u]) => {
        if (p.error) throw p.error
        setProject(p.data)
        setMembers(m)
        setMe(u.data.user?.id ?? null)
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

  const canAdmin = members.some((m) => m.profile_id === me && m.project_role === 'project_admin')

  return (
    <Shell title={project?.name ?? 'Project'} back={{ to: '/', label: 'My projects' }}>
      <ErrorNote message={error} />
      <p className="text-muted-foreground font-mono text-sm">{project?.code}</p>

      <section className="flex flex-col gap-4">
        <h2 className="font-semibold">People on this project</h2>

        <form
          className="flex flex-wrap items-end gap-2 rounded-lg border p-4"
          onSubmit={(e) => {
            e.preventDefault()
            act(async () => {
              await inviteToProject(id, email, projectRole)
              setEmail('')
            })
          }}
        >
          <div className="flex min-w-56 flex-1 flex-col gap-2">
            <Label htmlFor="pm-email">Add someone from this account</Label>
            <Input id="pm-email" type="email" required placeholder="name@company.co.uk"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <select value={projectRole} onChange={(e) => setProjectRole(e.target.value)}
            className="border-input h-9 rounded-md border bg-transparent px-3 text-sm">
            <option value="member">Member</option>
            <option value="project_admin">Project admin</option>
          </select>
          <Button type="submit">Invite</Button>
          <p className="text-muted-foreground w-full text-xs">
            They must already be a member of the account. Bringing a new firm or person into the
            account is an account admin's decision.
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
                    {m.profiles?.email} · {m.project_role === 'project_admin' ? 'project admin' : 'member'}
                  </p>
                </div>
                {canAdmin && (
                  <Button size="sm" variant="ghost"
                    onClick={() => act(() => removeFromProject(id, m.profile_id))}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-muted-foreground border-t pt-4 text-sm">
        The rest of the project — directory, matrix, programme, register — is built from phase 2.
      </p>
    </Shell>
  )
}
