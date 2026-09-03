import { useState } from 'react'
import { useOutletContext, useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Panel, PageHead } from '@/components/ui/panel'
import { Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { EXPORTS, exportModuleCsv, exportProjectJson } from '@/lib/exports'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

export default function ExportsPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const code = ctx.project?.code ?? 'project'

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError(null); setNote(null)
    try {
      const n = await fn()
      setNote(typeof n === 'number'
        ? `Downloaded ${n} row${n === 1 ? '' : 's'}.`
        : 'Downloaded.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHead
        eyebrow="Admin"
        title="Exports"
        meta="Everything here contains exactly what you can see on screen, and nothing more."
      />

      {error && (
        <Panel kind="comply" className="mb-4">
          <p className="text-stop text-sm">{error}</p>
        </Panel>
      )}
      {note && (
        <Panel kind="evidence" className="mb-4">
          <p className="text-sm">{note}</p>
        </Panel>
      )}

      <Panel title="The whole project">
        <p className="text-graphite mb-3 max-w-prose text-sm">
          One JSON file with every module in it. A section you cannot see is marked as withheld
          rather than left out — an export that quietly omits something reads as “there is none
          of that”, which is a different and worse claim than “you cannot see it”.
        </p>
        <Button
          size="sm"
          disabled={busy !== null}
          onClick={() => void run('json',
            () => exportProjectJson(id, code, ctx.moduleOn))}
        >
          {busy === 'json' ? 'Assembling…' : 'Download project JSON'}
        </Button>
      </Panel>

      <Panel title="One module at a time">
        <p className="text-graphite mb-3 max-w-prose text-sm">
          CSV, for opening in a spreadsheet. Each goes through the same queries the pages use, so
          a restricted task or a meeting you are not on is absent from the file exactly as it is
          absent from the screen.
        </p>
        <TableScroll>
          <Table>
            <THead>
              <TR>
                <TH>Module</TH>
                <TH className="w-[130px]">Available</TH>
                <TH className="w-[120px]" />
              </TR>
            </THead>
            <TBody>
              {EXPORTS.map((m) => {
                const on = !m.module || ctx.moduleOn(m.module)
                return (
                  <TR key={m.key} muted={!on}>
                    <TD>{m.label}</TD>
                    <TD>
                      {on
                        ? <Pill tone="ok">Yes</Pill>
                        : <Pill tone="neutral">Module off</Pill>}
                    </TD>
                    <TD>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!on || busy !== null}
                        onClick={() => void run(m.key,
                          () => exportModuleCsv(id, code, m))}
                      >
                        {busy === m.key ? 'Exporting…' : 'CSV'}
                      </Button>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </TableScroll>
      </Panel>
    </>
  )
}
