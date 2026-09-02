import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext, useParams } from 'react-router'

import { ImportCde } from '@/components/register/ImportCde'
import { Button } from '@/components/ui/button'
import { Panel, PageHead } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  fetchRegister, hasBep, seedBep, type Drawing,
} from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'

type Filter = 'all' | 'awaited' | 'overdue' | 'noncompliant'

export default function RegisterPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const [rows, setRows] = useState<Drawing[]>([])
  const [bep, setBep] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')

  const load = useCallback(() => {
    Promise.all([fetchRegister(id), hasBep(id)])
      .then(([r, b]) => { setRows(r); setBep(b); setError(null) })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(load, [load])

  const counts = useMemo(() => ({
    all: rows.length,
    awaited: rows.filter((r) => r.awaited).length,
    overdue: rows.filter((r) => r.overdue).length,
    noncompliant: rows.filter((r) => r.naming_error).length,
  }), [rows])

  const visible = useMemo(() => rows.filter((r) =>
    filter === 'all' ? true
    : filter === 'awaited' ? r.awaited
    : filter === 'overdue' ? r.overdue
    : Boolean(r.naming_error)), [rows, filter])

  // Consultants block-allocate number ranges, so the register groups by
  // originator and sorts within the group on the number field rather than the
  // whole string.
  const grouped = useMemo(() => {
    const by = new Map<string, Drawing[]>()
    for (const r of visible) {
      const key = r.company_name ?? 'Unrecognised originator'
      by.set(key, [...(by.get(key) ?? []), r])
    }
    for (const list of by.values()) {
      list.sort((a, b) => a.sort_number.localeCompare(b.sort_number, undefined, { numeric: true }))
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [visible])

  if (loading) return <div className="text-graphite p-6 text-sm">Loading the register…</div>

  return (
    <>
      <PageHead
        eyebrow="Design"
        title="Drawing register"
        meta="What is due, what has arrived, and at which revision. The files stay in the CDE."
        actions={ctx.canEdit ? (
          <Button size="sm" onClick={() => setImporting(true)}>Import a CDE export</Button>
        ) : null}
      />

      {error && (
        <Panel kind="comply" className="mb-4">
          <p className="text-stop text-sm">{error}</p>
        </Panel>
      )}

      {bep === false && (
        <Panel title="No naming convention set up" kind="comply">
          <p className="text-graphite mb-3 max-w-prose text-sm">
            Without a BEP the register is a list of strings: nothing can say whether a number is
            compliant, which company originated it, or whether revision C02 is construction issue
            or still preliminary. Adopting the ISO 19650 UK Annex structure gives you a
            seven-field convention, the standard type codes, and the P / C / CR revision rule —
            all editable afterwards.
          </p>
          {ctx.canEdit ? (
            <Button
              size="sm"
              onClick={() => {
                seedBep(id).then(load).catch((e: Error) => setError(e.message))
              }}
            >
              Set up the naming convention
            </Button>
          ) : (
            <p className="text-graphite text-xs">
              Someone on the contractor’s team needs to set this up.
            </p>
          )}
        </Panel>
      )}

      {rows.length === 0 ? (
        <Panel title="Nothing in the register yet">
          <p className="text-graphite max-w-prose text-sm">
            Import a CDE export to see what has been issued, or add the drawings you are expecting
            so the ones that never arrive are visible. A planned drawing and a delivered one are
            the same row — keeping two lists is how something ends up on neither.
          </p>
        </Panel>
      ) : (
        <Panel
          title={`${visible.length} of ${rows.length} drawings`}
          actions={
            <div className="flex gap-1">
              {([
                ['all', 'All'], ['awaited', `Awaited (${counts.awaited})`],
                ['overdue', `Overdue (${counts.overdue})`],
                ['noncompliant', `Naming (${counts.noncompliant})`],
              ] as const).map(([k, label]) => (
                <Button
                  key={k}
                  size="sm"
                  variant={filter === k ? 'secondary' : 'ghost'}
                  onClick={() => setFilter(k)}
                >
                  {label}
                </Button>
              ))}
            </div>
          }
        >
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[210px]">Number</TH>
                  <TH>Title</TH>
                  <TH className="w-[58px]">Rev</TH>
                  <TH className="w-[130px]">Status</TH>
                  <TH className="w-[96px]">Due</TH>
                  <TH className="w-[104px]">State</TH>
                </TR>
              </THead>
              <TBody>
                {grouped.map(([company, list]) => (
                  <>
                    <TR key={company} muted>
                      <TD colSpan={6} className="bg-surface-2 text-graphite text-[11px] font-bold tracking-[0.06em] uppercase">
                        {company} · {list.length}
                      </TD>
                    </TR>
                    {list.map((r) => (
                      <TR key={r.id}>
                        <TD>
                          {r.cde_url ? (
                            <a
                              href={r.cde_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline"
                            >
                              <Code>{r.document_number}</Code>
                            </a>
                          ) : (
                            <Code>{r.document_number}</Code>
                          )}
                          {r.naming_error && (
                            <span
                              className="text-stop ml-1.5 cursor-help text-xs"
                              title={r.naming_error}
                            >
                              ⚠
                            </span>
                          )}
                          {r.has_dwg && (
                            <span className="text-graphite ml-1.5 text-[10px]">+DWG</span>
                          )}
                        </TD>
                        <TD>{r.title ?? <span className="text-graphite">—</span>}</TD>
                        <TD><Code className="text-xs">{r.revision ?? '—'}</Code></TD>
                        <TD className="text-graphite text-xs">
                          {r.construction_status ?? '—'}
                        </TD>
                        <TD>
                          <Code className="text-graphite text-xs">{fmt(r.due)}</Code>
                          {r.anchor_state === 'removed' && (
                            <span
                              className="text-stop ml-1 text-xs"
                              title="The programme line this is dated from has left the programme"
                            >
                              ⚠
                            </span>
                          )}
                        </TD>
                        <TD>
                          {r.overdue ? <Pill tone="stop">Overdue</Pill>
                            : r.awaited ? <Pill tone="warn">Awaited</Pill>
                            : <Pill tone="ok">Delivered</Pill>}
                        </TD>
                      </TR>
                    ))}
                  </>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        </Panel>
      )}

      {importing && (
        <ImportCde
          projectId={id}
          onClose={() => setImporting(false)}
          onDone={() => { setImporting(false); load() }}
        />
      )}
    </>
  )
}
