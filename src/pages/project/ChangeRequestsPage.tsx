import { useCallback, useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router'

import { Money } from '@/components/commercial/Money'
import { fmtDate } from '@/lib/format'
import { RequireModule } from '@/components/shell/RequireModule'
import { Button } from '@/components/ui/button'
import { Panel, PageHead } from '@/components/ui/panel'
import { Code, Pill, Table, TableScroll, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import {
  CHANGE_IMPACT_COSTS, CHANGE_ITEM_ENTITIES, CHANGE_STATUSES,
  addChangeRequest, addChangeRequestItem, fetchChangeImplementationGap,
  fetchChangeRequestItems, fetchChangeRequests, fetchFees, fetchProjectCompanies,
  setChangeStatus, tickChangeItem, updateChangeRequest,
  type ChangeRequest, type ChangeRequestItem, type Fee, type ProjectCompany,
} from '@/lib/queries'
import type { ProjectContext } from '@/pages/project/ProjectLayout'

/**
 * Change requests.
 *
 * Party to party in any direction, and holding no money of their own: anything
 * with a figure attaches to a variation, so approving a change and agreeing
 * its cost stay two decisions.
 *
 * The register exists to keep approval and implementation apart. An approved
 * request lists what somebody has to amend and stays open until each is ticked
 * off by name; approved with nothing listed is flagged, because it means
 * either the list was never filled in or the change alters nothing.
 */
export default function ChangeRequestsPage() {
  const { id = '' } = useParams()
  const ctx = useOutletContext<ProjectContext>()
  const [rows, setRows] = useState<ChangeRequest[]>([])
  const [items, setItems] = useState<ChangeRequestItem[]>([])
  const [gap, setGap] = useState<Awaited<ReturnType<typeof fetchChangeImplementationGap>>>([])
  const [companies, setCompanies] = useState<ProjectCompany[]>([])
  const [variations, setVariations] = useState<Fee[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([
      fetchChangeRequests(id), fetchChangeImplementationGap(id),
      fetchProjectCompanies(id), fetchFees(id),
    ])
      .then(async ([r, g, co, f]) => {
        setRows(r); setGap(g); setCompanies(co)
        setVariations(f.filter((x) => x.kind === 'variation'))
        setItems(await fetchChangeRequestItems(r.map((x) => x.id)))
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(load, [load])

  const guard = (p: Promise<unknown>) =>
    p.then(load).catch((e: Error) => setError(e.message))

  if (loading) return <div className="text-graphite p-6 text-sm">Loading…</div>

  return (
    <RequireModule module="crs">
      <PageHead
        eyebrow="Design"
        title="Change requests"
        meta="Party to party, in any direction. They hold no money — the figure lives on the variation."
        actions={ctx.canEdit && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            Raise a change
          </Button>
        )}
      />

      {error && (
        <Panel kind="comply" className="mb-4"><p className="text-stop text-sm">{error}</p></Panel>
      )}

      {gap.length > 0 && (
        <Panel title="Approved but not implemented" kind="comply">
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[100px]">Ref</TH>
                  <TH>Change</TH>
                  <TH className="w-[150px]">Outstanding</TH>
                  <TH className="w-[110px]">Oldest</TH>
                </TR>
              </THead>
              <TBody>
                {gap.map((g) => (
                  <TR key={g.change_id}>
                    <TD><Code className="text-xs">{g.reference}</Code></TD>
                    <TD>{g.title}</TD>
                    <TD>
                      {g.nothing_listed
                        ? <Pill tone="warn">Nothing listed</Pill>
                        : <Pill tone="stop">
                            {g.outstanding} of {g.amendments} amendments
                          </Pill>}
                    </TD>
                    <TD><Code className="text-graphite text-xs">
                      {fmtDate(g.oldest_outstanding)}</Code></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableScroll>
          <p className="text-graphite mt-3 max-w-prose text-xs">
            This is the state the register exists to make visible. Nothing here has been
            automatically edited by the approval — the amendments are made by people, and an
            automatic edit would be a second source of truth arriving with nobody reading it.
          </p>
        </Panel>
      )}

      <Panel title={`${rows.length} change request${rows.length === 1 ? '' : 's'}`}>
        {rows.length === 0 ? (
          <p className="text-graphite max-w-prose text-sm">
            None raised yet. A change request is a request from one party to another to change
            scope or specification; direction is data, so anybody can raise one against
            anybody.
          </p>
        ) : (
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH className="w-[100px]">Ref</TH>
                  <TH>Change</TH>
                  <TH className="w-[130px]">From → to</TH>
                  <TH className="w-[110px]">Decision due</TH>
                  <TH className="w-[130px]">Money</TH>
                  <TH className="w-[140px]">Amendments</TH>
                  <TH className="w-[150px]">Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <ChangeRow
                    key={r.id}
                    row={r}
                    items={items.filter((i) => i.change_request_id === r.id)}
                    companies={companies}
                    variations={variations}
                    canEdit={ctx.canEdit}
                    open={open === r.id}
                    onToggle={() => setOpen(open === r.id ? null : r.id)}
                    guard={guard}
                  />
                ))}
              </TBody>
            </Table>
          </TableScroll>
        )}
      </Panel>

      {adding && (
        <AddChange
          companies={companies}
          onClose={() => setAdding(false)}
          onAdd={(row) => guard(addChangeRequest(id, row)).then(() => setAdding(false))}
        />
      )}
    </RequireModule>
  )
}

function ChangeRow({
  row, items, companies, variations, canEdit, open, onToggle, guard,
}: {
  row: ChangeRequest
  items: ChangeRequestItem[]
  companies: ProjectCompany[]
  variations: Fee[]
  canEdit: boolean
  open: boolean
  onToggle: () => void
  guard: (p: Promise<unknown>) => Promise<void>
}) {
  const [entity, setEntity] = useState('other')
  const [description, setDescription] = useState('')
  const coName = (cid: string | null) => companies.find((c) => c.id === cid)?.name ?? '—'

  return (
    <>
      <TR>
        <TD><Code className="text-xs">{row.reference}</Code></TD>
        <TD>
          <button type="button" onClick={onToggle}
            className="text-left underline-offset-2 hover:underline">
            {row.title}
          </button>
          {row.bsa_controlled && (
            <Pill tone={row.bsa_verdict === 'proceed' ? 'ok'
              : row.bsa_verdict === 'warn' ? 'warn' : 'stop'} className="ml-1.5">
              {row.bsa_state}
            </Pill>
          )}
          {row.decision_after_effective && (
            <div className="text-warn mt-0.5 text-[11px]">
              Decision is due after this takes effect
            </div>
          )}
        </TD>
        <TD className="text-xs">
          {coName(row.from_company_id)} → {coName(row.to_company_id)}
        </TD>
        <TD><Code className="text-graphite text-xs">{fmtDate(row.decision_due)}</Code></TD>
        <TD>
          {row.variation_reference ? (
            <div>
              <Code className="text-xs">{row.variation_reference}</Code>
              <div><Money value={row.variation_value} /></div>
            </div>
          ) : row.approved_without_a_variation ? (
            <Pill tone="warn">No variation raised</Pill>
          ) : (
            <span className="text-graphite text-xs">
              {row.impact_cost ?? '—'}
            </span>
          )}
        </TD>
        <TD>
          {row.amendments === 0 ? (
            row.approved_with_nothing_listed
              ? <Pill tone="warn">Nothing listed</Pill>
              : <span className="text-graphite text-xs">—</span>
          ) : row.amendments_outstanding === 0 ? (
            <Pill tone="ok">{row.amendments} all done</Pill>
          ) : (
            <Pill tone="stop">
              {row.amendments_outstanding} of {row.amendments} outstanding
            </Pill>
          )}
        </TD>
        <TD>
          {canEdit ? (
            <select
              value={row.status}
              onChange={(e) => guard(setChangeStatus(row.id, e.target.value))}
              className="border-rule w-full rounded border px-1 py-1 text-xs"
              aria-label={`Status of ${row.reference}`}
            >
              {CHANGE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <Pill tone={row.headline_status === 'Work must stop' ? 'stop' : 'neutral'}>
              {row.headline_status}
            </Pill>
          )}
        </TD>
      </TR>

      {open && (
        <TR>
          <TD colSpan={7} className="bg-surface-2">
            <div className="py-1">
              {row.description && (
                <p className="mb-2 max-w-prose text-sm">{row.description}</p>
              )}
              {row.reason && (
                <p className="text-graphite mb-2 max-w-prose text-sm">
                  <strong>Reason:</strong> {row.reason}
                </p>
              )}

              <h3 className="mb-2 text-sm font-semibold">
                What this obliges somebody to amend
              </h3>
              {items.length === 0 ? (
                <p className="text-graphite mb-2 max-w-prose text-sm">
                  Nothing listed yet. An approved change with an empty list cannot be marked
                  implemented — it means either the list was never filled in or the change
                  alters nothing, and somebody has to say which.
                </p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-[110px]">Where</TH>
                      <TH>Amendment</TH>
                      <TH className="w-[150px]">Done</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {items.map((i) => (
                      <TR key={i.id}>
                        <TD className="text-xs">{i.entity_type}</TD>
                        <TD>{i.description}</TD>
                        <TD>
                          {canEdit ? (
                            <label className="flex items-center gap-1.5 text-xs">
                              <input
                                type="checkbox"
                                checked={i.done_at !== null}
                                onChange={(e) =>
                                  guard(tickChangeItem(i.id, e.target.checked))}
                              />
                              {i.done_at
                                ? <span className="text-ok">{fmtDate(i.done_at)}</span>
                                : 'Outstanding'}
                            </label>
                          ) : i.done_at ? (
                            <Pill tone="ok">{fmtDate(i.done_at)}</Pill>
                          ) : (
                            <Pill tone="stop">Outstanding</Pill>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}

              {canEdit && (
                <form
                  className="mt-2 flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    // Refuses empty input rather than creating a blank row.
                    if (!description.trim()) return
                    guard(addChangeRequestItem(row.id, entity, description.trim()))
                      .then(() => setDescription(''))
                  }}
                >
                  <label className="w-[130px]">
                    <span className="mb-1 block text-xs font-medium">Where</span>
                    <select value={entity} onChange={(e) => setEntity(e.target.value)}
                      className="border-rule w-full rounded border px-2 py-1.5 text-sm">
                      {CHANGE_ITEM_ENTITIES.map((x) => (
                        <option key={x} value={x}>{x}</option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-[220px] flex-1">
                    <span className="mb-1 block text-xs font-medium">Amendment</span>
                    <input value={description} onChange={(e) => setDescription(e.target.value)}
                      placeholder="Revise the GA drawings to suit"
                      className="border-rule w-full rounded border px-2 py-1.5 text-sm" />
                  </label>
                  <Button size="sm" type="submit" disabled={!description.trim()}>
                    Add an amendment
                  </Button>
                </form>
              )}

              {canEdit && (
                <label className="mt-3 block max-w-[420px]">
                  <span className="mb-1 block text-xs font-medium">
                    The variation carrying the money
                  </span>
                  <select
                    value={row.variation_id ?? ''}
                    onChange={(e) => guard(updateChangeRequest(row.id, {
                      variation_id: e.target.value || null }))}
                    className="border-rule w-full rounded border px-2 py-1.5 text-sm"
                  >
                    <option value="">— none —</option>
                    {variations.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.reference} · {v.status}
                      </option>
                    ))}
                  </select>
                  <span className="text-graphite mt-1 block text-xs">
                    Only a variation, never a base fee. This register holds no figure of its
                    own: a second register carrying the same number is how the fee report
                    stops being believed.
                  </span>
                </label>
              )}
            </div>
          </TD>
        </TR>
      )}
    </>
  )
}

function AddChange({
  companies, onClose, onAdd,
}: {
  companies: ProjectCompany[]
  onClose: () => void
  onAdd: (row: {
    reference: string; title: string; description: string | null; reason: string | null
    category: string | null; from_company_id: string | null; to_company_id: string | null
    impact_scope: string | null; impact_weeks: number; impact_cost: string | null
  }) => void
}) {
  const [reference, setReference] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [reason, setReason] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [weeks, setWeeks] = useState('0')
  const [cost, setCost] = useState('None')
  const valid = reference.trim() !== '' && title.trim() !== ''

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-6 backdrop-blur-sm">
      <form
        className="glass-popover w-full max-w-[560px] rounded-lg p-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          onAdd({
            reference: reference.trim(), title: title.trim(),
            description: description.trim() || null, reason: reason.trim() || null,
            category: null,
            from_company_id: from || null, to_company_id: to || null,
            impact_scope: null, impact_weeks: Number(weeks) || 0, impact_cost: cost,
          })
        }}
      >
        <h2 className="mb-1 text-base font-semibold">Raise a change request</h2>
        <p className="text-graphite mb-3 text-xs">
          The cost impact here is an expectation, not an amount. Anything with a figure
          attaches to a variation afterwards.
        </p>
        <div className="mb-3 flex gap-2">
          <label className="w-[120px]">
            <span className="mb-1 block text-xs font-medium">Reference</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder="CHG-001"
              className="border-rule w-full rounded border px-2 py-2 font-mono text-sm" />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium">Change</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              className="border-rule w-full rounded border px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="mb-3 flex gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium">From</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)}
              className="border-rule w-full rounded border px-2 py-2 text-sm">
              <option value="">— not stated —</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium">To</span>
            <select value={to} onChange={(e) => setTo(e.target.value)}
              className="border-rule w-full rounded border px-2 py-2 text-sm">
              <option value="">— not stated —</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium">Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            rows={2} className="border-rule w-full rounded border px-3 py-2 text-sm" />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium">Reason</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)}
            className="border-rule w-full rounded border px-3 py-2 text-sm" />
        </label>
        <div className="mb-4 flex gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium">Cost impact (expected)</span>
            <select value={cost} onChange={(e) => setCost(e.target.value)}
              className="border-rule w-full rounded border px-2 py-2 text-sm">
              {CHANGE_IMPACT_COSTS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label className="w-[120px]">
            <span className="mb-1 block text-xs font-medium">Weeks</span>
            <input value={weeks} onChange={(e) => setWeeks(e.target.value)} inputMode="numeric"
              className="border-rule w-full rounded border px-2 py-2 text-right font-mono text-sm" />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" disabled={!valid}>Raise</Button>
        </div>
      </form>
    </div>
  )
}
