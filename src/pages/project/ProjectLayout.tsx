import { useCallback, useEffect, useState } from 'react'
import { Outlet, useParams } from 'react-router'

import { AppShell } from '@/components/shell/AppShell'
import {
  fetchMyAccounts, fetchProjectMembers, fetchProjectShell,
  type ProjectMember, type ProjectShell,
} from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import { applyBrand, applyTheme } from '@/lib/theme'

export type ProjectData = {
  project: { name: string; code: string; organisation_id: string } | null
  members: ProjectMember[]
  me: string | null
  accountRole: string | null
  canEdit: boolean
  isAccountAdmin: boolean
  /** Branding and entitlements, merged. Null until the shell has loaded. */
  shell: ProjectShell | null
  /** Is this module on for this project? The map from project_shell() is
   *  already resolved — every module key with an explicit answer — so this is
   *  a lookup and not a second implementation of the absent-means-on rule.
   *  An unknown key is off, which is what keeps a nav entry naming a module
   *  that does not exist from ever appearing. */
  moduleOn: (key: string) => boolean
}

/** What a page under /project/:id receives. */
export type ProjectContext = ProjectData & { reload: () => void }

/**
 * Everything under /project/:id renders inside the shell and shares this.
 * Loading it once here rather than in each page means the sidebar, the header
 * and the page all agree about who is looking and what they may do.
 */
export default function ProjectLayout() {
  const { id = '' } = useParams()
  const [data, setData] = useState<Omit<ProjectData, 'moduleOn'>>({
    project: null, members: [], me: null, accountRole: null,
    canEdit: false, isAccountAdmin: false, shell: null,
  })
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([
      supabase.from('projects').select('name, code, organisation_id').eq('id', id).single(),
      fetchProjectMembers(id),
      supabase.auth.getUser(),
      fetchMyAccounts(),
      fetchProjectShell(id),
    ])
      .then(([p, members, u, accounts, shell]) => {
        if (p.error) throw p.error
        const me = u.data.user?.id ?? null
        const accountRole = accounts.find((a) => a.id === p.data.organisation_id)?.role ?? null
        const isAccountAdmin = accountRole === 'admin'
        const isProjectAdmin = members.some(
          (m) => m.profile_id === me && m.project_role === 'project_admin'
        )
        // The tenant sets one colour; everything it drives is derived. Applied
        // before the first paint of the shell so the sidebar never flashes the
        // default brand and then correct itself.
        if (shell) {
          applyBrand(shell.brand_colour)
          applyTheme(shell.theme)
        }
        setData({
          project: p.data, members, me, accountRole, isAccountAdmin, shell,
          canEdit: isAccountAdmin || isProjectAdmin,
        })
      })
      .catch((e: Error) => setError(e.message))
  }, [id])

  useEffect(load, [load])

  return (
    <AppShell moduleOn={(key: string) => data.shell?.modules?.[key] === true}>
      {error && (
        <p className="border-stop/40 bg-stop-bg text-stop mb-4 rounded-md border px-3 py-2 text-sm">
          {error}
        </p>
      )}
      {/* reload is assembled here rather than stored in state: putting a
          callback beside the data it refreshes makes it capture itself. */}
      <Outlet
        context={{
          ...data,
          moduleOn: (key: string) => data.shell?.modules?.[key] === true,
          reload: load,
        } satisfies ProjectContext}
      />
    </AppShell>
  )
}
