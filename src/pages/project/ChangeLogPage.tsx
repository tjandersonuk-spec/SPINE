import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Panel, PageHead } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { fetchChangeLog, type ChangeLogRow } from '@/lib/queries'

/** The table names as people would say them. */
const ENTITY_LABELS: Record<string, string> = {
  companies: 'Company',
  project_people: 'Person',
  drm_items: 'Matrix item',
  drawing_register: 'Drawing',
  drawing_packs: 'Pack',
  issues: 'Task or RFI',
  meetings: 'Meeting',
  evidence: 'Evidence',
  transmittals: 'Transmittal',
  programme_tasks: 'Programme line',
  bep_fields: 'BEP field',
  bep_revision_rules: 'Revision rule',
}

const fmt = (d: string) =>
  new Date(d).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })

const short = (v: string | null) =>
  v === null ? '—' : v.length > 60 ? `${v.slice(0, 59)}…` : v

export default function ChangeLogPage() {
  const { id = '' } = useParams()
  const [rows, setRows] = useState<ChangeLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [entity, setEntity] = useState('')

  const load = useCallback(() => {
    fetchChangeLog(id)
      .then((r) => { setRows(r); setError(null) })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(load, [load])

  const entities = useMemo(
    () => [...new Set(rows.map((r) => r.entity_type))].sort(), [rows])
  const visible = useMemo(
    () => (entity ? rows.filter((r) => r.entity_type === entity) : rows), [rows, entity])

  if (loading) return <div className="text-graphite p-6 text-sm">Loading…</div>

  return (
    <>
      <PageHead
        eyebrow="Admin"
        title="Change log"
        meta="Written by the database on every write, and editable by nobody — including admins."
        actions={<Button size="sm" variant="ghost" onClick={load}>Refresh</Button>}
      />

      {error && (
        <Panel kind="comply" className="mb-4">
          <p className="text-stop text-sm">{error}</p>
        </Panel>
      )}

      {rows.length === 0 ? (
        <Panel title="Nothing recorded yet">
          <p className="text-graphite max-w-prose text-sm">
            Every insert, update and delete on this project is recorded here from now on — one
            row per field that actually changed, with who changed it and when. A write that
            changes nothing records nothing, so the trail stays readable.
          </p>
        </Panel>
      ) : (
        <Panel
          title={`${visible.length} of the last ${rows.length} changes`}
          actions={
            <select
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
              className="border-rule rounded border px-2 py-1 text-sm"
              aria-label="Filter by record type"
            >
              <option value="">Everything</option>
              {entities.map((e) => (
                <option key={e} value={e}>{ENTITY_LABELS[e] ?? e}</option>
              ))}
            </select>
          }
        >
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[124px]">When</TH>
                  <TH className="w-[120px]">Who</TH>
                  <TH className="w-[120px]">Record</TH>
                  <TH className="w-[80px]">Action</TH>
                  <TH className="w-[130px]">Field</TH>
                  <TH>From → to</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((r) => (
                  <TR key={r.id}>
                    <TD><Code className="text-graphite text-xs">{fmt(r.created_at)}</Code></TD>
                    <TD>{r.actor_name ?? <span className="text-graphite">—</span>}</TD>
                    <TD className="text-graphite text-xs">
                      {ENTITY_LABELS[r.entity_type] ?? r.entity_type}
                    </TD>
                    <TD>
                      {r.action === 'insert' ? <Pill tone="ok">added</Pill>
                        : r.action === 'delete' ? <Pill tone="stop">deleted</Pill>
                        : <Pill tone="neutral">changed</Pill>}
                    </TD>
                    <TD><Code className="text-xs">{r.field ?? '—'}</Code></TD>
                    <TD className="text-sm">
                      {r.action === 'update' ? (
                        <>
                          <span className="text-graphite line-through">{short(r.value_from)}</span>
                          <span className="text-graphite mx-1.5">→</span>
                          <span>{short(r.value_to)}</span>
                        </>
                      ) : (
                        <span className="text-graphite">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        </Panel>
      )}
    </>
  )
}
