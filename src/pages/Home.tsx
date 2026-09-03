import { useEffect, useState } from 'react'
import { Navigate } from 'react-router'

import { fetchMyProjects, type ProjectRow } from '@/lib/queries'
import AccountsPage from '@/pages/Accounts'
import Portfolio from '@/pages/Portfolio'

/**
 * Where you land.
 *
 * No projects: the accounts page, which is where an invitation waits and where
 * an account is asked for -- a confirmed login with nothing to do is a normal
 * state, not an error. One project: straight into it, because a portfolio of
 * one is a longer route to the same page. Two or more: the portfolio.
 */
export default function Home() {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchMyProjects().then(setProjects).catch((e: Error) => setError(e.message))
  }, [])

  if (error) return <p className="text-stop text-sm">{error}</p>
  if (!projects) return <p className="text-graphite text-sm">Loading…</p>
  if (projects.length === 0) return <AccountsPage />
  if (projects.length === 1) return <Navigate to={`/project/${projects[0].id}/home`} replace />
  return <Portfolio />
}
