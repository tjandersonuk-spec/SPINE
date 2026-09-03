import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, useParams } from 'react-router'

import { BrandMark, CrystalMark } from '@/components/BrandMark'
import { AccountMenu } from '@/components/shell/AccountMenu'
import { PROJECT_NAV, WORKSPACE_NAV } from '@/components/shell/nav'
import { ProjectSwitcher } from '@/components/shell/ProjectSwitcher'
import {
  fetchDrmGaps, fetchMyAccounts, fetchMyInvitations, fetchMyMembershipRequests, fetchMyProfile,
  fetchMyProjects, isPlatformOwner,
  type Account, type ProjectRow,
} from '@/lib/queries'
import { applyTheme, currentTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

/**
 * The one shell: top bar, sidebar, page.
 *
 * Inside a project the sidebar is the lifecycle navigator -- each entry is a
 * page, not a tab, because the lifecycle is the thing a design manager is
 * moving through. Outside a project it is the person's workspace: portfolio,
 * accounts, their own details. Same chrome either way, so there is no second
 * landing page to find your way back from.
 *
 * Two details carry meaning rather than decoration. The active item is lit in
 * the brand -- a left pip and a wash that fades to nothing -- so the tenant's
 * colour is where the eye is. And the matrix carries its gap count as a hi-vis
 * badge, so the number is visible from every page without opening it; that
 * badge is the only hi-vis in the chrome, because it is the only gap.
 */
function GroupTitle({
  title, open, pinned, onClick,
}: { title: string; open: boolean; pinned?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={pinned ? undefined : onClick}
      className={cn(
        'flex w-full items-center gap-2 px-4 pt-3.5 pb-1.5 text-left',
        'text-[10px] font-bold tracking-[0.13em] uppercase',
        'text-chrome-ink font-mono transition-opacity',
        pinned ? 'cursor-default opacity-50' : 'cursor-pointer opacity-60 hover:opacity-90'
      )}
    >
      {title}
      {!pinned && (
        <span className={cn('ml-auto text-[9px] transition-transform', !open && '-rotate-90')}
          aria-hidden>▾</span>
      )}
    </button>
  )
}

export function AppShell({
  children,
  /** Which modules this project is entitled to. Outside a project nothing is
   *  gated, so the default permits everything. */
  moduleOn = () => true,
}: {
  children: React.ReactNode
  moduleOn?: (key: string) => boolean
}) {
  const { id = '' } = useParams()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [name, setName] = useState('')
  const [waiting, setWaiting] = useState(0)
  const [owner, setOwner] = useState(false)
  const [gaps, setGaps] = useState<number | null>(null)
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const [dark, setDark] = useState(() => currentTheme() === 'dark')

  // Everything the chrome needs about the person, loaded once. None of it is
  // project data: who they are, what they belong to, what awaits their answer.
  const load = useCallback(() => {
    Promise.all([
      fetchMyProjects(), fetchMyAccounts(), fetchMyProfile(), isPlatformOwner(),
      fetchMyInvitations(), fetchMyMembershipRequests(),
    ])
      .then(([p, a, me, o, inv, req]) => {
        setProjects(p); setAccounts(a); setName(me.name); setOwner(o)
        setWaiting(inv.length + req.length)
      })
      .catch(() => { /* the page's own error handling says what went wrong */ })
  }, [])

  useEffect(load, [load])

  // Only inside a project, and only rendered there -- so a stale count from
  // the last project is never shown and never needs clearing.
  useEffect(() => {
    if (!id) return
    fetchDrmGaps(id).then((g) => setGaps(g.length)).catch(() => setGaps(null))
  }, [id])

  const project = projects.find((p) => p.id === id)
  const inProject = Boolean(id)
  const groups = inProject
    ? PROJECT_NAV
    : WORKSPACE_NAV.filter((g) => g.title !== 'Platform' || owner)

  const toggleDark = () => {
    const next = !dark
    applyTheme(next ? 'dark' : 'light')
    setDark(next)
  }

  return (
    <div className="min-h-svh">
      <header className="app-header bg-chrome text-chrome-ink sticky top-0 z-40 flex h-12 items-center gap-4 border-b border-white/10 px-4 backdrop-blur-md">
        <Link
          to="/"
          className="flex items-center gap-2.5 text-[13px] font-extrabold tracking-[0.25em] text-white"
        >
          <CrystalMark className="size-5" />
          SPINE
        </Link>

        <span className="h-5 w-px bg-white/10" />

        <ProjectSwitcher
          projects={projects}
          accounts={accounts}
          currentId={id}
          onCreated={load}
        />

        <div className="flex-1" />

        <AccountMenu
          name={name}
          accounts={accounts}
          waiting={waiting}
          owner={owner}
          dark={dark}
          onToggleDark={toggleDark}
        />
      </header>

      <div className="flex min-h-[calc(100svh-3rem)]">
        <nav className="bg-chrome-side text-chrome-ink sticky top-12 hidden h-[calc(100svh-3rem)] w-[214px] shrink-0 overflow-y-auto border-r border-white/5 pt-2.5 pb-5 backdrop-blur-lg md:block">
          <div className="flex items-center gap-2 px-4 pt-1 pb-2.5">
            <BrandMark className="max-h-7 w-auto" />
          </div>
          <div className="mx-4 h-px bg-white/8" />

          {groups.map((group) => {
            const open = !closed[group.title]
            // A module the account is not entitled to is not dimmed, it is
            // absent: showing a locked door tells a consultant what their
            // client has and has not paid for, which is not theirs to know.
            const items = group.core ? group.items : group.items.filter((i) => moduleOn(i.key))
            if (items.length === 0) return null
            return (
              <div key={group.title}>
                <GroupTitle
                  title={group.title}
                  open={open}
                  pinned={group.pinned}
                  onClick={() => setClosed({ ...closed, [group.title]: open })}
                />
                {open && items.map((item) =>
                  item.to ? (
                    <NavLink
                      key={item.key}
                      // Workspace entries are absolute; project entries hang
                      // off the project.
                      to={item.to.startsWith('/') ? item.to : `/project/${id}/${item.to}`}
                      className={({ isActive }) =>
                        cn(
                          'mx-2 my-px flex items-center gap-2.5 rounded-md border-l-2 px-2 py-1.5 text-[13px]',
                          'transition-[background-color,color,border-color] duration-150',
                          isActive
                            ? 'border-l-primary from-primary/15 bg-linear-to-r to-transparent font-medium text-white'
                            : 'text-chrome-ink/80 border-l-transparent hover:bg-white/[0.05] hover:text-white'
                        )
                      }
                    >
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {inProject && item.key === 'drm' && gaps !== null && gaps > 0 && (
                        <span
                          className="bg-hivis shadow-hivis rounded-full px-1.5 font-mono text-[10px] font-bold text-black"
                          title={`${gaps} unallocated`}
                        >
                          {gaps}
                        </span>
                      )}
                    </NavLink>
                  ) : (
                    <span
                      key={item.key}
                      title="Built in a later phase"
                      className="mx-2 my-px flex cursor-default items-center gap-2.5 rounded-md border-l-2 border-l-transparent px-2 py-1.5 text-[13px] opacity-35"
                    >
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    </span>
                  ))}
              </div>
            )
          })}
        </nav>

        <main className="min-w-0 max-w-[1500px] flex-1 px-5 pt-5 pb-16">
          {project && (
            <p className="text-graphite-light mb-1 font-mono text-[10px] font-medium tracking-[0.18em] uppercase">
              {project.account_name}
            </p>
          )}
          {children}
        </main>
      </div>
    </div>
  )
}
