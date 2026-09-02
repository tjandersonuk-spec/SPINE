import { useEffect, useState } from 'react'
import { Link, NavLink, useParams } from 'react-router'

import { BrandMark } from '@/components/BrandMark'
import { PROJECT_NAV } from '@/components/shell/nav'
import { supabase } from '@/lib/supabase'
import { fetchDrmGaps, fetchMyProjects, type ProjectRow } from '@/lib/queries'
import { cn } from '@/lib/utils'

/**
 * The project shell: top bar, lifecycle sidebar, page.
 *
 * The sidebar is the navigator — each entry is a page, not a tab — because the
 * lifecycle is the thing a design manager is moving through, and a row of tabs
 * cannot express Pre-construction → Set up → Design → Compliance → Handover.
 *
 * Two details carry meaning rather than decoration. The active item is marked
 * with a hi-vis left rule, which is the one place that colour appears outside a
 * gap and is defensible because it is the same idea — this is the thing to look
 * at. And the matrix carries its gap count as a hi-vis badge, so the number is
 * visible from every page without opening it.
 */
function GroupTitle({
  title,
  open,
  pinned,
  onClick,
}: {
  title: string
  open: boolean
  pinned?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={pinned ? undefined : onClick}
      className={cn(
        'flex w-full items-center gap-2 px-4 pt-3.5 pb-1.5 text-left',
        'text-[10px] font-bold tracking-[0.13em] uppercase',
        'text-brand-canvas-ink transition-opacity',
        pinned ? 'cursor-default opacity-50' : 'cursor-pointer opacity-60 hover:opacity-90'
      )}
    >
      {title}
      {!pinned && (
        <span
          className={cn('ml-auto text-[9px] transition-transform', !open && '-rotate-90')}
          aria-hidden
        >
          ▾
        </span>
      )}
    </button>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { id = '' } = useParams()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [gaps, setGaps] = useState<number | null>(null)
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const [dark, setDark] = useState(false)

  useEffect(() => {
    fetchMyProjects().then(setProjects).catch(() => setProjects([]))
  }, [])

  useEffect(() => {
    if (!id) return
    fetchDrmGaps(id).then((g) => setGaps(g.length)).catch(() => setGaps(null))
  }, [id])

  const project = projects.find((p) => p.id === id)

  return (
    <div className="min-h-svh">
      <header
        className="sticky top-0 z-40 flex h-12 items-center gap-4 border-b border-white/10 px-4 text-white backdrop-blur-lg"
        style={{ background: 'rgba(20,24,27,.82)' }}
      >
        <Link to="/" className="flex items-center gap-2 text-[13px] font-bold tracking-[0.16em]">
          SPINE<span className="text-hivis">·</span>DMP
        </Link>

        <span className="h-5 w-px bg-white/15" />

        {/* The project switcher. A design manager runs four jobs at once. */}
        <select
          value={id}
          onChange={(e) => {
            window.location.href = `/project/${e.target.value}/directory`
          }}
          className="max-w-[280px] rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-white"
          aria-label="Project"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id} className="text-foreground">
              {p.name} — {p.account_name}
            </option>
          ))}
        </select>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => {
            document.documentElement.classList.toggle('dark', !dark)
            setDark(!dark)
          }}
          className="rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-xs hover:bg-white/15"
        >
          {dark ? 'Light' : 'Dark'}
        </button>
        <Link to="/me" className="rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-xs hover:bg-white/15">
          Your details
        </Link>
        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-xs hover:bg-white/15"
        >
          Sign out
        </button>
      </header>

      <div className="flex min-h-[calc(100svh-3rem)]">
        <nav
          className="sticky top-12 hidden h-[calc(100svh-3rem)] w-[214px] shrink-0 overflow-y-auto pt-2.5 pb-5 text-white md:block"
          style={{
            background: 'var(--grad-brand)',
            boxShadow: '2px 0 24px -8px rgba(15,23,42,.18)',
          }}
        >
          <div className="flex items-center gap-2 px-4 pt-1 pb-2.5">
            <BrandMark className="max-h-7 w-auto" />
          </div>
          <div className="mx-4 h-px bg-white/12" />

          {PROJECT_NAV.map((group) => {
            const open = !closed[group.title]
            return (
              <div key={group.title}>
                <GroupTitle
                  title={group.title}
                  open={open}
                  pinned={group.pinned}
                  onClick={() => setClosed({ ...closed, [group.title]: open })}
                />
                {open &&
                  group.items.map((item) =>
                    item.to ? (
                      <NavLink
                        key={item.key}
                        to={`/project/${id}/${item.to}`}
                        className={({ isActive }) =>
                          cn(
                            'mx-2 my-px flex items-center gap-2.5 rounded-md border-l-[3px] px-2 py-1.5 text-[13px]',
                            'transition-colors',
                            isActive
                              ? 'border-l-hivis bg-white/16 font-semibold opacity-100'
                              : 'border-l-transparent opacity-[0.88] hover:bg-white/10 hover:opacity-100'
                          )
                        }
                      >
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.key === 'drm' && gaps !== null && gaps > 0 && (
                          <span
                            className="bg-hivis rounded-full border border-[var(--hivis)] px-1.5 font-mono text-[10px] font-bold text-[#3d3006]"
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
                        className="mx-2 my-px flex cursor-default items-center gap-2.5 rounded-md border-l-[3px] border-l-transparent px-2 py-1.5 text-[13px] opacity-35"
                      >
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      </span>
                    )
                  )}
              </div>
            )
          })}
        </nav>

        <main className="min-w-0 max-w-[1500px] flex-1 px-5 pt-5 pb-16">
          {project && (
            <p className="text-graphite-light mb-1 text-[10px] font-bold tracking-[0.13em] uppercase">
              {project.account_name}
            </p>
          )}
          {children}
        </main>
      </div>
    </div>
  )
}
