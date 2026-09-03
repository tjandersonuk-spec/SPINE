import { useState } from 'react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { createProject, type Account, type ProjectRow } from '@/lib/queries'

/**
 * The project switcher, top left: which project am I in.
 *
 * A design manager runs four jobs at once, so this is always present, grouped
 * by account, with the two things that sit beside "which project" -- the view
 * above all of them, and a new one. New project is offered only for accounts
 * where this person is admin; the insert policy on `projects` refuses anybody
 * else whatever the menu offered, so the offer is a courtesy, not the guard.
 */
const PORTFOLIO = '__portfolio'
const NEW = '__new'

export function ProjectSwitcher({
  projects, accounts, currentId, onCreated,
}: {
  projects: ProjectRow[]
  accounts: Account[]
  currentId: string
  onCreated: () => void
}) {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const adminAccounts = accounts.filter((a) => a.role === 'admin' && a.status === 'active')

  const byAccount = new Map<string, ProjectRow[]>()
  for (const p of projects) {
    byAccount.set(p.account_name, [...(byAccount.get(p.account_name) ?? []), p])
  }

  return (
    <>
      <select
        value={currentId || (projects.length > 1 ? PORTFOLIO : '')}
        onChange={(e) => {
          const v = e.target.value
          if (v === PORTFOLIO) navigate('/portfolio')
          else if (v === NEW) setCreating(true)
          else if (v) navigate(`/project/${v}/home`)
        }}
        className="max-w-[300px] rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-white"
        aria-label="Project"
      >
        {!currentId && projects.length <= 1 && (
          <option value="" className="text-foreground">
            {projects.length === 0 ? 'No projects yet' : 'Choose a project'}
          </option>
        )}
        {[...byAccount.entries()].map(([account, list]) => (
          <optgroup key={account} label={account} className="text-foreground">
            {list.map((p) => (
              <option key={p.id} value={p.id} className="text-foreground">
                {p.code ? `${p.code} · ` : ''}{p.name}
              </option>
            ))}
          </optgroup>
        ))}
        {(projects.length > 1 || adminAccounts.length > 0) && (
          <optgroup label="—" className="text-foreground">
            {projects.length > 1 && (
              <option value={PORTFOLIO} className="text-foreground">
                Portfolio — all {projects.length} projects
              </option>
            )}
            {adminAccounts.length > 0 && (
              <option value={NEW} className="text-foreground">New project…</option>
            )}
          </optgroup>
        )}
      </select>

      {creating && (
        <NewProject
          accounts={adminAccounts}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); onCreated(); navigate(`/project/${id}/home`) }}
        />
      )}
    </>
  )
}

function NewProject({
  accounts, onClose, onCreated,
}: {
  accounts: Account[]
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [org, setOrg] = useState(accounts[0]?.id ?? '')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const valid = org !== '' && name.trim() !== '' && code.trim() !== ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <form
        className="bg-card border-rule text-foreground w-full max-w-[460px] rounded-lg border p-5 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault()
          // Refuses empty input rather than creating a blank project.
          if (!valid) return
          setBusy(true); setError(null)
          createProject(org, name.trim(), code.trim().toUpperCase())
            .then((id) => onCreated(id))
            .catch((err: Error) => { setError(err.message); setBusy(false) })
        }}
      >
        <h2 className="mb-1 text-base font-semibold">New project</h2>
        <p className="text-graphite mb-3 text-xs">
          Only an account admin may create one — the database refuses anyone else, whatever
          this menu offered. Staff it afterwards from Project access.
        </p>
        {accounts.length > 1 && (
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium">Account</span>
            <select value={org} onChange={(e) => setOrg(e.target.value)}
              className="border-rule w-full rounded border px-2 py-2 text-sm">
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
        <div className="mb-4 flex gap-2">
          <label className="w-[120px]">
            <span className="mb-1 block text-xs font-medium">Code</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="BRK"
              className="border-rule w-full rounded border px-2 py-2 font-mono text-sm uppercase" />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="border-rule w-full rounded border px-3 py-2 text-sm" />
          </label>
        </div>
        {error && <p className="text-stop mb-3 text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" disabled={!valid || busy}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </form>
    </div>
  )
}
