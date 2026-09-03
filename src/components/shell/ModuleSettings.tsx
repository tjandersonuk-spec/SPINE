import { useCallback, useEffect, useState } from 'react'

import { Panel } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { fetchModuleKeys, setProjectModules, type ProjectShell } from '@/lib/queries'

/**
 * Which modules this project has.
 *
 * The account map is the default and the project override sits on top of it,
 * so a module can be turned off for one difficult job without changing what
 * every other project gets. Switching one off removes its nav entry and its
 * page refuses — the database refuses the data either way, so this is the
 * commercial decision rather than the enforcement.
 */
const GROUPS: Record<string, string[]> = {
  'Pre-construction': ['preassessment', 'precon', 'client'],
  'Set up': ['directory', 'drm', 'scope', 'bep', 'programme'],
  Design: ['docs', 'tx', 'materials', 'crs'],
  Compliance: ['planning', 'bc', 'bsa', 'breeam', 'highways', 'utilities'],
  Commercial: ['fees', 'budget', 'risk', 'warranties'],
  Handover: ['handover', 'gateways', 'reports', 'audit'],
}

const LABELS: Record<string, string> = {
  preassessment: 'Pre-assessment', precon: 'Fee budget', client: 'Client requirements',
  directory: 'Directory', drm: 'Responsibility matrix', scope: 'Scope of service',
  bep: 'BEP', programme: 'Programme',
  docs: 'Drawing register', tx: 'Packs and transmittals', materials: 'Material samples',
  crs: 'Change requests',
  planning: 'Planning conditions', bc: 'Building control', bsa: 'Building safety',
  breeam: 'BREEAM', highways: 'Highways', utilities: 'Utilities',
  fees: 'Fees and cashflow', budget: 'Pre-construction budget', risk: 'Risk register',
  warranties: 'Warranties',
  handover: 'Handover', gateways: 'Gateways', reports: 'Reports', audit: 'Audit',
}

export function ModuleSettings({
  projectId, shell, onChanged,
}: {
  projectId: string
  shell: ProjectShell
  onChanged: () => void
}) {
  const [keys, setKeys] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchModuleKeys().then(setKeys).catch((e: Error) => setError(e.message))
  }, [])

  useEffect(load, [load])

  const toggle = async (key: string, on: boolean) => {
    setBusy(true); setError(null)
    try {
      await setProjectModules(projectId, { ...shell.modules, [key]: on })
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Modules on this project">
      {error && <p className="text-stop mb-2 text-sm">{error}</p>}
      <p className="text-graphite mb-3 max-w-prose text-sm">
        Switching a module off removes it from the sidebar and its page stops opening. The data
        behind it is refused by the database as well, so this is not a matter of hiding a link.
      </p>

      {Object.entries(GROUPS).map(([group, groupKeys]) => (
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
                  <TH className="w-[90px]">On</TH>
                </TR>
              </THead>
              <TBody>
                {groupKeys.filter((k) => keys.includes(k)).map((k) => (
                  <TR key={k} muted={shell.modules[k] !== true}>
                    <TD>{LABELS[k] ?? k}</TD>
                    <TD><Code className="text-xs">{k}</Code></TD>
                    <TD>
                      <input
                        type="checkbox"
                        checked={shell.modules[k] === true}
                        disabled={busy}
                        onChange={(e) => void toggle(k, e.target.checked)}
                        aria-label={LABELS[k] ?? k}
                      />
                    </TD>
                  </TR>
                ))}
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
