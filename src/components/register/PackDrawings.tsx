import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  fetchPackDrawingIds, fetchRegister, setPackMembership, type Drawing, type Pack,
} from '@/lib/queries'

/**
 * What is in a pack.
 *
 * Membership is a reference to the register row, never a copy of it. Revise or
 * retitle a drawing and every pack holding it changes — a pack that snapshotted
 * revisions would be a stale document pretending to be a live one.
 */
export function PackDrawings({
  projectId, pack, onClose,
}: { projectId: string; pack: Pack; onClose: () => void }) {
  const [rows, setRows] = useState<Drawing[]>([])
  const [inPack, setInPack] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([fetchRegister(projectId), fetchPackDrawingIds(pack.id)])
      .then(([r, ids]) => { if (live) { setRows(r); setInPack(ids) } })
      .catch((e: Error) => { if (live) setError(e.message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [projectId, pack.id])

  const toggle = async (drawingId: string) => {
    const adding = !inPack.has(drawingId)
    setInPack((prev) => {
      const next = new Set(prev)
      if (adding) next.add(drawingId); else next.delete(drawingId)
      return next
    })
    try {
      await setPackMembership(pack.id, drawingId, adding)
    } catch (e) {
      setError((e as Error).message)
      setInPack((prev) => {
        const next = new Set(prev)
        if (adding) next.delete(drawingId); else next.add(drawingId)
        return next
      })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6">
      <div
        className="bg-card border-rule w-full max-w-[820px] rounded-lg border shadow-2xl"
        role="dialog"
        aria-label={`Drawings in ${pack.name}`}
      >
        <header className="border-rule flex items-center justify-between border-b px-5 py-4">
          <div>
            <Code className="text-graphite text-xs">{pack.reference}</Code>
            <h2 className="text-base font-semibold">{pack.name}</h2>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">✕</Button>
        </header>

        <div className="max-h-[64vh] overflow-y-auto px-5 py-4">
          {error && <p className="text-stop mb-3 text-sm">{error}</p>}
          {loading ? (
            <p className="text-graphite text-sm">Loading the register…</p>
          ) : rows.length === 0 ? (
            <p className="text-graphite text-sm">
              There is nothing in the register yet to put in a pack.
            </p>
          ) : (
            <TableScroll>
              <Table>
                <THead>
                  <TR>
                    <TH className="w-[38px]" aria-label="In pack" />
                    <TH className="w-[210px]">Number</TH>
                    <TH>Title</TH>
                    <TH className="w-[58px]">Rev</TH>
                    <TH className="w-[96px]">State</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((r) => (
                    <TR key={r.id}>
                      <TD>
                        <input
                          type="checkbox"
                          checked={inPack.has(r.id)}
                          onChange={() => void toggle(r.id)}
                          aria-label={`${inPack.has(r.id) ? 'Remove' : 'Add'} ${r.document_number}`}
                        />
                      </TD>
                      <TD><Code className="text-xs">{r.document_number}</Code></TD>
                      <TD>{r.title ?? <span className="text-graphite">—</span>}</TD>
                      <TD><Code className="text-xs">{r.revision ?? '—'}</Code></TD>
                      <TD>
                        {r.awaited ? <Pill tone="warn">Awaited</Pill> : <Pill tone="ok">In</Pill>}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableScroll>
          )}
          <p className="text-graphite mt-3 max-w-prose text-xs">
            A pack holds references. Revising or retitling a drawing shows through here and on
            every other pack containing it. Issuing the pack freezes each drawing at the revision
            it stands at that moment.
          </p>
        </div>

        <footer className="border-rule flex justify-end border-t px-5 py-3">
          <Button size="sm" onClick={onClose}>Done</Button>
        </footer>
      </div>
    </div>
  )
}
