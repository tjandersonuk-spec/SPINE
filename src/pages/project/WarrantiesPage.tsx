import { useCallback, useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router'

import { fmtDate } from '@/lib/format'
import { RequireModule } from '@/components/shell/RequireModule'
import { Button } from '@/components/ui/button'
import { Panel, PageHead } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { DiscussButton, DiscussRow, useDiscussion } from '@/components/issues/DiscussRow'
import {
  WARRANTY_STATUSES, addWarranty, fetchDrmItems, fetchWarranties, fetchWarrantyTotals,
  loadWarrantyLibrary, updateWarranty,
  type DrmItem, type Warranty,
} from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

/**
 * Warranties.
 *
 * The one register in the product where "who owns this" is not a stored
 * column. A warranty links to a DRM reference and its owner is resolved live
 * through whichever company holds that item's lead discipline — so reassigning
 * the matrix reassigns every warranty under it, with nothing written here.
 *
 * A warranty whose lead discipline nobody holds shows as an unallocated gap,
 * in hi-vis, because it is the same gap the matrix shows and it means the same
 * thing: nobody is chasing it.
 */
export default function WarrantiesPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const [rows, setRows] = useState<Warranty[]>([])
  const [drm, setDrm] = useState<DrmItem[]>([])
  const [totals, setTotals] = useState<{
    total: number; done: number; overdue: number
    unallocated: number; struck_out: number } | null>(null)
  const [showStruck, setShowStruck] = useState(false)
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const talk = useDiscussion()

  const load = useCallback(() => {
    Promise.all([fetchWarranties(id), fetchWarrantyTotals(id), fetchDrmItems(id)])
      .then(([r, t, d]) => { setRows(r); setTotals(t); setDrm(d); setError(null) })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(load, [load])

  const guard = (p: Promise<unknown>) =>
    p.then(load).catch((e: Error) => setError(e.message))

  const visible = showStruck ? rows : rows.filter((r) => r.required)

  if (loading) return <div className="text-graphite p-6 text-sm">Loading…</div>

  return (
    <RequireModule module="warranties">
      <PageHead
        eyebrow="Handover"
        title="Warranties"
        meta="Owned through the responsibility matrix, resolved live. Reassign a lead discipline and every warranty under it moves with it."
      />

      {error && (
        <Panel kind="comply" className="mb-4"><p className="text-stop text-sm">{error}</p></Panel>
      )}
      {note && (
        <Panel kind="evidence" className="mb-4"><p className="text-sm">{note}</p></Panel>
      )}

      <Panel
        title={totals ? `${totals.done} of ${totals.total} executed` : 'Warranties'}
        actions={
          <div className="flex gap-1">
            {totals && totals.struck_out > 0 && (
              <Button size="sm" variant={showStruck ? 'secondary' : 'ghost'}
                onClick={() => setShowStruck((v) => !v)}>
                {showStruck ? 'Hide' : 'Show'} {totals.struck_out} struck out
              </Button>
            )}
            {ctx.canEdit && (
              <>
                <Button size="sm" variant="ghost"
                  onClick={() => guard(loadWarrantyLibrary(id).then((o) =>
                    setNote(`${o.added} loaded, ${o.skipped} already here. Each is linked to a ` +
                      'DRM reference; the owner comes from the matrix rather than being ' +
                      'chosen here.')))}>
                  Load the library
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
                  Add a warranty
                </Button>
              </>
            )}
          </div>
        }
      >
        {totals && totals.unallocated > 0 && (
          <p className="border-hivis bg-hivis-bg mb-3 rounded border-l-[3px] px-3 py-2 text-sm">
            <strong>{totals.unallocated} unallocated.</strong> Nobody on this project holds the
            lead discipline for the matrix item these hang off, so nobody is chasing them.
            Fixing it is a change to the responsibility matrix, not to this page.
          </p>
        )}

        {visible.length === 0 ? (
          <p className="text-graphite max-w-prose text-sm">
            Nothing here yet. The published list is a starting point; each row links to a DRM
            reference, which is what resolves who is answerable for it.
          </p>
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[92px]">Ref</TH>
                  <TH>Warranty</TH>
                  <TH className="w-[86px]">DRM</TH>
                  <TH className="w-[160px]">Owner (live)</TH>
                  <TH className="w-[150px]">Provided by</TH>
                  <TH className="w-[64px]">Years</TH>
                  <TH className="w-[88px]">Due</TH>
                  <TH className="w-[150px]">Status</TH>
                  <TH className="w-[80px]" />
                </TR>
              </THead>
              <TBody>
                {visible.map((r) => (
                  <TR key={r.id} gap={r.unallocated} muted={!r.required}>
                    <TD><Code className={r.required ? 'text-xs' : 'text-xs line-through'}>
                      {r.reference}</Code></TD>
                    <TD>
                      <div className={r.required ? undefined : 'line-through'}>{r.title}</div>
                      {r.drm_item && (
                        <div className="text-graphite text-xs">{r.drm_item}</div>
                      )}
                    </TD>
                    <TD>
                      {r.drm_ref
                        ? <Code className="text-xs">{r.drm_ref}</Code>
                        : <span className="text-graphite text-xs">—</span>}
                      {r.lead_discipline && (
                        <Code className="text-graphite ml-1 text-xs">
                          {r.lead_discipline}
                        </Code>
                      )}
                    </TD>
                    <TD>
                      {/* Never a stored company. This is a query. */}
                      {r.holders === 0 ? (
                        <Pill tone="gap">Nobody holds it</Pill>
                      ) : r.holders === 1 ? (
                        <span className="text-sm">{r.owners[0]}</span>
                      ) : (
                        <div>
                          {r.owners.map((o) => (
                            <div key={o} className="text-sm">{o}</div>
                          ))}
                          <Pill tone="warn" className="mt-0.5">
                            {r.holders} hold {r.lead_discipline}
                          </Pill>
                        </div>
                      )}
                    </TD>
                    <TD>
                      {ctx.canEdit ? (
                        <input
                          defaultValue={r.provided_by ?? ''}
                          onBlur={(e) => {
                            if (e.target.value !== (r.provided_by ?? '')) {
                              guard(updateWarranty(r.id, {
                                provided_by: e.target.value.trim() || null }))
                            }
                          }}
                          placeholder="manufacturer"
                          aria-label={`Who provides ${r.reference}`}
                          className="border-rule w-full rounded border px-1 py-1 text-xs"
                        />
                      ) : (
                        r.provided_by ?? <span className="text-graphite text-xs">—</span>
                      )}
                    </TD>
                    <TD>
                      <Code className="text-xs">{r.period_years ?? '—'}</Code>
                    </TD>
                    <TD>
                      <Code className="text-graphite text-xs">{fmtDate(r.due)}</Code>
                      {r.overdue && <Pill tone="stop" className="mt-0.5">Overdue</Pill>}
                    </TD>
                    <TD>
                      {ctx.canEdit ? (
                        <select
                          value={r.status}
                          onChange={(e) =>
                            guard(updateWarranty(r.id, { status: e.target.value }))}
                          className="border-rule w-full rounded border px-1 py-1 text-xs"
                          aria-label={`Status of ${r.reference}`}
                        >
                          {WARRANTY_STATUSES.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      ) : (
                        <Pill tone={r.is_done ? 'ok' : 'neutral'}>{r.status}</Pill>
                      )}
                    </TD>
                    <TD>
                      {ctx.canEdit && (
                        <button type="button"
                          onClick={() =>
                            guard(updateWarranty(r.id, { required: !r.required }))}
                          className="text-graphite text-xs underline">
                          {r.required ? 'Strike out' : 'Restore'}
                        </button>
                      )}
                      <DiscussButton open={talk.isOpen(r.id)} onToggle={() => talk.toggle(r.id)} />
                    </TD>
                  </TR>
                ))}
                {visible.map((r) => talk.isOpen(r.id) && (
                  <DiscussRow key={`talk-${r.id}`} projectId={id}
                    entityType="warranty" entityId={r.id} colSpan={7} />
                ))}
              </TBody>
            </Table>
          </TableScroll>
        )}
        <p className="text-graphite mt-3 max-w-prose text-xs">
          There is no company column on a warranty and there must never be one: an owner
          stored here would go stale the moment the matrix changed. Where two firms hold the
          lead discipline both are shown — the matrix's own ambiguity, surfaced rather than
          resolved by picking one.
        </p>
      </Panel>

      {adding && (
        <AddWarranty
          drm={drm}
          onClose={() => setAdding(false)}
          onAdd={(row) => guard(addWarranty(id, row)).then(() => setAdding(false))}
        />
      )}
    </RequireModule>
  )
}

function AddWarranty({
  drm, onClose, onAdd,
}: {
  drm: DrmItem[]
  onClose: () => void
  onAdd: (row: {
    reference: string; drm_ref: string | null; title: string
    period_years: number | null; beneficiary: string | null
  }) => void
}) {
  const [reference, setReference] = useState('')
  const [title, setTitle] = useState('')
  const [drmRef, setDrmRef] = useState('')
  const [years, setYears] = useState('')
  const [beneficiary, setBeneficiary] = useState('')
  const valid = reference.trim() !== '' && title.trim() !== ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm">
      <form
        className="glass-popover w-full max-w-[540px] rounded-lg p-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          onAdd({
            reference: reference.trim(), title: title.trim(),
            drm_ref: drmRef || null,
            period_years: years.trim() === '' ? null : Number(years),
            beneficiary: beneficiary.trim() || null,
          })
        }}
      >
        <h2 className="mb-1 text-base font-semibold">Add a warranty</h2>
        <p className="text-graphite mb-3 text-xs">
          Link it to a matrix item and its owner is answered by the matrix. Leave the link
          blank and it will show as unallocated, which is the honest state.
        </p>
        <div className="mb-3 flex gap-2">
          <label className="w-[120px]">
            <span className="mb-1 block text-xs font-medium">Reference</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder="WTY-001"
              className="border-rule w-full rounded border px-2 py-2 font-mono text-sm" />
          </label>
          <label className="w-[86px]">
            <span className="mb-1 block text-xs font-medium">Years</span>
            <input value={years} onChange={(e) => setYears(e.target.value)} inputMode="numeric"
              className="border-rule w-full rounded border px-2 py-2 text-right font-mono text-sm" />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium">Beneficiary</span>
            <input value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)}
              className="border-rule w-full rounded border px-2 py-2 text-sm" />
          </label>
        </div>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium">Warranty</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            className="border-rule w-full rounded border px-3 py-2 text-sm" />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium">Matrix item</span>
          <select value={drmRef} onChange={(e) => setDrmRef(e.target.value)}
            className="border-rule w-full rounded border px-2 py-2 text-sm">
            <option value="">— not linked —</option>
            {drm.map((d) => (
              <option key={d.id} value={d.ref}>
                {d.ref} · {d.item}{d.lead_discipline ? ` (${d.lead_discipline})` : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" disabled={!valid}>Add</Button>
        </div>
      </form>
    </div>
  )
}
