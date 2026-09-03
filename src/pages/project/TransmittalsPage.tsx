import { useCallback, useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router'

import { IssueTransmittal } from '@/components/register/IssueTransmittal'
import { PackDrawings } from '@/components/register/PackDrawings'
import { Button } from '@/components/ui/button'
import { Panel, PageHead } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  createPack, fetchPacks, fetchTransmittals, type Pack, type Transmittal,
} from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

const fmt = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })

export default function TransmittalsPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const [packs, setPacks] = useState<Pack[]>([])
  const [txs, setTxs] = useState<Transmittal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Pack | null>(null)
  const [naming, setNaming] = useState(false)
  const [issuing, setIssuing] = useState<Pack | null>(null)
  const [issued, setIssued] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([fetchPacks(id), fetchTransmittals(id)])
      .then(([p, t]) => { setPacks(p); setTxs(t); setError(null) })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(load, [load])

  if (loading) return <div className="text-graphite p-6 text-sm">Loading…</div>

  return (
    <>
      <PageHead
        eyebrow="Design"
        title="Packs and transmittals"
        meta="A pack is a live group of drawings. A transmittal is a frozen record of an issue."
        actions={ctx.canEdit ? (
          <Button size="sm" onClick={() => setNaming(true)}>New pack</Button>
        ) : null}
      />

      {error && (
        <Panel kind="comply" className="mb-4">
          <p className="text-stop text-sm">{error}</p>
        </Panel>
      )}

      <Panel title={`${packs.length} pack${packs.length === 1 ? '' : 's'}`}>
        {packs.length === 0 ? (
          <p className="text-graphite max-w-prose text-sm">
            A pack is a named, reusable group of drawings. It exists because the same grouping
            gets issued more than once, and rebuilding a forty-drawing selection by hand is how
            one gets left out. A pack holds references, not copies — revise a drawing and every
            pack containing it follows.
          </p>
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[70px]">Ref</TH>
                  <TH>Pack</TH>
                  <TH className="w-[80px]">Drawings</TH>
                  <TH className="w-[150px]">Since last issue</TH>
                  <TH className="w-[160px]" />
                </TR>
              </THead>
              <TBody>
                {packs.map((p) => (
                  <TR key={p.id}>
                    <TD><Code className="text-xs">{p.reference}</Code></TD>
                    <TD>
                      <div>{p.name}</div>
                      {p.purpose && (
                        <div className="text-graphite text-xs">{p.purpose}</div>
                      )}
                    </TD>
                    <TD>
                      <Code className="text-xs">{p.drawing_count}</Code>
                      {p.awaited_count > 0 && (
                        <span className="text-warn ml-1.5 text-xs">
                          {p.awaited_count} awaited
                        </span>
                      )}
                    </TD>
                    <TD>
                      {p.revised_since_issue > 0
                        ? <Pill tone="warn">{p.revised_since_issue} revised</Pill>
                        : p.never_issued === p.drawing_count
                        ? <span className="text-graphite text-xs">never issued</span>
                        : <Pill tone="ok">up to date</Pill>}
                    </TD>
                    <TD>
                      {ctx.canEdit && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                            Drawings
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setIssuing(p)}>
                            Issue
                          </Button>
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        )}
      </Panel>

      <Panel title={`${txs.length} transmittal${txs.length === 1 ? '' : 's'}`}>
        {txs.length === 0 ? (
          <p className="text-graphite max-w-prose text-sm">
            Nothing has been issued yet. A transmittal records what went out, to whom, and at
            which revision — frozen at the moment of issue and never recalculated, because a
            record that follows the register afterwards is not evidence of anything.
          </p>
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[74px]">Ref</TH>
                  <TH className="w-[96px]">Issued</TH>
                  <TH className="w-[80px]">Method</TH>
                  <TH>Reason</TH>
                  <TH className="w-[80px]">Drawings</TH>
                </TR>
              </THead>
              <TBody>
                {txs.map((t) => (
                  <TR key={t.id}>
                    <TD><Code className="text-xs">{t.reference}</Code></TD>
                    <TD><Code className="text-graphite text-xs">{fmt(t.issue_date)}</Code></TD>
                    <TD className="text-graphite text-xs">{t.method}</TD>
                    <TD>{t.reason ?? <span className="text-graphite">—</span>}</TD>
                    <TD><Code className="text-xs">{t.item_count}</Code></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
        )}
      </Panel>

      {issued && (
        <Panel kind="evidence" className="mb-4">
          <p className="text-sm">{issued}</p>
        </Panel>
      )}

      {issuing && (
        <IssueTransmittal
          projectId={id}
          pack={issuing}
          onClose={() => setIssuing(null)}
          onIssued={(ref, count) => {
            setIssuing(null)
            setIssued(`${ref} issued — ${count} drawing${count === 1 ? '' : 's'}, ` +
              'each frozen at the revision it stood at.')
            load()
          }}
        />
      )}

      {naming && (
        <NewPack
          onClose={() => setNaming(false)}
          onCreate={(name, purpose) => {
            createPack(id, name, purpose)
              .then(() => { setNaming(false); load() })
              .catch((e: Error) => setError(e.message))
          }}
        />
      )}

      {editing && (
        <PackDrawings
          projectId={id}
          pack={editing}
          onClose={() => { setEditing(null); load() }}
        />
      )}
    </>
  )
}

function NewPack({
  onClose, onCreate,
}: { onClose: () => void; onCreate: (name: string, purpose: string | null) => void }) {
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <form
        className="bg-card border-rule w-full max-w-[440px] rounded-lg border p-5 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault()
          // An Add control refuses empty input rather than creating a blank row.
          if (!name.trim()) return
          onCreate(name.trim(), purpose.trim() || null)
        }}
      >
        <h2 className="mb-3 text-base font-semibold">New pack</h2>
        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Stage 4 architectural"
            className="border-rule w-full rounded border px-3 py-2 text-sm"
          />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium">Purpose</span>
          <input
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="For construction issue"
            className="border-rule w-full rounded border px-3 py-2 text-sm"
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" disabled={!name.trim()}>Create</Button>
        </div>
      </form>
    </div>
  )
}
