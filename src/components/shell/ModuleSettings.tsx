import { useCallback, useEffect, useState } from 'react'

import { Panel } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  fetchModuleCatalogue, setProjectModules, type ModuleEntry, type ProjectShell,
} from '@/lib/queries'

/**
 * Which modules this project has.
 *
 * The account map is what the platform owner sold; the project override sits
 * on top and can only NARROW it. An account admin may switch a module off for
 * one difficult job -- and switch it back on by clearing the override -- but
 * cannot switch on anything the account does not have. That is the platform
 * owner's to sell, and the database refuses a true in the override whatever
 * this screen offered.
 *
 * Off is absent, not dimmed: the nav entry goes and the page refuses. The data
 * underneath is untouched, because entitlements are packaging and RLS decides
 * what a person may read -- so buying a module back later shows exactly what
 * was there.
 */
export function ModuleSettings({
  projectId, shell, onChanged,
}: {
  projectId: string
  shell: ProjectShell
  onChanged: () => void
}) {
  const [catalogue, setCatalogue] = useState<ModuleEntry[]>([])
  const [override, setOverride] = useState<Record<string, boolean> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchModuleCatalogue().then(setCatalogue).catch((e: Error) => setError(e.message))
  }, [])
  useEffect(load, [load])

  // The override is the project's own map of explicit "off"s. It is rebuilt
  // from what the shell reports rather than read back, because the shell
  // already carries the merged answer and nothing else on this page needs the
  // two halves.
  const save = async (next: Record<string, boolean>) => {
    setBusy(true); setError(null)
    try {
      const cleaned = Object.fromEntries(Object.entries(next).filter(([, v]) => v === false))
      await setProjectModules(projectId, Object.keys(cleaned).length ? cleaned : null)
      setOverride(Object.keys(cleaned).length ? cleaned : null)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const groups = [...new Set(catalogue.map((m) => m.group))]
  const current = override ?? {}

  return (
    <Panel title="Modules on this project">
      {error && <p className="text-stop mb-2 text-sm">{error}</p>}
      <p className="text-graphite mb-3 max-w-prose text-sm">
        What the account has is set by the platform owner. Here you can switch a module off for
        this project alone — it leaves the sidebar and its page stops opening — and switch it
        back on. Nothing underneath is deleted: turning a module off changes what is shown, not
        what is stored.
      </p>

      {groups.map((group) => (
        <div key={group} className="mb-4">
          <h4 className="text-graphite mb-1 text-[11px] font-bold tracking-[0.06em] uppercase">
            {group}
          </h4>
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH>Module</TH>
                  <TH className="w-[110px]">Key</TH>
                  <TH className="w-[200px]">On this project</TH>
                </TR>
              </THead>
              <TBody>
                {catalogue.filter((m) => m.group === group).map((m) => {
                  const on = shell.modules[m.key] === true
                  // Off on the account means not sold. Nothing here can change
                  // that, and pretending otherwise would be a checkbox that
                  // always fails.
                  const notSold = !on && current[m.key] !== false
                  return (
                    <TR key={m.key} muted={!on}>
                      <TD>{m.label}</TD>
                      <TD><Code className="text-xs">{m.key}</Code></TD>
                      <TD>
                        {notSold ? (
                          <span className="text-graphite text-xs">
                            Not on this account
                          </span>
                        ) : (
                          <label className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={busy}
                              onChange={(e) => void save({ ...current, [m.key]: e.target.checked })}
                              aria-label={m.label}
                            />
                            {on ? 'On' : 'Off for this project'}
                          </label>
                        )}
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </TableScroll>
        </div>
      ))}

      <div className="border-rule mt-4 border-t pt-3">
        <h4 className="mb-2 text-sm font-semibold">What is never customisable</h4>
        <p className="text-graphite mb-2 max-w-prose text-sm">
          A tenant sets a name, a logo, one brand colour and light or dark. That is the whole
          customiser. These five mean the same thing on every account, and there is no setting
          for them anywhere — if “overdue” could be blue on one account, the convention that
          holds every page together would be gone.
        </p>
        <div className="flex flex-wrap gap-2">
          <Pill tone="gap">unallocated gap</Pill>
          <Pill tone="ok">done</Pill>
          <Pill tone="warn">waiting</Pill>
          <Pill tone="stop">overdue</Pill>
          <Pill tone="neutral">neutral</Pill>
        </div>
      </div>
    </Panel>
  )
}
